import { describe, expect, it } from "vitest";
import { itrFilingDetailsSchema } from "../../lib/validation/itrFilingDetails";

const valid = {
  fatherName: "Ramesh Mehta",
  email: "arjun.mehta@example.com",
  mobileNumber: "9876543210",
};

describe("itrFilingDetailsSchema", () => {
  it("accepts a valid set of details", () => {
    const result = itrFilingDetailsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects an empty father's name", () => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, fatherName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a father's name over 125 characters", () => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, fatherName: "A".repeat(126) });
    expect(result.success).toBe(false);
  });

  it.each(["not-an-email", "missing@domain", "@nouser.com", ""])("rejects a malformed email: %s", (email) => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, email });
    expect(result.success).toBe(false);
  });

  it.each(["123456789", "12345678901", "abcdefghij", ""])("rejects a mobile number that isn't exactly 10 digits: %s", (mobileNumber) => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, mobileNumber });
    expect(result.success).toBe(false);
  });

  it("accepts a mobile number with spaces/dashes and strips them", () => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, mobileNumber: "98765-43210" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mobileNumber).toBe("9876543210");
  });

  it("trims whitespace from father's name and email", () => {
    const result = itrFilingDetailsSchema.safeParse({ ...valid, fatherName: "  Ramesh Mehta  ", email: "  arjun.mehta@example.com  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fatherName).toBe("Ramesh Mehta");
      expect(result.data.email).toBe("arjun.mehta@example.com");
    }
  });
});
