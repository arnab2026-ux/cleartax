import { describe, expect, it } from "vitest";
import { computeTaxFromTaxableIncome } from "../src/ay2026-27/computeTax.js";
import { computeTaxableIncomePhase1 } from "../src/ay2026-27/income.js";
import { roundToNearestTen } from "../src/ay2026-27/rounding.js";

describe("Section 288B rounding helper", () => {
  it("matches the charteredclub.com worked example: 62,923.25 -> 62,920", () => {
    expect(roundToNearestTen(62_923.25)).toBe(62_920);
  });

  it("rounds up when the last digit is 5 or more", () => {
    expect(roundToNearestTen(125)).toBe(130);
    expect(roundToNearestTen(124.99)).toBe(120);
  });

  it("is a no-op on exact multiples of 10", () => {
    expect(roundToNearestTen(97_500)).toBe(97_500);
  });
});

describe("computeTaxFromTaxableIncome — 87A rebate cliffs end-to-end", () => {
  it("new regime: taxable income exactly 12,00,000 -> total liability 0", () => {
    const result = computeTaxFromTaxableIncome(1_200_000, "new", 30);
    expect(result.totalTaxLiability).toBe(0);
    expect(result.totalTaxLiabilityRounded).toBe(0);
  });

  it("new regime: taxable income 12,00,001 -> tiny liability via marginal relief, then cess", () => {
    const result = computeTaxFromTaxableIncome(1_200_001, "new", 30);
    // taxAfterRebate is capped at ~1 rupee by marginal relief; cess is 4% of that.
    expect(result.taxAfterRebate).toBeCloseTo(1, 2);
    expect(result.totalTaxLiability).toBeCloseTo(1.04, 2);
  });

  it("old regime, below60: taxable income exactly 5,00,000 -> total liability 0", () => {
    const result = computeTaxFromTaxableIncome(500_000, "old", 30);
    expect(result.totalTaxLiability).toBe(0);
  });

  it("old regime, below60: taxable income 5,00,001 -> hard cliff, no relief, real tax + cess", () => {
    const result = computeTaxFromTaxableIncome(500_001, "old", 30);
    expect(result.rebate.rebateApplied).toBe(0);
    expect(result.rebate.marginalReliefApplied).toBe(0);
    expect(result.taxAfterRebate).toBeCloseTo(12_500.2, 2);
    expect(result.totalTaxLiability).toBeCloseTo(13_000.21, 2); // 12,500.20 * 1.04
  });
});

describe("computeTaxFromTaxableIncome — end-to-end scenarios, new regime", () => {
  it("₹15L gross salary, age 35: matches independently published figure of ₹97,500", () => {
    const income = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 1_500_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(1_425_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "new", 35);
    expect(result.taxBeforeRebate).toBeCloseTo(93_750, 2);
    expect(result.rebate.rebateApplied).toBe(0); // above 12L threshold
    expect(result.surcharge.applicableRate).toBe(0); // well below 50L
    expect(result.cess.cess).toBeCloseTo(3_750, 2);
    expect(result.totalTaxLiability).toBeCloseTo(97_500, 2);
    expect(result.totalTaxLiabilityRounded).toBe(97_500);
  });

  it("₹60L gross salary + ₹5L other income, age 40: full pipeline incl. 10% surcharge band", () => {
    const income = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 6_000_000,
      otherSourcesIncome: 500_000,
    });
    expect(income.taxableIncome).toBe(6_425_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "new", 40);
    expect(result.taxBeforeRebate).toBeCloseTo(1_507_500, 2);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.1, 5);
    expect(result.surcharge.marginalReliefApplied).toBe(0);
    expect(result.taxPlusSurchargeAfterRelief).toBeCloseTo(1_658_250, 2);
    expect(result.cess.cess).toBeCloseTo(66_330, 2);
    expect(result.totalTaxLiability).toBeCloseTo(1_724_580, 2);
  });

  it("₹1.5Cr gross salary, age 45: 15% surcharge band", () => {
    const income = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 15_000_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(14_925_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "new", 45);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.15, 5);
    expect(result.totalTaxLiability).toBeCloseTo(4_852_770, 2);
  });

  it("₹6Cr gross salary, age 50: surcharge capped at 25% even past 5Cr", () => {
    const income = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 60_000_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(59_925_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "new", 50);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.25, 5);
    expect(result.totalTaxLiability).toBeCloseTo(22_824_750, 2);
  });
});

