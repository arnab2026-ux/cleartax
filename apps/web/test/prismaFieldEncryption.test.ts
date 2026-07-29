import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptField } from "../lib/encryption";
import {
  decryptOptional,
  decryptRequired,
  encryptScalarWriteValue,
  encryptWriteData,
  TAXPAYER_PROFILE_WRITE_ACTIONS,
} from "../lib/prismaFieldEncryption";

// These test the PURE data-shaping helpers the Prisma Client Extension
// (fieldEncryptionExtension) uses to encrypt args.data/create/update before
// a write and decrypt result fields after a read. They deliberately don't
// spin up a real Prisma Client / DB connection (none exists yet — see
// PROGRESS.md) — that wiring can only be verified once a live Neon
// connection is available. What CAN be verified now, and is the
// security-critical part, is that these helpers transform every write-input
// shape Prisma actually produces correctly and never let a plaintext value
// slip through unencrypted.

function freshBase64Key(): string {
  return randomBytes(32).toString("base64");
}

beforeEach(() => {
  process.env["FIELD_ENCRYPTION_KEY"] = freshBase64Key();
});

describe("encryptScalarWriteValue", () => {
  it("encrypts a plain string value (the `create` args.data shape)", () => {
    const result = encryptScalarWriteValue("ABCDE1234F");
    expect(typeof result).toBe("string");
    expect(result).not.toBe("ABCDE1234F");
    expect(decryptField(result as string)).toBe("ABCDE1234F");
  });

  it("encrypts the { set: string } field-update-operations shape (the `update` args.data shape)", () => {
    const result = encryptScalarWriteValue({ set: "ABCDE1234F" });
    expect(result).toHaveProperty("set");
    const ciphertext = (result as { set: string }).set;
    expect(ciphertext).not.toBe("ABCDE1234F");
    expect(decryptField(ciphertext)).toBe("ABCDE1234F");
  });

  it("passes null through unchanged (explicit clear of a nullable field)", () => {
    expect(encryptScalarWriteValue(null)).toBeNull();
  });

  it("passes { set: null } through unchanged", () => {
    expect(encryptScalarWriteValue({ set: null })).toEqual({ set: null });
  });

  it("passes undefined through unchanged (field not being written)", () => {
    expect(encryptScalarWriteValue(undefined)).toBeUndefined();
  });
});

describe("encryptWriteData", () => {
  it("encrypts pan/aadhaar/bankAccountNumber but leaves other fields untouched", () => {
    const input = {
      fullName: "Arnab Test",
      pan: "ABCDE1234F",
      aadhaar: "234567890123",
      bankAccountNumber: "000123456789",
      bankIfsc: "HDFC0001234", // NOT an encrypted field — must survive verbatim
    };
    const out = encryptWriteData(input);

    expect(out.fullName).toBe("Arnab Test"); // untouched
    expect(out.bankIfsc).toBe("HDFC0001234"); // untouched

    expect(out.pan).not.toBe(input.pan);
    expect(decryptField(out.pan as string)).toBe(input.pan);

    expect(out.aadhaar).not.toBe(input.aadhaar);
    expect(decryptField(out.aadhaar as string)).toBe(input.aadhaar);

    expect(out.bankAccountNumber).not.toBe(input.bankAccountNumber);
    expect(decryptField(out.bankAccountNumber as string)).toBe(input.bankAccountNumber);
  });

  it("only touches fields that are actually present in the input (partial update)", () => {
    const input = { fullName: "New Name Only" };
    const out = encryptWriteData(input);
    expect(out).toEqual({ fullName: "New Name Only" });
  });

  it("does not mutate the original object", () => {
    const input = { pan: "ABCDE1234F" };
    const out = encryptWriteData(input);
    expect(input.pan).toBe("ABCDE1234F"); // original untouched
    expect(out.pan).not.toBe("ABCDE1234F");
  });
});

describe("extension write-action coverage (regression: createManyAndReturn/updateManyAndReturn were missing)", () => {
  // Prisma.defineExtension()'s return value is an opaque function with no
  // introspectable `.query.taxpayerProfile` shape (confirmed by inspection —
  // Object.keys() on the built extension returns nothing useful), so the
  // only way to unit-test "every write action that can carry PII actually
  // has an encrypt-on-write handler" without a live database is to read the
  // module's own source and confirm each action in
  // TAXPAYER_PROFILE_WRITE_ACTIONS (kept in sync with Prisma's own
  // PrismaAction union — see that constant's doc comment) is wired up as a
  // real method inside the `query: { taxpayerProfile: { ... } }` block, not
  // just referenced in a comment. This is what would have caught the
  // original createManyAndReturn/updateManyAndReturn gap before a real DB
  // existed to catch it the hard way (silently written plaintext PII).
  const source = readFileSync(fileURLToPath(new URL("../lib/prismaFieldEncryption.ts", import.meta.url)), "utf8");
  const queryBlockMatch = source.match(/query:\s*\{\s*taxpayerProfile:\s*\{([\s\S]*?)\n\s{4}\},\n\s{2}\},\n\s{2}result:/);

  it("locates the query.taxpayerProfile block in the source (sanity check that the regex above still matches the current file shape)", () => {
    expect(queryBlockMatch).not.toBeNull();
  });

  it.each(TAXPAYER_PROFILE_WRITE_ACTIONS)("has a real handler method for '%s'", (action) => {
    const queryBlockSource = queryBlockMatch?.[1] ?? "";
    // Matches e.g. `create({ args, query }) {` at the start of a line inside the block.
    const handlerPattern = new RegExp(`^\\s*${action}\\(\\{\\s*args,\\s*query\\s*\\}\\)\\s*\\{`, "m");
    expect(queryBlockSource).toMatch(handlerPattern);
  });
});

describe("decryptRequired / decryptOptional", () => {
  it("decryptRequired decrypts a stored ciphertext string", () => {
    const stored = encryptScalarWriteValue("ABCDE1234F") as string;
    expect(decryptRequired(stored)).toBe("ABCDE1234F");
  });

  it("decryptRequired throws if given a non-string (defensive — should never happen for a NOT NULL column)", () => {
    expect(() => decryptRequired(null)).toThrow(/Expected an encrypted string/);
    expect(() => decryptRequired(undefined)).toThrow(/Expected an encrypted string/);
  });

  it("decryptOptional returns null for null/undefined without attempting decryption", () => {
    expect(decryptOptional(null)).toBeNull();
    expect(decryptOptional(undefined)).toBeNull();
  });

  it("decryptOptional decrypts a present ciphertext string", () => {
    const stored = encryptScalarWriteValue("234567890123") as string;
    expect(decryptOptional(stored)).toBe("234567890123");
  });
});
