import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./auth";

/**
 * Defense-in-depth session check for Server Components/Actions in the
 * wizard, mirroring the pattern already used in
 * `app/api/form16/upload/route.ts`. `proxy.ts` already gates every route
 * under `(dashboard)` (it's not in the public-path allowlist), but per
 * Next.js 16's own guidance, Server Actions in particular should verify
 * auth themselves too — a Server Action can be invoked directly (it's just
 * a POST to a framework-generated endpoint), not only by navigating through
 * a proxy-gated page.
 *
 * Next.js 16's `cookies()` is fully async — always `await` it.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Throws if there's no valid session. Use at the top of every Server Action.
 *
 * Phase 13: the returned `userId` is the tenant key every data access must be
 * scoped by. Prefer `requireUserId()` below at call sites that only need that,
 * so the scoping is visible in the code rather than implied.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

/** The logged-in `User.id`. Every query touching taxpayer data must be scoped by this. */
export async function requireUserId(): Promise<string> {
  return (await requireSession()).userId;
}
