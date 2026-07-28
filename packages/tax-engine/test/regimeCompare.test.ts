import { describe, expect, it } from "vitest";
import { compareRegimes } from "../src/ay2026-27/regimeCompare.js";
import type { FullIncomeInput } from "../src/ay2026-27/fullIncome.js";

describe("compareRegimes", () => {
  it("realistic mixed profile: salary + let-out property + equity LTCG + 80C/80D — new regime wins here", () => {
    // Same profile as the hand-derived computeTaxFull.test.ts case, plus a
    // moderate equity LTCG so both special-rate and slab-rate income are
    // exercised end-to-end in one scenario.
    const profile: FullIncomeInput = {
      isSalaried: true,
      grossSalaryIncludingHra: 1_000_000,
      hra: { basicSalary: 600_000, hraReceived: 200_000, rentPaid: 240_000, isMetro: true },
      houseProperties: [
        { type: "letOut", annualRentReceived: 300_000, municipalTaxesPaid: 10_000, homeLoanInterestPaid: 150_000 },
      ],
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 200_000, holdingPeriodMonths: 24 }, // LTCG 112A, under the 1.25L exemption after netting? gain > exemption
      ],
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

    const comparison = compareRegimes(profile, 30);

    // Old regime: same slab income as the hand-derived 693,000 case, PLUS
    // LTCG-equity tax on (200,000 - 125,000) * 12.5% = 9,375, with total
    // income (693,000 + 75,000 taxable LTCG = 768,000) still nowhere near
    // any surcharge threshold, so surcharge is 0 on both components.
    expect(comparison.old.income.slabTaxableIncome).toBe(693_000);
    expect(comparison.old.capitalGainsTaxBeforeSurcharge).toBeCloseTo(9_375, 2);
    expect(comparison.old.totalTaxLiability).toBeCloseTo(53_144 + 9_375 * 1.04, 1);

    // New regime: same slab income as the hand-derived 1,028,000 case (still
    // fully rebated to 0 slab tax), plus the same un-rebated 9,375 LTCG tax.
    expect(comparison.new.income.slabTaxableIncome).toBe(1_028_000);
    expect(comparison.new.slabTaxAfterRebate).toBe(0);
    expect(comparison.new.capitalGainsTaxBeforeSurcharge).toBeCloseTo(9_375, 2);
    expect(comparison.new.totalTaxLiability).toBeCloseTo(9_375 * 1.04, 1);

    // New regime liability is materially lower -> recommended.
    expect(comparison.recommendedRegime).toBe("new");
    expect(comparison.savingsFromRecommendedRegime).toBeGreaterThan(0);
    expect(comparison.savingsFromRecommendedRegime).toBe(
      comparison.old.totalTaxLiabilityRounded - comparison.new.totalTaxLiabilityRounded,
    );
  });

  it("old regime wins when Chapter VI-A deductions are large enough relative to a higher salary with no capital gains", () => {
    // Salary chosen high enough (₹20L) that the new regime's slab income
    // exceeds the ₹12L 87A rebate threshold and so isn't fully wiped out —
    // otherwise the new regime trivially "wins" via rebate at lower incomes
    // regardless of how large the old regime's deductions are.
    const profile: FullIncomeInput = {
      isSalaried: true,
      grossSalaryIncludingHra: 2_000_000,
      hra: { basicSalary: 900_000, hraReceived: 300_000, rentPaid: 350_000, isMetro: true },
      houseProperties: [{ type: "selfOccupied", homeLoanInterestPaid: 200_000 }],
      capitalGainTransactions: [],
      otherSourcesIncome: 0,
      deductions: {
        section80C: 150_000,
        section80D: {
          selfAndFamilyPremium: 25_000,
          selfOrFamilyHasSenior: false,
          parentsPremium: 25_000,
          parentsHaveSenior: false,
          preventiveHealthCheckup: 0,
        },
        section80CCD1B: 50_000,
        section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" },
        interestIncomeForTtaOrTtb: 0,
      },
    };

    const comparison = compareRegimes(profile, 45);
    // Hand-derived: old regime slab income 1,240,000 -> tax 184,500 -> cess
    // 7,380 -> total 191,880. New regime slab income 1,925,000 (no rebate,
    // no relief, above 12L threshold) -> tax 185,000 -> cess 7,400 -> total
    // 192,400. Old regime wins by 520.
    expect(comparison.old.income.slabTaxableIncome).toBe(1_240_000);
    expect(comparison.old.totalTaxLiability).toBeCloseTo(191_880, 2);
    expect(comparison.new.income.slabTaxableIncome).toBe(1_925_000);
    expect(comparison.new.totalTaxLiability).toBeCloseTo(192_400, 2);
    expect(comparison.old.totalTaxLiability).toBeLessThan(comparison.new.totalTaxLiability);
    expect(comparison.recommendedRegime).toBe("old");
  });

  it("ties break toward the old regime (documented, arbitrary tie-break)", () => {
    // Zero income under both regimes: both liabilities are 0, a tie.
    const profile: FullIncomeInput = {
      isSalaried: false,
      grossSalaryIncludingHra: 0,
      houseProperties: [],
      capitalGainTransactions: [],
      otherSourcesIncome: 0,
    };
    const comparison = compareRegimes(profile, 30);
    expect(comparison.old.totalTaxLiabilityRounded).toBe(0);
    expect(comparison.new.totalTaxLiabilityRounded).toBe(0);
    expect(comparison.recommendedRegime).toBe("old");
    expect(comparison.savingsFromRecommendedRegime).toBe(0);
  });
});
