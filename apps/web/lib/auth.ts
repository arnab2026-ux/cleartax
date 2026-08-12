import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "./env";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

/** Format: scrypt:<saltHex>:<hashHex>. Generate with scripts/hash-password.mjs. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface SessionPayload {
  /** `User.id` — the tenant key. Everything the session can reach is scoped by this. */
  userId: string;
  email: string;
}

/**
 * Phase 13: the token carries `userId`, not just an email.
 *
 * The email alone identified the only possible user when credentials lived in
 * AUTH_USER_EMAIL. With real accounts it is the wrong thing to scope data by:
 * it is user-changeable, so a future "change your email" feature would
 * silently repoint an existing session at a different tenant (or none). The
 * immutable primary key cannot drift that way.
 */
export async function createSessionToken(session: SessionPayload): Promise<string> {
  return new SignJWT({ userId: session.userId, email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Returns null for any token missing `userId`, which includes every token
 * issued before Phase 13. That is deliberate: such a session has no tenant to
 * resolve, so it must fail closed and force a fresh login rather than fall
 * back to "the first profile" — the exact behaviour that would leak one
 * user's data to another.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.userId !== "string" || payload.userId.length === 0) return null;
    if (typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

export { SESSION_COOKIE };