describe("computeTaxFromTaxableIncome — end-to-end scenarios, old regime", () => {
  it("₹15L gross salary, age 35 (below60): no rebate, no surcharge", () => {
    const income = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 1_500_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(1_450_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "old", 35);
    expect(result.taxBeforeRebate).toBeCloseTo(247_500, 2);
    expect(result.rebate.rebateApplied).toBe(0);
    expect(result.totalTaxLiability).toBeCloseTo(257_400, 2);
  });

  it("₹60L gross salary + ₹5L other income, age 65 (senior): 10% surcharge band", () => {
    const income = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 6_000_000,
      otherSourcesIncome: 500_000,
    });
    expect(income.taxableIncome).toBe(6_450_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "old", 65);
    expect(result.taxBeforeRebate).toBeCloseTo(1_745_000, 2);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.1, 5);
    expect(result.totalTaxLiability).toBeCloseTo(1_996_280, 2);
  });

  it("₹1.5Cr gross salary, age 82 (superSenior): 15% surcharge band", () => {
    const income = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 15_000_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(14_950_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "old", 82);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.15, 5);
    expect(result.totalTaxLiability).toBeCloseTo(5_124_860, 2);
  });

  it("₹6Cr gross salary, age 45 (below60): surcharge steps to 37% past 5Cr — no cap", () => {
    const income = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 60_000_000,
      otherSourcesIncome: 0,
    });
    expect(income.taxableIncome).toBe(59_950_000);

    const result = computeTaxFromTaxableIncome(income.taxableIncome, "old", 45);
    expect(result.surcharge.applicableRate).toBeCloseTo(0.37, 5);
    expect(result.totalTaxLiability).toBeCloseTo(25_357_878, 2);
    expect(result.totalTaxLiabilityRounded).toBe(25_357_880);
  });
});

describe("old-vs-new regime surcharge divergence at ₹6Cr (the well-known bug source)", () => {
  it("same ₹6Cr salary: old regime pays materially more than new regime due to 37% vs 25% cap", () => {
    const oldIncome = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 60_000_000,
      otherSourcesIncome: 0,
    });
    const newIncome = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 60_000_000,
      otherSourcesIncome: 0,
    });

    const oldResult = computeTaxFromTaxableIncome(oldIncome.taxableIncome, "old", 45);
    const newResult = computeTaxFromTaxableIncome(newIncome.taxableIncome, "new", 45);

    expect(oldResult.surcharge.applicableRate).toBeCloseTo(0.37, 5);
    expect(newResult.surcharge.applicableRate).toBeCloseTo(0.25, 5);
    expect(oldResult.totalTaxLiability).toBeGreaterThan(newResult.totalTaxLiability);
  });
});

describe("computeTaxFromTaxableIncome — sanity/consistency invariants", () => {
  it("total tax liability is never negative across a range of incomes and ages", () => {
    const incomes = [0, 100, 250_000, 500_000, 1_200_000, 5_000_000, 50_000_000];
    const ages = [25, 62, 85];
    for (const regime of ["new", "old"] as const) {
      for (const income of incomes) {
        for (const age of ages) {
          const result = computeTaxFromTaxableIncome(income, regime, age);
          expect(result.totalTaxLiability).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("marginal relief never lets tax+surcharge exceed cap: taxAfterRebate + surchargeAfterRelief tracks slab tax plus at most the income excess", () => {
    const result = computeTaxFromTaxableIncome(50_00_001, "old", 30);
    expect(result.taxPlusSurchargeAfterRelief).toBeLessThanOrEqual(result.taxBeforeRebate * 1.1 + 1e-6);
  });
});
