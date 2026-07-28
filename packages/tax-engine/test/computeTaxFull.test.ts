import { describe, expect, it } from "vitest";
import { computeFullTaxLiability } from "../src/ay2026-27/computeTaxFull.js";
import { computeTaxFromTaxableIncome } from "../src/ay2026-27/computeTax.js";
import type { FullIncomeInput } from "../src/ay2026-27/fullIncome.js";

const emptyProfile: FullIncomeInput = {
  isSalaried: true,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

describe("computeFullTaxLiability — reduces to the Phase 1 orchestrator when there are no capital gains", () => {
  it("₹15L salary, new regime: matches computeTaxFromTaxableIncome exactly (₹97,500, per Phase 1's independently-verified figure)", () => {
    const full = computeFullTaxLiability({ ...emptyProfile, grossSalaryIncludingHra: 1_500_000 }, "new", 35);
    const phase1 = computeTaxFromTaxableIncome(1_425_000, "new", 35);
    expect(full.income.slabTaxableIncome).toBe(1_425_000);
    expect(full.totalTaxLiability).toBeCloseTo(phase1.totalTaxLiability, 2);
    expect(full.totalTaxLiabilityRounded).toBe(phase1.totalTaxLiabilityRounded);
    expect(full.totalTaxLiability).toBeCloseTo(97_500, 2);
  });

  it("₹60L salary + ₹5L other income, old regime, senior citizen: matches Phase 1 surcharge scenario", () => {
    const full = computeFullTaxLiability(
      { ...emptyProfile, grossSalaryIncludingHra: 6_000_000, otherSourcesIncome: 500_000 },
      "old",
      65,
    );
    const phase1 = computeTaxFromTaxableIncome(6_450_000, "old", 65);
    expect(full.totalTaxLiability).toBeCloseTo(phase1.totalTaxLiability, 2);
    expect(full.slabSurcharge.applicableRate).toBeCloseTo(0.1, 5);
  });
});

describe("computeFullTaxLiability — full mixed profile (salary + let-out property + equity LTCG + deductions)", () => {
  const profile: FullIncomeInput = {
    isSalaried: true,
    grossSalaryIncludingHra: 1_000_000,
    hra: { basicSalary: 600_000, hraReceived: 200_000, rentPaid: 240_000, isMetro: true },
    houseProperties: [
      { type: "letOut", annualRentReceived: 300_000, municipalTaxesPaid: 10_000, homeLoanInterestPaid: 150_000 },
    ],
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

  it("old regime: hand-derived — slab income 693,000 -> tax 51,100 -> cess 2,044 -> total 53,144 (rounded 53,140)", () => {
    const result = computeFullTaxLiability(profile, "old", 30);
    expect(result.income.slabTaxableIncome).toBe(693_000);
    expect(result.slabTaxBeforeRebate).toBeCloseTo(51_100, 2);
    expect(result.rebate.rebateApplied).toBe(0); // above the 5L old-regime threshold
    expect(result.slabSurcharge.applicableRate).toBe(0); // well below 50L
    expect(result.cess.cess).toBeCloseTo(2_044, 2);
    expect(result.totalTaxLiability).toBeCloseTo(53_144, 2);
    expect(result.totalTaxLiabilityRounded).toBe(53_140);
  });

  it("new regime: same profile lands at 0 tax (HRA/80C/80D dropped, but slab income stays under the 12L rebate threshold)", () => {
    const result = computeFullTaxLiability(profile, "new", 30);
    expect(result.income.slabTaxableIncome).toBe(1_028_000);
    expect(result.slabTaxBeforeRebate).toBeCloseTo(42_800, 2);
    expect(result.rebate.rebateApplied).toBeCloseTo(42_800, 2); // full rebate, under 12L
    expect(result.totalTaxLiability).toBe(0);
  });
});

describe("computeFullTaxLiability — capital-gains tax + the 15% surcharge cap (Sections 111A/112/112A)", () => {
  it("large LTCG-equity gain pushes total income into the new regime's 25% surcharge band, but CG surcharge is capped at 15%", () => {
    const profile: FullIncomeInput = {
      isSalaried: false,
      grossSalaryIncludingHra: 0,
      houseProperties: [],
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 25_000_000, holdingPeriodMonths: 24 },
      ],
      otherSourcesIncome: 100_000,
    };
    const result = computeFullTaxLiability(profile, "new", 40);

    // total income = 100,000 (slab) + (25,000,000 - 125,000 exemption) = 24,975,000 -> in the >2Cr band (25%)
    expect(result.income.totalIncome).toBe(24_975_000);
    expect(result.slabSurcharge.applicableRate).toBeCloseTo(0.25, 5);

    // Capital-gains tax: 24,875,000 * 12.5% = 3,109,375
    expect(result.capitalGainsTaxBeforeSurcharge).toBeCloseTo(3_109_375, 2);
    // Surcharge on that tax is capped at 15%, NOT the 25% band rate that applies to ordinary income.
    expect(result.capitalGainsSurchargeRatePercent).toBe(15);
    expect(result.capitalGainsSurcharge).toBeCloseTo(3_109_375 * 0.15, 2);
  });

  it("modest total income (well below 50L): capital-gains surcharge is 0, same as the ordinary-income band", () => {
    const profile: FullIncomeInput = {
      isSalaried: false,
      grossSalaryIncludingHra: 0,
      houseProperties: [],
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 500_000, holdingPeriodMonths: 24 },
      ],
      otherSourcesIncome: 300_000,
    };
    const result = computeFullTaxLiability(profile, "new", 40);
    expect(result.slabSurcharge.applicableRate).toBe(0);
    expect(result.capitalGainsSurchargeRatePercent).toBe(0);
    expect(result.capitalGainsSurcharge).toBe(0);
  });
});

