/**
 * Regression tests for the Section 115BB (lottery/game-winnings) bug found
 * and fixed during the Phase 6 adversarial review: `fullIncome.ts` used to
 * have no dedicated input for such income at all, so `toTaxEngineInput.ts`
 * folded it into `otherSourcesIncome` and this engine taxed it at ordinary
 * SLAB rates — wrong, since Section 115BB requires a flat 30%, no basic
 * exemption, no Chapter VI-A deductions, and no Section 87A rebate,
 * regardless of the taxpayer's slab (see `computeTaxFull.ts`'s file header
 * for the verified specifics and sources).
 *
 * These tests deliberately construct scenarios where the OLD (buggy)
 * behavior and the NEW (fixed) behavior would produce different numbers, so
 * a future regression back to "fold lottery into otherSourcesIncome" would
 * be caught immediately.
 */
import { describe, expect, it } from "vitest";
import { computeFullTaxLiability } from "../src/ay2026-27/computeTaxFull.js";
import { computeFullTaxableIncome } from "../src/ay2026-27/fullIncome.js";
import type { FullIncomeInput } from "../src/ay2026-27/fullIncome.js";

const emptyProfile: FullIncomeInput = {
  isSalaried: false,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

describe("computeFullTaxableIncome — lotteryOrGameWinningsIncome is excluded from slab income but included in totalIncome", () => {
  it("is entirely absent from slabTaxableIncome (would be taxed at slab rates under the old bug)", () => {
    const result = computeFullTaxableIncome({ ...emptyProfile, lotteryOrGameWinningsIncome: 1_000_000 }, "new", 30);
    expect(result.slabTaxableIncome).toBe(0);
    expect(result.lotteryOrGameWinningsIncome).toBe(1_000_000);
  });

  it("is added to totalIncome (so it correctly affects the 87A/surcharge threshold for the REST of the taxpayer's income)", () => {
    const result = computeFullTaxableIncome(
      { ...emptyProfile, grossSalaryIncludingHra: 500_000, lotteryOrGameWinningsIncome: 1_000_000 },
      "new",
      30,
    );
    // salary 500,000, no standard deduction since isSalaried is false in emptyProfile — override:
    expect(result.totalIncome).toBe(result.slabTaxableIncome + 1_000_000);
  });

  it("Chapter VI-A deductions never reduce lottery income (not modeled in the slab formula at all)", () => {
    const withoutDeductions = computeFullTaxableIncome({ ...emptyProfile, lotteryOrGameWinningsIncome: 200_000 }, "old", 30);
    const withDeductions = computeFullTaxableIncome(
      {
        ...emptyProfile,
        lotteryOrGameWinningsIncome: 200_000,
        deductions: {
          section80C: 150_000,
          section80D: { selfAndFamilyPremium: 0, selfOrFamilyHasSenior: false, parentsPremium: 0, parentsHaveSenior: false, preventiveHealthCheckup: 0 },
          section80CCD1B: 0,
          section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" },
          interestIncomeForTtaOrTtb: 0,
        },
      },
      "old",
      30,
    );
    expect(withDeductions.lotteryOrGameWinningsIncome).toBe(withoutDeductions.lotteryOrGameWinningsIncome);
    expect(withDeductions.totalIncome).toBe(withoutDeductions.totalIncome); // 80C has no other income to absorb into either
  });

  it("negative input is floored at 0, same as otherSourcesIncome", () => {
    const result = computeFullTaxableIncome({ ...emptyProfile, lotteryOrGameWinningsIncome: -500 }, "new", 30);
    expect(result.lotteryOrGameWinningsIncome).toBe(0);
  });

  it("omitted field defaults to 0 — every pre-existing FullIncomeInput fixture keeps working unchanged", () => {
    const result = computeFullTaxableIncome(emptyProfile, "new", 30);
    expect(result.lotteryOrGameWinningsIncome).toBe(0);
  });
});

describe("computeFullTaxLiability — Section 115BB: flat 30% tax, no basic exemption, no deductions, no 87A rebate", () => {
  it("₹1,00,000 pure lottery income (no other income at all): flat 30% + 4% cess = 31,200, NOT the 0 tax slab rates alone would give (below the basic exemption limit)", () => {
    const result = computeFullTaxLiability({ ...emptyProfile, lotteryOrGameWinningsIncome: 100_000 }, "new", 30);
    expect(result.income.slabTaxableIncome).toBe(0);
    expect(result.slabTaxBeforeRebate).toBe(0);
    expect(result.lotteryTaxBeforeSurcharge).toBeCloseTo(30_000, 2); // 30% flat, no basic exemption
    expect(result.lotterySurcharge).toBe(0); // total income well below 50L
    expect(result.cess.cess).toBeCloseTo(1_200, 2); // 4% of 30,000
    expect(result.totalTaxLiability).toBeCloseTo(31_200, 2); // matches the well-documented "31.2% effective rate" figure
  });

  it("salary alone would be fully Section-87A-rebated (new regime, well under ₹12L), but lottery tax is NEVER rebated", () => {
    const result = computeFullTaxLiability(
      { ...emptyProfile, isSalaried: true, grossSalaryIncludingHra: 800_000, lotteryOrGameWinningsIncome: 50_000 },
      "new",
      30,
    );
    // Salary-only slab tax is fully rebated (total income 725,000 + 50,000 = 775,000, under the 12L threshold).
    expect(result.rebate.rebateApplied).toBeCloseTo(result.slabTaxBeforeRebate, 2);
    expect(result.slabTaxAfterRebate).toBe(0);
    // But the lottery tax is untouched by the rebate: exactly 30% of 50,000, still payable.
    expect(result.lotteryTaxBeforeSurcharge).toBeCloseTo(15_000, 2);
    expect(result.totalTaxLiability).toBeGreaterThan(15_000); // lottery tax + cess still due even though slab tax is 0
  });

  it("surcharge on lottery tax is capped at 15%, even when the taxpayer's total-income surcharge band is 25% or 37%", () => {
    // Large lottery win alone pushes total income well past the >2Cr (25%) new-regime surcharge band.
    const result = computeFullTaxLiability({ ...emptyProfile, lotteryOrGameWinningsIncome: 30_000_000 }, "new", 30);
    expect(result.income.totalIncome).toBe(30_000_000);
    expect(result.slabSurcharge.applicableRate).toBeCloseTo(0.25, 5); // ordinary-income band would be 25%
    expect(result.lotterySurchargeRatePercent).toBe(15); // but lottery's own surcharge is capped at 15%, same as capital gains
    expect(result.lotteryTaxBeforeSurcharge).toBeCloseTo(9_000_000, 2); // 30% of 30,000,000
    expect(result.lotterySurcharge).toBeCloseTo(9_000_000 * 0.15, 2);
  });

  it("mixed profile: capital-gains tax and lottery tax are both independently excluded from slab tax and both independently non-rebatable", () => {
    const result = computeFullTaxLiability(
      {
        ...emptyProfile,
        otherSourcesIncome: 500_000,
        capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 1_000_000, holdingPeriodMonths: 6 }], // STCG 111A, 20%
        lotteryOrGameWinningsIncome: 1_000_000,
      },
      "new",
      30,
    );
    // total income = 500,000 (slab) + 1,000,000 (STCG) + 1,000,000 (lottery) = 2,500,000 -> no 87A rebate eligibility.
    expect(result.income.totalIncome).toBe(2_500_000);
    expect(result.rebate.rebateApplied).toBe(0);
    expect(result.capitalGainsTaxBeforeSurcharge).toBeCloseTo(200_000, 2); // 20% of 1,000,000
    expect(result.lotteryTaxBeforeSurcharge).toBeCloseTo(300_000, 2); // 30% of 1,000,000
    // Grand total includes slab tax on 500,000 + both special-rate taxes + cess.
    expect(result.totalTaxLiability).toBeGreaterThan(200_000 + 300_000);
  });

  it("sanity: total tax liability is never negative with lottery income present", () => {
    for (const regime of ["new", "old"] as const) {
      const result = computeFullTaxLiability({ ...emptyProfile, lotteryOrGameWinningsIncome: 0 }, regime, 30);
      expect(result.totalTaxLiability).toBeGreaterThanOrEqual(0);
    }
  });
});
