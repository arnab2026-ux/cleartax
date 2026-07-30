import { describe, expect, it } from "vitest";
import { housePropertySchema } from "../../lib/validation/houseProperty";

describe("housePropertySchema", () => {
  it("accepts a valid self-occupied property", () => {
    const result = housePropertySchema.safeParse({
      propertyType: "SELF_OCCUPIED",
      annualLetableValue: 0,
      municipalTaxesPaid: 0,
      homeLoanInterest: 180_000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid let-out property", () => {
    const result = housePropertySchema.safeParse({
      propertyType: "LET_OUT",
      address: "Flat 4B, Pune",
      annualLetableValue: 240_000,
      municipalTaxesPaid: 12_000,
      homeLoanInterest: 300_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid propertyType", () => {
    const result = housePropertySchema.safeParse({
      propertyType: "RENTED",
      annualLetableValue: 0,
      municipalTaxesPaid: 0,
      homeLoanInterest: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative homeLoanInterest", () => {
    const result = housePropertySchema.safeParse({
      propertyType: "SELF_OCCUPIED",
      annualLetableValue: 0,
      municipalTaxesPaid: 0,
      homeLoanInterest: -1,
    });
    expect(result.success).toBe(false);
  });

  it("treats an empty address as omitted", () => {
    const result = housePropertySchema.safeParse({
      propertyType: "SELF_OCCUPIED",
      address: "",
      annualLetableValue: 0,
      municipalTaxesPaid: 0,
      homeLoanInterest: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.address).toBeUndefined();
  });
});