describe("computeFullTaxLiability — Section 87A rebate never offsets capital-gains tax", () => {
  it("slab income alone (5L) would fully qualify for the new-regime rebate, but CG pushes total income past 12L, so no rebate on either component", () => {
    const withoutCg = computeFullTaxLiability(
      {
        isSalaried: false,
        grossSalaryIncludingHra: 0,
        houseProperties: [],
        capitalGainTransactions: [],
        otherSourcesIncome: 500_000,
      },
      "new",
      30,
    );
    // Sanity check: without any capital gains, 5L slab income is fully rebated under the new regime.
    expect(withoutCg.totalTaxLiability).toBe(0);

    const withCg = computeFullTaxLiability(
      {
        isSalaried: false,
        grossSalaryIncludingHra: 0,
        houseProperties: [],
        capitalGainTransactions: [
          { assetType: "listedEquityOrEquityMF", gainAmount: 1_000_000, holdingPeriodMonths: 6 }, // STCG 111A
        ],
        otherSourcesIncome: 500_000,
      },
      "new",
      30,
    );
    // total income = 500,000 + 1,000,000 = 1,500,000 > 12,00,000 -> no rebate eligibility at all.
    expect(withCg.income.totalIncome).toBe(1_500_000);
    expect(withCg.rebate.rebateApplied).toBe(0);
    expect(withCg.rebate.marginalReliefApplied).toBe(0);
    // Slab tax on the 5L portion (400,000-500,000 @ 5% = 5,000) is still payable in full.
    expect(withCg.slabTaxBeforeRebate).toBeCloseTo(5_000, 2);
    expect(withCg.slabTaxAfterRebate).toBeCloseTo(5_000, 2);
    // Plus the full 20% STCG-equity tax on 1,000,000 = 200,000, un-rebated.
    expect(withCg.capitalGainsTaxBeforeSurcharge).toBeCloseTo(200_000, 2);
  });
});

describe("computeFullTaxLiability — sanity invariants", () => {
  it("total tax liability is never negative across a range of profiles", () => {
    const profiles: FullIncomeInput[] = [
      { ...emptyProfile },
      { ...emptyProfile, grossSalaryIncludingHra: 100 },
      {
        ...emptyProfile,
        capitalGainTransactions: [{ assetType: "gold", gainAmount: -100_000, holdingPeriodMonths: 30 }],
      },
    ];
    for (const profile of profiles) {
      for (const regime of ["new", "old"] as const) {
        const result = computeFullTaxLiability(profile, regime, 30);
        expect(result.totalTaxLiability).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
