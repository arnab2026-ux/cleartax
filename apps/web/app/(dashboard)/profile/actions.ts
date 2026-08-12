"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { panBlindIndex } from "@/lib/blindIndex";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { taxpayerProfileSchema } from "@/lib/validation/profile";

export interface SaveProfileResult {
  ok: boolean;
  error?: string;
}

/**
 * Updates the logged-in user's `TaxpayerProfile` (Phase 13 — one profile per
 * account, scoped by `userId`; see `lib/getCurrentTaxpayerProfile.ts` for the
 * tenant boundary). Session is checked here too (not just relying on
 * `proxy.ts`) — Server Actions are
 * directly-callable POST endpoints, so per Next.js 16's own guidance this is
 * defense in depth, matching the pattern in
 * `app/api/form16/upload/route.ts`.
 */
export async function saveProfile(values: unknown): Promise<SaveProfileResult> {
  const userId = await requireUserId();

  const parsed = taxpayerProfileSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid profile data" };
  }
  const data = parsed.data;

  const payload = {
    residentialStatus: data.residentialStatus,
    pan: data.pan,
    fullName: data.fullName,
    dateOfBirth: new Date(data.dateOfBirth),
    aadhaar: data.aadhaar ?? null,
    addressLine1: data.addressLine1 ?? null,
    addressLine2: data.addressLine2 ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    pincode: data.pincode ?? null,
    bankAccountNumber: data.bankAccountNumber ?? null,
    bankIfsc: data.bankIfsc ?? null,
    bankName: data.bankName ?? null,
  };

  // Phase 13. This used to be `findFirst({ orderBy: { createdAt: "asc" } })`
  // followed by an update on whatever came back — which, with more than one
  // account, meant ANY user saving their profile overwrote the FIRST
  // registered user's PAN, Aadhaar and bank details. It did not go through
  // getCurrentTaxpayerProfile, so it was not covered by the tenant boundary
  // that file defines; scoping the write on `userId` is what fixes it.
  //
  // `update` (not upsert): registration creates the profile atomically with
  // the account, so a missing row is a broken invariant rather than a case to
  // paper over — same reasoning as getCurrentTaxpayerProfile's.
  //
  // The PAN blind index is rewritten in the same transaction because it is
  // DERIVED from the PAN. Letting the two drift would quietly break the
  // duplicate-PAN guarantee: the profile would hold a new PAN while `User`
  // still advertised the old one, so a second account could register the new
  // PAN unchallenged.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.taxpayerProfile.update({ where: { userId }, data: payload });
      await tx.user.update({ where: { id: userId }, data: { panBlindIndex: panBlindIndex(data.pan) } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "That PAN is already registered to another account." };
    }
    throw error;
  }

  revalidatePath("/profile");
  return { ok: true };
}
