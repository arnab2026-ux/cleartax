/**
 * AES-256-GCM field-level encryption primitives for sensitive PII
 * (TaxpayerProfile.pan / .aadhaar / .bankAccountNumber — see
 * lib/prismaFieldEncryption.ts for the Prisma Client Extension that wires
 * these into every read/write of that model transparently).
 *
 * Key handling: `FIELD_ENCRYPTION_KEY` (see .env.example / lib/env.ts) must
 * be a base64-encoded 32-byte (256-bit) key, e.g. generated with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Deliberately NOT validated via lib/env.ts's `getEnv()` — that function
 * validates the whole app's env schema at once, and FIELD_ENCRYPTION_KEY
 * stays optional there so routes that never touch encrypted fields (login,
 * health checks, etc.) don't start failing just because this var is unset.
 * Instead, the key is loaded lazily, right here, only when encryptField()/
 * decryptField() are actually called — so the failure is scoped to exactly
 * the code path that's load-bearing on it.
 *
 * Stored ciphertext format: "iv:authTag:ciphertext", each component
 * base64-encoded, colon-delimited — mirrors the "scheme:salt:hash"
 * convention lib/auth.ts already uses for password hashes.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit IV — the size GCM is designed for; using another size is legal but not recommended and would just add complexity here for no benefit.

/**
 * Reads and validates FIELD_ENCRYPTION_KEY from the environment. Not
 * cached: intentionally cheap (base64 decode + length check) so tests can
 * freely swap `process.env.FIELD_ENCRYPTION_KEY` between calls without
 * needing to reset any module-level cache.
 */
function loadKey(): Buffer {
  const raw = process.env["FIELD_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not set. It's required to read or write any encrypted TaxpayerProfile field " +
        "(pan/aadhaar/bankAccountNumber). Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  // NOTE: Buffer.from(str, "base64") never throws in Node.js, even for
  // garbage input — it's a lenient decoder that silently drops any
  // character outside the base64 alphabet and decodes whatever's left
  // (confirmed: a 32-byte key with junk characters interleaved between
  // every character, e.g. "e!@#$%^&*() /!@#$%^&*() D...", decodes back to
  // the exact original 32 bytes). So a try/catch around this call can never
  // fire — it was dead code. Worse, without an explicit alphabet check, a
  // mistyped/corrupted FIELD_ENCRYPTION_KEY (e.g. a copy-paste accident
  // that lands on the right length but the wrong content) can silently
  // decode to *some* plausible-looking 32-byte key instead of failing
  // loudly here. Validate the base64 alphabet explicitly before decoding so
  // malformed input is rejected at the source instead of relying on
  // Buffer.from to catch it (it won't).
  const trimmed = raw.trim();
  if (trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) {
    throw new Error("FIELD_ENCRYPTION_KEY is not valid base64.");
  }

  const key = Buffer.from(trimmed, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  return key;
}

/** True if FIELD_ENCRYPTION_KEY is present (does not validate its shape) — use to fail fast with a clearer error before attempting a DB write. */
export function isFieldEncryptionConfigured(): boolean {
  const raw = process.env["FIELD_ENCRYPTION_KEY"];
  return typeof raw === "string" && raw.length > 0;
}

/**
 * Encrypts a plaintext string with AES-256-GCM using a fresh random IV
 * (never reuse an IV with the same key: GCM's confidentiality AND integrity
 * guarantees both depend on IV uniqueness per encryption). Returns
 * "iv:authTag:ciphertext" (all three base64-encoded).
 */
export function encryptField(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Decrypts a value produced by encryptField(). Throws (never returns
 * corrupted/garbage plaintext) if: the stored value isn't well-formed, the
 * key is wrong, or the ciphertext/authTag was tampered with — GCM's
 * `decipher.final()` verifies the auth tag and throws
 * "Unsupported state or unable to authenticate data" on any mismatch.
 */
export function decryptField(stored: string): string {
  const key = loadKey();

  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted field value is not in the expected 'iv:authTag:ciphertext' format.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  if (iv.length !== IV_BYTES) {
    throw new Error(`Encrypted field value has an invalid IV length (expected ${IV_BYTES} bytes, got ${iv.length}).`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
