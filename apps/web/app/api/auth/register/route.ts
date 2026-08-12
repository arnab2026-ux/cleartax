import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { createSessionToken, hashPassword, sessionCookieOptions } from "@/lib/auth";
import { panBlindIndex } from "@/lib/blindIndex";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/rateLimit";
import { registrationSchema } from "@/lib/validation/registration";

/**
 * Invite-only registration — Phase 13.
 *
 * ============================================================================
 * WHY REGISTRATION IS CLOSED
 * ============================================================================
 * This endpoint creates an account that will hold a real person's PAN,
 * Aadhaar, salary and bank details. Left open, it would need email
 * verification and durable rate limiting before it could safely face the
 * internet — the first is blocked on an email provider this project does not
 * have, and the second is not satisfied by the in-memory throttle below,
 * which resets on every serverless cold start.
 *
 * Requiring an invite removes that surface rather than hardening it: an
 * unauthenticated caller cannot create an account at all. The throttle is
 * kept anyway, as a brake on code-guessing.
 *
 * ============================================================================
 * HOW A CODE IS CONSUMED EXACTLY ONCE
 * ============================================================================
 * The invite is redeemed by a COMPARE-AND-SET inside the same transaction
 * that creates the account:
 *
 *   updateMany({ where: { code, usedAt: null }, data: { usedAt: now } })
 *
 * and the transaction is aborted unless that reports exactly one row. Two
 * requests racing on one code therefore cannot both succeed: Postgres
 * serialises the two updates, the loser matches zero rows because `usedAt` is
 * no longer null, and its whole transaction rolls back. A read-then-write
 * ("find the invite, check it is unused, create the user, mark it used")
 * would NOT be safe here — both could read "unused" before either wrote, the
 * same race the Phase 5 review found in confirmForm16Upload.
 *
 * ============================================================================
 * WHY THE PROFILE IS CREATED SEPARATELY, NOT AS A NESTED WRITE
 * ============================================================================
 * The obvious shape for this is a single nested create:
 *
 *   prisma.user.create({ data: { ..., profile: { create: { pan, ... } } } })
 *
 * That would write the PAN in PLAINTEXT. The field-encryption extension
 * (lib/prismaFieldEncryption.ts) intercepts `query.taxpayerProfile.*` only —
 * a TaxpayerProfile created as a nested relation under `user.create` never
 * passes through that interceptor, so `pan` would reach Postgres unencrypted
 * while every other code path encrypted it.
 *
 * So the two rows are created by their own model calls, inside one
 * interactive transaction for atomicity: a failure creating the profile must
 * not leave behind a User with no profile, which every downstream page treats
 * as an impossible state.
 */

/** Registration does real work (scrypt, two inserts), so it is throttled harder than a read. */
const REGISTER_RATE_LIMIT_KEY = "register";

/**
 * Thrown inside the transaction to roll it back when the code is missing,
 * already redeemed, or bound to a different address. A sentinel class rather
 * than a string check, so it cannot be confused with a genuine database
 * error and swallowed.
 */
class InvalidInviteError extends Error {
  constructor() {
    super("invalid invite");
    this.name = "InvalidInviteError";
  }
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(`${REGISTER_RATE_LIMIT_KEY}:${ip}`)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid registration details" },
      { status: 400 },
    );
  }

  const { email, password, fullName, pan, phone, inviteCode } = parsed.data;

  // Throws if PAN_BLIND_INDEX_KEY is unset or too weak — a 500 here is
  // correct: it is a deployment fault, not something the caller can fix, and
  // registering without the uniqueness guarantee would be worse than failing.
  const panIndex = panBlindIndex(pan);
  const passwordHash = hashPassword(password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      // Redeem first, so an invalid or already-used code costs nothing else.
      // The OR enforces the optional binding: an unbound code (email null)
      // works for anyone, while a code minted for a specific address matches
      // only that address. Expressed as an OR rather than `in: [null, email]`
      // because SQL NULL is not equal to anything, including itself — an IN
      // list containing NULL would never match the unbound rows.
      const redeemed = await tx.invite.updateMany({
        where: { code: inviteCode, usedAt: null, OR: [{ email: null }, { email }] },
        data: { usedAt: new Date() },
      });
      if (redeemed.count !== 1) {
        throw new InvalidInviteError();
      }

      const created = await tx.user.create({
        data: { email, passwordHash, phone, panBlindIndex: panIndex },
      });

      // Recorded after the fact rather than in the compare-and-set above,
      // because the user id does not exist until now. Safe: the code is
      // already marked used, so nothing else can claim it, and this runs in
      // the same transaction.
      await tx.invite.updateMany({ where: { code: inviteCode }, data: { usedByUserId: created.id } });

      await tx.taxpayerProfile.create({
        data: {
          userId: created.id,
          pan,
          fullName,
          // The wizard's /profile step collects the real date of birth, and
          // it must: age drives the old regime's age-banded exemption limits.
          // This placeholder matches what getCurrentTaxpayerProfile used
          // before Phase 13, so behaviour here is unchanged — but it is a
          // placeholder, and /profile is where it gets corrected.
          dateOfBirth: new Date(Date.UTC(1990, 0, 1)),
          email,
          mobileNumber: phone,
        },
      });

      return created;
    });

    const token = await createSessionToken({ userId: user.id, email: user.email });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookieOptions.name, token, sessionCookieOptions);
    return response;
  } catch (error) {
    // One message for every invite failure — wrong code, already redeemed, or
    // bound to another address. Distinguishing them would let someone probe
    // for real codes, and the legitimate holder of a code has no use for the
    // distinction anyway.
    if (error instanceof InvalidInviteError) {
      return NextResponse.json(
        { error: "That invite code is not valid, has already been used, or was issued for a different email address." },
        { status: 403 },
      );
    }
    // P2002 = unique constraint violation. Which constraint tripped is in
    // `meta.target`, and the two cases are reported differently on purpose.
    //
    // ENUMERATION TRADEOFF, stated rather than left implicit: these messages
    // confirm to an unauthenticated caller that a given email or PAN has an
    // account here. The alternative — one generic failure — leaves a user
    // who genuinely already has an account with no way to work out why
    // registration keeps failing, and for a duplicate PAN specifically,
    // "someone has already registered your PAN" is information the real
    // owner needs, since it is a fraud signal. The proper mitigation is
    // email verification before an account becomes usable, which is blocked
    // on an email provider (see PROGRESS.md).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("panBlindIndex")) {
        return NextResponse.json(
          { error: "This PAN is already registered. If that was not you, contact support before continuing." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "An account already exists for this email address." }, { status: 409 });
    }
    throw error;
  }
}
