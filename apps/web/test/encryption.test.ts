import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptField, encryptField, isFieldEncryptionConfigured } from "../lib/encryption";

function freshBase64Key(): string {
  return randomBytes(32).toString("base64");
}

describe("encryptField / decryptField (AES-256-GCM field encryption)", () => {
  beforeEach(() => {
    process.env["FIELD_ENCRYPTION_KEY"] = freshBase64Key();
  });

  it("round-trips a typical PAN value exactly", () => {
    const plaintext = "ABCDE1234F";
    const ciphertext = encryptField(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("round-trips a typical Aadhaar value exactly", () => {
    const plaintext = "234567890123";
    const ciphertext = encryptField(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("round-trips a bank account number exactly", () => {
    const plaintext = "000123456789012";
    const ciphertext = encryptField(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const ciphertext = encryptField("");
    expect(decryptField(ciphertext)).toBe("");
  });

  it("round-trips unicode content correctly", () => {
    const plaintext = "श्री अर्नब — Ärnab O'Brien";
    const ciphertext = encryptField(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("round-trips a long value correctly", () => {
    const plaintext = "x".repeat(10_000);
    const ciphertext = encryptField(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("produces the 'iv:authTag:ciphertext' base64 format", () => {
    const stored = encryptField("ABCDE1234F");
    const parts = stored.split(":");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      // Every component should be valid base64 and non-empty.
      expect(part.length).toBeGreaterThan(0);
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("uses a fresh random IV per call, so encrypting the same plaintext twice yields different ciphertext", () => {
    const plaintext = "ABCDE1234F";
    const first = encryptField(plaintext);
    const second = encryptField(plaintext);
    expect(first).not.toBe(second);
    // But both must still decrypt back to the same original value.
    expect(decryptField(first)).toBe(plaintext);
    expect(decryptField(second)).toBe(plaintext);
  });

  it("fails to decrypt with the wrong key", () => {
    const plaintext = "ABCDE1234F";
    const ciphertext = encryptField(plaintext);

    process.env["FIELD_ENCRYPTION_KEY"] = freshBase64Key(); // swap to a different key
    expect(() => decryptField(ciphertext)).toThrow();
  });

  it("fails to decrypt when the ciphertext has been tampered with", () => {
    const ciphertext = encryptField("ABCDE1234F");
    const [iv, authTag, body] = ciphertext.split(":") as [string, string, string];

    const bodyBuf = Buffer.from(body, "base64");
    // Flip a bit in the first byte of the ciphertext body.
    bodyBuf[0] = (bodyBuf[0] ?? 0) ^ 0xff;
    const tampered = [iv, authTag, bodyBuf.toString("base64")].join(":");

    expect(() => decryptField(tampered)).toThrow();
  });

  it("fails to decrypt when the auth tag has been tampered with", () => {
    const ciphertext = encryptField("ABCDE1234F");
    const [iv, authTag, body] = ciphertext.split(":") as [string, string, string];

    const tagBuf = Buffer.from(authTag, "base64");
    tagBuf[0] = (tagBuf[0] ?? 0) ^ 0xff;
    const tampered = [iv, tagBuf.toString("base64"), body].join(":");

    expect(() => decryptField(tampered)).toThrow();
  });

  it("fails to decrypt when the IV has been tampered with", () => {
    const ciphertext = encryptField("ABCDE1234F");
    const [iv, authTag, body] = ciphertext.split(":") as [string, string, string];

    const ivBuf = Buffer.from(iv, "base64");
    ivBuf[0] = (ivBuf[0] ?? 0) ^ 0xff;
    const tampered = [ivBuf.toString("base64"), authTag, body].join(":");

    expect(() => decryptField(tampered)).toThrow();
  });

  it("rejects a malformed stored value (wrong number of colon-delimited parts)", () => {
    expect(() => decryptField("not-a-valid-stored-value")).toThrow(/expected/i);
    expect(() => decryptField("a:b")).toThrow(/expected/i);
    expect(() => decryptField("a:b:c:d")).toThrow(/expected/i);
  });

  it("throws a clear error when FIELD_ENCRYPTION_KEY is missing", () => {
    delete process.env["FIELD_ENCRYPTION_KEY"];
    expect(() => encryptField("ABCDE1234F")).toThrow(/FIELD_ENCRYPTION_KEY is not set/);
    expect(() => decryptField("a:b:c")).toThrow(/FIELD_ENCRYPTION_KEY is not set/);
  });

  it("throws a clear 'not valid base64' error when FIELD_ENCRYPTION_KEY contains characters outside the base64 alphabet", () => {
    // "too-short" contains a hyphen, which is not in the standard base64
    // alphabet, and isn't a multiple of 4 characters long either — this is
    // the case the code's error message literally calls "not valid base64".
    // (Before the fix below, Buffer.from("too-short", "base64") did NOT
    // throw — Node's base64 decoder just silently drops the hyphen and
    // decodes whatever's left, landing on some length other than 32, so the
    // old code advanced past the always-succeeding try/catch and only ever
    // reached the *length* check, reporting "must decode to exactly 32
    // bytes" instead of the more accurate "not valid base64". That mismatch
    // between this test's own name and its assertion was itself a symptom
    // of the dead-code bug.)
    process.env["FIELD_ENCRYPTION_KEY"] = "too-short";
    expect(() => encryptField("ABCDE1234F")).toThrow(/not valid base64/);
  });

  it("throws a clear error when FIELD_ENCRYPTION_KEY is well-formed base64 but decodes to the wrong length", () => {
    process.env["FIELD_ENCRYPTION_KEY"] = randomBytes(16).toString("base64"); // AES-128-sized, not AES-256
    expect(() => encryptField("ABCDE1234F")).toThrow(/32 bytes/);
  });

  it("rejects a value with invalid base64 characters even when it decodes to exactly 32 bytes (Buffer.from silently drops them instead of throwing)", () => {
    // Node's Buffer.from(str, "base64") is lenient: it strips every
    // character outside the base64 alphabet and decodes whatever's left,
    // rather than throwing. Concrete demonstration: take a real, valid
    // 32-byte base64 key and interleave garbage characters between every
    // character of it. Buffer.from still decodes this back to the exact
    // original 32-byte key (confirmed via node -e before writing this
    // test) — so a length check alone can't distinguish "the user's real
    // key, verbatim" from "the user's real key, corrupted with junk that
    // happens to get silently stripped". This is exactly why loadKey() now
    // validates the base64 alphabet explicitly instead of relying on
    // Buffer.from to reject malformed input (it won't).
    const realKey = freshBase64Key();
    const junked = realKey
      .split("")
      .map((c) => c + "!@#$%^&*() ")
      .join("");
    process.env["FIELD_ENCRYPTION_KEY"] = junked;
    expect(() => encryptField("ABCDE1234F")).toThrow(/not valid base64/);
  });

  it("tolerates surrounding whitespace on an otherwise-valid key (e.g. a trailing newline from a .env file)", () => {
    const realKey = freshBase64Key();
    process.env["FIELD_ENCRYPTION_KEY"] = `  ${realKey}\n`;
    const ciphertext = encryptField("ABCDE1234F");
    expect(decryptField(ciphertext)).toBe("ABCDE1234F");
  });

  it("isFieldEncryptionConfigured reflects whether the env var is present", () => {
    expect(isFieldEncryptionConfigured()).toBe(true);
    delete process.env["FIELD_ENCRYPTION_KEY"];
    expect(isFieldEncryptionConfigured()).toBe(false);
  });
});
