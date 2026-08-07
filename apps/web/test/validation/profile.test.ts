import { describe, expect, it } from "vitest";
import { taxpayerProfileSchema } from "../../lib/validation/profile";

const validBase = {
  residentialStatus: "ROR",
  pan: "ABCDE1234F",
  fullName: "Arjun Mehta",
  dateOfBirth: "1990-06-15",
};

describe("taxpayerProfileSchema", () => {
  it("accepts a minimal valid profile", () => {
    const result = taxpayerProfileSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  // Phase 11 — residential status drives Schedule FA applicability (ROR only)
  // and ITR-1 eligibility, so it is a required declared value, not optional.
  it.each(["ROR", "RNOR", "NR"])("accepts residential status %s", (residentialStatus) => {
    expect(taxpayerProfileSchema.safeParse({ ...validBase, residentialStatus }).success).toBe(true);
  });

  it("rejects an unknown residential status rather than defaulting it", () => {
    expect(taxpayerProfileSchema.safeParse({ ...validBase, residentialStatus: "RESIDENT" }).success).toBe(false);
    expect(taxpayerProfileSchema.safeParse({ ...validBase, residentialStatus: undefined }).success).toBe(false);
  });

  it("uppercases and accepts a lowercase PAN", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, pan: "abcde1234f" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pan).toBe("ABCDE1234F");
  });

  it.each(["ABCDE1234", "ABCD1234FF", "12345ABCDE", "abcde12345", ""])(
    "rejects a malformed PAN: %s",
    (pan) => {
      const result = taxpayerProfileSchema.safeParse({ ...validBase, pan });
      expect(result.success).toBe(false);
    },
  );

  it("rejects a missing full name", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, fullName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a future date of birth", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, dateOfBirth: "2999-01-01" });
    expect(result.success).toBe(false);
  });

  it("rejects an unparsable date of birth", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, dateOfBirth: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid 12-digit Aadhaar and strips spaces/dashes", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, aadhaar: "2345 6789 0123" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.aadhaar).toBe("234567890123");
  });

  it("treats an empty-string Aadhaar as omitted (optional field)", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, aadhaar: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.aadhaar).toBeUndefined();
  });

  it("rejects an Aadhaar that isn't 12 digits", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, aadhaar: "12345" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid IFSC and uppercases it", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, bankIfsc: "hdfc0001234" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bankIfsc).toBe("HDFC0001234");
  });

  it("rejects a malformed IFSC", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, bankIfsc: "NOTVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed pincode", () => {
    const result = taxpayerProfileSchema.safeParse({ ...validBase, pincode: "1234" });
    expect(result.success).toBe(false);
  });

  it("accepts a fully populated profile", () => {
    const result = taxpayerProfileSchema.safeParse({
      ...validBase,
      aadhaar: "234567890123",
      addressLine1: "123 MG Road",
      addressLine2: "Near City Center",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      bankAccountNumber: "000123456789",
      bankIfsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
    expect(result.success).toBe(true);
  });
});
