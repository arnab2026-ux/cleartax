import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

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
export async function getSession(): Promise<{ email: string } | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throws if there's no valid session. Use at the top of every Server Action. */
export async function requireSession(): Promise<{ email: string }> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
