/**
 * Best-effort in-memory login rate limiter. Resets on cold start, so it's not a
 * hard guarantee on serverless (each instance has its own counter) — it's a
 * cheap deterrent for a single-credential login endpoint, not the sole defense.
 * The password itself (scrypt-hashed, timing-safe compared) is the real gate.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}
