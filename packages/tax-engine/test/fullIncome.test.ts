import { describe, expect, it } from "vitest";
import { computeFullTaxableIncome, type FullIncomeInput } from "../src/ay2026-27/fullIncome.js";

const emptyProfile: FullIncomeInput = {
  isSalaried: true,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

describe("computeFullTaxableIncome — matches Phase 1 income.ts when no Phase 2 heads are used", () => {
  it("salary + other sources only, new regime: same as Phase1's computeTaxableIncomePhase1", () => {
    const result = computeFullTaxableIncome(
      { ...emptyProfile, grossSalaryIncludingHra: 1_500_000, otherSourcesIncome: 0 },
      "new",
      35,
    );
    expect(result.standardDeduction).toBe(75_000);
    expect(result.salaryTaxable).toBe(1_425_000);
    expect(result.slabTaxableIncome).toBe(1_425_000);
    expect(result.totalIncome).toBe(1_425_000);
  });

  it("salary + other sources only, old regime", () => {
    const result = computeFullTaxableIncome(
      { ...emptyProfile, grossSalaryIncludingHra: 1_500_000, otherSourcesIncome: 0 },
      "old",
      35,
    );
    expect(result.standardDeduction).toBe(50_000);
    expect(result.slabTaxableIncome).toBe(1_450_000);
  });
});

describe("computeFullTaxableIncome — HRA reduces salary only under the old regime", () => {
  const hra = { basicSalary: 600_000, hraReceived: 200_000, rentPaid: 240_000, isMetro: true };
  // limb1=200,000; limb2=240,000-60,000=180,000; limb3=50%*600,000=300,000 -> exempt=180,000

  it("old regime: exempt HRA reduces salary before standard deduction", () => {
    const result = computeFullTaxableIncome(
      { ...emptyProfile, grossSalaryIncludingHra: 1_000_000, hra },
      "old",
      30,
    );
    expect(result.hra?.exemptHra).toBe(180_000);
    // salaryAfterHra = 1,000,000 - 180,000 = 820,000; less 50,000 standard deduction = 770,000
    expect(result.salaryTaxable).toBe(770_000);
  });

  it("new regime: HRA exemption is forced to 0 even though hra input is supplied", () => {
    const result = computeFullTaxableIncome(
      { ...emptyProfile, grossSalaryIncludingHra: 1_000_000, hra },
      "new",
      30,
    );
    expect(result.hra?.exemptHra).toBe(0);
    // salaryAfterHra = 1,000,000 - 0 = 1,000,000; less 75,000 standard deduction = 925,000
    expect(result.salaryTaxable).toBe(925_000);
  });
});

describe("computeFullTaxableIncome — full mixed profile", () => {
  const profile: FullIncomeInput = {
    isSalaried: true,
    grossSalaryIncludingHra: 1_000_000,
    hra: { basicSalary: 600_000, hraReceived: 200_000, rentPaid: 240_000, isMetro: true },
    houseProperties: [{ type: "letOut", annualRentReceived: 300_000, municipalTaxesPaid: 10_000, homeLoanInterestPaid: 150_000 }],
    capitalGainTransactions: [],
    otherSourcesIncome: 50_000,
    deductions: {
      section80C: 150_000,
      section80D: {
        selfAndFamilyPremium: 20_000,
        selfOrFamilyHasSenior: false,
        parentsPremium: 0,
        parentsHaveSenior: false,
        preventiveHealthCheckup: 0,
      },
      section80CCD1B: 0,
      section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" },
      interestIncomeForTtaOrTtb: 50_000,
    },
  };

  it("old regime: salary(770,000) + house property(53,000) + other(50,000) - deductions(180,000) = 693,000", () => {
    const result = computeFullTaxableIncome(profile, "old", 30);
    expect(result.salaryTaxable).toBe(770_000);
    expect(result.housePropertyContribution).toBe(53_000);
    expect(result.deductions.totalDeduction).toBe(180_000);
    expect(result.slabTaxableIncome).toBe(693_000);
  });

  it("new regime: HRA/80C/80D/80TTA all zeroed, house property income unchanged", () => {
    const result = computeFullTaxableIncome(profile, "new", 30);
    expect(result.salaryTaxable).toBe(925_000);
    expect(result.housePropertyContribution).toBe(53_000); // let-out treatment identical across regimes
    expect(result.deductions.totalDeduction).toBe(0);
    expect(result.slabTaxableIncome).toBe(1_028_000);
  });
});
