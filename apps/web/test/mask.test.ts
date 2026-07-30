import { describe, expect, it } from "vitest";
import { maskAadhaar, maskBankAccountNumber, maskPan } from "../lib/mask";

describe("maskPan", () => {
  it("masks a standard 10-character PAN, keeping the last 5 characters", () => {
    expect(maskPan("ABCDE1234F")).toBe("XXXXX1234F");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(maskPan(null)).toBe("");
    expect(maskPan(undefined)).toBe("");
    expect(maskPan("")).toBe("");
  });

  it("masks entirely (no reveal) when the string is shorter than the keep-length", () => {
    expect(maskPan("ABCD")).toBe("XXXX");
    expect(maskPan("A")).toBe("X");
  });

  it("preserves the original length", () => {
    expect(maskPan("ABCDE1234F").length).toBe(10);
  });
});

describe("maskAadhaar", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskAadhaar("234567890123")).toBe("XXXXXXXX0123");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(maskAadhaar(null)).toBe("");
    expect(maskAadhaar(undefined)).toBe("");
    expect(maskAadhaar("")).toBe("");
  });

  it("masks entirely when shorter than 4 characters", () => {
    expect(maskAadhaar("12")).toBe("XX");
  });
});

describe("maskBankAccountNumber", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskBankAccountNumber("000123456789012")).toBe("XXXXXXXXXXX9012");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(maskBankAccountNumber(null)).toBe("");
    expect(maskBankAccountNumber(undefined)).toBe("");
    expect(maskBankAccountNumber("")).toBe("");
  });

  it("handles an exactly-4-character value (fully masked, per <=keepLast rule)", () => {
    expect(maskBankAccountNumber("1234")).toBe("XXXX");
  });

  it("handles a 5-character value (mask 1, keep last 4)", () => {
    expect(maskBankAccountNumber("12345")).toBe("X2345");
  });
});
