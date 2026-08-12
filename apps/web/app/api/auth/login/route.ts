import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashPassword, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/rateLimit";
import { loginSchema } from "@/lib/validation/registration";

/**
 * Phase 13: credentials come from the `User` table, not AUTH_USER_EMAIL /
 * AUTH_PASSWORD_HASH. The session token now carries `userId`, which is the
 * tenant key every downstream query scopes by (see lib/auth.ts).
 */

/**
 * A throwaway scrypt hash used only to burn the same CPU time when no user
 * matches. Without it, "no such email" returns in microseconds while a real
 * email takes as long as scrypt does — a timing difference large enough to
 * enumerate accounts remotely, which matters more here than usual because
 * registration is open and the data is tax records.
 *
 * Computed once at module load rather than per request: the cost that needs
 * matching is the VERIFY, which happens on every request either way.
 */
const DUMMY_PASSWORD_HASH = hashPassword("timing-equalisation-placeholder");

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(`login:${ip}`)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  // `email` is already lowercased/trimmed by the schema, matching how it was
  // canonicalised at registration — the lookup depends on that.
  const user = await prisma.user.findUnique({ where: { email } });

  // Always verify SOMETHING, so the response time does not reveal whether the
  // address exists. The result for a missing user is discarded.
  const passwordMatches = verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    // One message for both cases, deliberately: distinguishing them would
    // undo the timing work above by simply saying it out loud.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken({ userId: user.id, email: user.email });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieOptions.name, token, sessionCookieOptions);
  return response;
}
