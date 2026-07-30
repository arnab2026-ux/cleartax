import { describe, expect, it } from "vitest";
import { section80CCD2Schema, section80DSchema, simpleDeductionSchema } from "../../lib/validation/deduction";

describe("simpleDeductionSchema", () => {
  it("accepts a valid amount", () => {
    expect(simpleDeductionSchema.safeParse({ amount: 150_000, description: "PPF" }).success).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(simpleDeductionSchema.safeParse({ amount: -1 }).success).toBe(false);
  });

  it("allows an omitted description", () => {
    const result = simpleDeductionSchema.safeParse({ amount: 50_000 });
    expect(result.success).toBe(true);
  });
});

describe("section80DSchema", () => {
  it("accepts a fully populated form", () => {
    const result = section80DSchema.safeParse({
      selfAndFamilyPremium: 20_000,
      selfOrFamilyHasSenior: false,
      parentsPremium: 30_000,
      parentsHaveSenior: true,
      preventiveHealthCheckup: 4_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative premium", () => {
    const result = section80DSchema.safeParse({
      selfAndFamilyPremium: -1,
      selfOrFamilyHasSenior: false,
      parentsPremium: 0,
      parentsHaveSenior: false,
      preventiveHealthCheckup: 0,
    });
    expect(result.success).toBe(false);
  });

  it("requires the boolean senior flags", () => {
    const result = section80DSchema.safeParse({
      selfAndFamilyPremium: 20_000,
      parentsPremium: 0,
      parentsHaveSenior: false,
      preventiveHealthCheckup: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("section80CCD2Schema", () => {
  it("accepts a valid government-employment row", () => {
    const result = section80CCD2Schema.safeParse({ employerContribution: 100_000, employmentType: "government" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid employmentType", () => {
    const result = section80CCD2Schema.safeParse({ employerContribution: 100_000, employmentType: "self-employed" });
    expect(result.success).toBe(false);
  });
});
