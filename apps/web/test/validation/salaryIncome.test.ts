import { describe, expect, it } from "vitest";
import { salaryIncomeSchema } from "../../lib/validation/salaryIncome";

const valid = {
  employerName: "Acme Corp",
  grossSalary: 1_800_000,
  basicSalary: 900_000,
  hraReceived: 360_000,
  rentPaid: 300_000,
  isMetroCity: true,
  ltaReceived: 0,
  otherAllowances: 0,
  perquisitesValue: 0,
  exemptHra: 210_000,
  exemptLta: 0,
  exemptOther: 0,
  standardDeduction: 75_000,
  professionalTax: 2_400,
  tdsDeducted: 150_000,
};

describe("salaryIncomeSchema", () => {
  it("accepts a fully valid row", () => {
    expect(salaryIncomeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a numeric-string input rather than silently coercing it", () => {
    // Deliberately NOT z.coerce.number() — see lib/validation/shared.ts's
    // `money()` comment: coercion breaks zodResolver's type inference, and
    // React Hook Form's own `valueAsNumber: true` register option already
    // converts the DOM string to a real number before Zod ever sees it, so
    // by the time this schema runs, the value is always already a number.
    const result = salaryIncomeSchema.safeParse({ ...valid, grossSalary: "1800000" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing employer name", () => {
    expect(salaryIncomeSchema.safeParse({ ...valid, employerName: "" }).success).toBe(false);
  });

  it("rejects a negative gross salary", () => {
    expect(salaryIncomeSchema.safeParse({ ...valid, grossSalary: -1 }).success).toBe(false);
  });

  it("accepts a zero gross salary (edge case, e.g. unpaid leave year)", () => {
    expect(salaryIncomeSchema.safeParse({ ...valid, grossSalary: 0 }).success).toBe(true);
  });

  it("rejects a non-numeric amount", () => {
    expect(salaryIncomeSchema.safeParse({ ...valid, grossSalary: "not-a-number" }).success).toBe(false);
  });

  it("rejects a missing isMetroCity boolean", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.isMetroCity;
    expect(salaryIncomeSchema.safeParse(rest).success).toBe(false);
  });
});
