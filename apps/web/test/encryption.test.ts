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

  it("throws a clear error when FIELD_ENCRYPTION_KEY is not valid base64 for a 32-byte key", () => {
    process.env["FIELD_ENCRYPTION_KEY"] = "too-short";
    expect(() => encryptField("ABCDE1234F")).toThrow(/32 bytes/);
  });

  it("throws a clear error when FIELD_ENCRYPTION_KEY decodes to the wrong length", () => {
    process.env["FIELD_ENCRYPTION_KEY"] = randomBytes(16).toString("base64"); // AES-128-sized, not AES-256
    expect(() => encryptField("ABCDE1234F")).toThrow(/32 bytes/);
  });

  it("isFieldEncryptionConfigured reflects whether the env var is present", () => {
    expect(isFieldEncryptionConfigured()).toBe(true);
    delete process.env["FIELD_ENCRYPTION_KEY"];
    expect(isFieldEncryptionConfigured()).toBe(false);
  });
});
