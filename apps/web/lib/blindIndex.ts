/**
 * Blind index for PAN — Phase 13 (multi-user accounts).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `TaxpayerProfile.pan` is encrypted with AES-256-GCM under a RANDOM IV
 * (lib/encryption.ts), so the same PAN produces different ciphertext on every
 * write. That is exactly what you want for confidentiality, and exactly what
 * makes the column unusable for the two things open registration needs:
 *
 *   - "is this PAN already registered?" — an equality lookup
 *   - a UNIQUE constraint preventing two accounts claiming one PAN
 *
 * A blind index solves both by storing a DETERMINISTIC, one-way value beside
 * the reversible one: HMAC-SHA256(normalised PAN, key), hex-encoded, in
 * `User.panBlindIndex` with a unique index on it. Equal PANs produce equal
 * digests, so Postgres can compare and constrain them, while the digest
 * itself reveals nothing directly.
 *
 * ============================================================================
 * WHAT THIS DOES *NOT* PROTECT AGAINST — read before trusting it
 * ============================================================================
 * A PAN is ten characters over a known, tiny alphabet (5 letters, 4 digits,
 * 1 letter). Anyone holding BOTH this column and `PAN_BLIND_INDEX_KEY` can
 * enumerate candidate PANs offline and match them against the digests: the
 * keyspace of the input is far too small to resist that. The secrecy of the
 * key is the entire protection, so it must be treated exactly like
 * FIELD_ENCRYPTION_KEY — never logged, never committed, never shipped to the
 * browser.
 *
 * A plain unsalted SHA-256 would be strictly worse (no key at all, so a
 * rainbow table over the whole PAN space is precomputable by anyone), which
 * is why this is keyed.
 *
 * ============================================================================
 * WHY A SEPARATE KEY FROM FIELD_ENCRYPTION_KEY
 * ============================================================================
 * This value is indexed, which makes it the likeliest of the two to end up
 * somewhere it should not be — a slow-query log, an EXPLAIN, a database
 * backup handed to a contractor. Deriving it from the encryption key would
 * mean such a leak also weakened the encrypted columns. Separate keys keep
 * the failure domains separate, and this key can be rotated (by recomputing
 * every digest) without touching any ciphertext.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 5 letters, 4 digits, 1 letter — e.g. ABCDE1234F. */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Canonical form fed to the HMAC. Without this, "abcde1234f" and
 * " ABCDE1234F " would hash differently and both could register — the
 * uniqueness guarantee would be silently worthless. Normalisation is
 * therefore part of the security property, not a convenience.
 */
export function normalisePan(pan: string): string {
  return pan.replace(/\s+/g, "").toUpperCase();
}

export function isValidPan(pan: string): boolean {
  return PAN_REGEX.test(normalisePan(pan));
}

/**
 * Loaded lazily and uncached, mirroring lib/encryption.ts's `loadKey()`: the
 * cost is trivial, and tests can swap the env var between calls without
 * fighting a module-level cache.
 *
 * Requires at least 32 bytes of key material. Unlike AES there is no exact
 * length requirement for an HMAC key, but a short one is the whole weakness
 * here (see the header), so a minimum is enforced rather than accepting
 * whatever is supplied.
 */
function loadKey(): Buffer {
  const raw = process.env["PAN_BLIND_INDEX_KEY"];
  if (!raw) {
    throw new Error(
      "PAN_BLIND_INDEX_KEY is not set. It is required to register a user or look one up by PAN. " +
        "Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ` +
        "— and make it DIFFERENT from FIELD_ENCRYPTION_KEY (see lib/blindIndex.ts's header).",
    );
  }

  // Base64 is decoded leniently by Node (junk characters are silently
  // dropped), so a mistyped key can decode to *some* plausible buffer instead
  // of failing. Validate the alphabet explicitly first — the same trap, and
  // the same fix, as the one documented in lib/encryption.ts's loadKey().
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("PAN_BLIND_INDEX_KEY is not valid base64. Regenerate it — see lib/blindIndex.ts's header.");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error(
      `PAN_BLIND_INDEX_KEY decodes to ${key.length} bytes; at least 32 are required. ` +
        "A short key is the primary weakness of a blind index over a keyspace as small as PAN.",
    );
  }
  return key;
}

/**
 * The value stored in `User.panBlindIndex`. Throws on a malformed PAN rather
 * than hashing it: a digest computed over junk would be indistinguishable
 * from a real one afterwards, and would occupy the unique index forever.
 */
export function panBlindIndex(pan: string): string {
  const normalised = normalisePan(pan);
  if (!PAN_REGEX.test(normalised)) {
    throw new Error(`"${pan}" is not a valid PAN (expected five letters, four digits, then a letter, e.g. ABCDE1234F).`);
  }
  return createHmac("sha256", loadKey()).update(normalised, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two digests. Postgres does the comparison for
 * the uniqueness check, so this is for the rarer in-process case; it is
 * timing-safe on principle rather than because a specific attack is known,
 * since a digest comparison is cheap to do properly.
 */
export function blindIndexEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
