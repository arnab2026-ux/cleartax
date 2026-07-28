import { describe, expect, it } from "vitest";
import { computeCapitalGains } from "../src/ay2026-27/capitalGains.js";
import { computeFullTaxLiability } from "../src/ay2026-27/computeTaxFull.js";
import type { FullIncomeInput } from "../src/ay2026-27/fullIncome.js";

/**
 * Adversarial review pass on Phase 2 (2026-07-28). See PROGRESS.md's "Phase
 * 2 adversarial review" section for the full writeup. This file pins:
 *  1. A regression test for a genuine bug found and fixed in this pass
 *     (grandfathered-property indexation gain leaking the wrong amount into
 *     "total income").
 *  2. A concrete, hand-verified counterexample attempt confirming the
 *     inter-bucket capital-loss claim in capitalGains.ts's file header
 *     ("conservative — never understates tax") actually holds.
 *  3. Boundary/edge cases around the combined slab+capital-gains orchestrator
 *     that weren't already covered by computeTaxFull.test.ts.
 */

const emptyProfile: FullIncomeInput = {
  isSalaried: false,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

describe("BUG FIX regression: grandfathered-property indexed gain must feed totalSpecialRateTaxableIncome, not the raw gain", () => {
  it("when the 20%-with-indexation method is cheaper and used, totalSpecialRateTaxableIncome reflects the INDEXED gain (500,000), not the raw pre-indexation gain (1,000,000)", () => {
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: true,
        indexedGainAmount: 500_000,
      },
    ]);
    // Tax itself was already correct before the fix: 500,000 * 20% = 100,000.
    expect(result.ltcgOtherTax).toBeCloseTo(100_000, 2);
    expect(result.perTransaction[0]?.indexationOptionUsed).toBe("withIndexation20%");
    // This is what was wrong pre-fix: it used to report 1,000,000 here
    // (the raw gain) even though only 500,000 was actually taxed — a
    // 500,000 overstatement of "total income" that could wrongly push a
    // taxpayer over the Section 87A ₹12L threshold or into a higher
    // surcharge band than their real taxable income supports.
    expect(result.ltcgOtherTaxableGainEquivalent).toBe(500_000);
  });

  it("when the 12.5%-no-indexation method is cheaper (or chosen by default), taxableGainEquivalent uses the raw gain, matching the tax base", () => {
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: true,
        indexedGainAmount: 900_000, // with-indexation would be MORE tax (180,000 > 125,000), so no-indexation wins
      },
    ]);
    expect(result.perTransaction[0]?.indexationOptionUsed).toBe("noIndexation12.5%");
    expect(result.ltcgOtherTaxableGainEquivalent).toBe(1_000_000);
  });

  it("end-to-end: this bug could flip Section 87A rebate eligibility for a mixed slab+CG taxpayer near the ₹12L threshold", () => {
    // Slab income 11,00,000 (below 12L alone -> would be fully rebated).
    // One grandfathered property sale where indexation is cheaper: raw gain
    // 1,000,000, indexed gain 400,000 -> tax at 20% = 80,000 (vs 125,000 at
    // 12.5% no-indexation, so indexation wins).
    // Correct totalIncome = 11,00,000 + 400,000 = 15,00,000 (still > 12L,
    // so no rebate either way in THIS example) — pick a case where the
    // difference between using 400,000 vs 1,000,000 actually flips the
    // ₹12L eligibility test instead.
    // Explicit construction: slab income exactly 8,00,000 (well
    // under 12L on its own). Grandfathered property: raw gain 5,00,000,
    // indexed gain 3,00,000 (indexation cheaper: 60,000 vs 62,500).
    // Correct totalIncome = 8,00,000 + 3,00,000 = 11,00,000 (<=12L -> rebate
    // eligible for the slab portion). Pre-fix, totalIncome would have been
    // computed as 8,00,000 + 5,00,000(raw) = 13,00,000 (>12L -> incorrectly
    // DENIED rebate eligibility on the slab portion).
    const fixedProfile: FullIncomeInput = {
      ...emptyProfile,
      otherSourcesIncome: 800_000,
      capitalGainTransactions: [
        {
          assetType: "immovableProperty",
          gainAmount: 500_000,
          holdingPeriodMonths: 60,
          acquiredBeforeRegimeChange: true,
          indexedGainAmount: 300_000,
        },
      ],
    };
    const result = computeFullTaxLiability(fixedProfile, "new", 40);
    expect(result.income.totalIncome).toBe(1_100_000); // correct, post-fix
    expect(result.income.totalIncome).toBeLessThanOrEqual(1_200_000);
    // Slab tax on 8,00,000 (new regime: 0 to 4L nil, 4-8L @5% = 20,000)
    // should be fully rebated since total income is within the 12L threshold.
    expect(result.slabTaxBeforeRebate).toBeCloseTo(20_000, 2);
    expect(result.rebate.rebateApplied).toBeCloseTo(20_000, 2);
    expect(result.slabTaxAfterRebate).toBe(0);
    // The property's LTCG tax itself (60,000, from the indexed/20% method)
    // is still fully payable and never rebated.
    expect(result.capitalGainsTaxBeforeSurcharge).toBeCloseTo(60_000, 2);
  });
});

describe("Inter-bucket capital-loss set-off simplification: confirm it can only OVERSTATE tax, never understate (attempted counterexample)", () => {
  it("STCG-equity loss + LTCG-other gain: real law (Section 70(2)) would let the STCL offset the LTCG, but this module doesn't — code output must be >= the correctly-netted figure", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: -300_000, holdingPeriodMonths: 3 }, // STCL, equity
      { assetType: "gold", gainAmount: 500_000, holdingPeriodMonths: 30 }, // LTCG, other (Section 112)
    ]);
    // Code (independent buckets): STCG-equity loss discarded (floored to 0,
    // tax 0); LTCG-other gain taxed in full at 12.5%.
    expect(result.stcgEquityTax).toBe(0);
    expect(result.ltcgOtherTax).toBeCloseTo(62_500, 2); // 500,000 * 12.5%
    const codeTotalTax = result.stcgEquityTax + result.ltcgOtherTax;

    // Correctly netted (what the law actually allows): STCL 300,000 offsets
    // the LTCG gain first -> net LTCG-other = 500,000 - 300,000 = 200,000,
    // taxed at 12.5% = 25,000. Nothing else payable.
    const correctlyNettedTax = 200_000 * 0.125;

    expect(codeTotalTax).toBeGreaterThan(correctlyNettedTax); // overstates, as documented
    expect(codeTotalTax).toBeCloseTo(62_500, 2);
    expect(correctlyNettedTax).toBeCloseTo(25_000, 2);
  });

  it("LTCG-equity loss + STCG-equity gain: real law (Section 70(3)) does NOT allow a long-term loss to offset a short-term gain, so independent-bucket flooring matches correct law exactly here (no overstatement, no understatement)", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: -400_000, holdingPeriodMonths: 24 }, // LTCL, equity
      { assetType: "listedEquityOrEquityMF", gainAmount: 200_000, holdingPeriodMonths: 3 }, // STCG, equity
    ]);
    expect(result.ltcgEquityTax).toBe(0); // loss floored, no exemption interaction issue
    expect(result.stcgEquityTax).toBeCloseTo(40_000, 2); // 200,000 * 20%, fully taxed — correct, LTCL can't touch it
  });

  it("STCG-other (slab-rate) loss + LTCG-equity gain: loss is silently discarded rather than reducing the LTCG-equity taxable gain — overstates, confirming the documented direction", () => {
    const result = computeCapitalGains([
      { assetType: "gold", gainAmount: -200_000, holdingPeriodMonths: 6 }, // STCL, other (slab-rate bucket)
      { assetType: "listedEquityOrEquityMF", gainAmount: 500_000, holdingPeriodMonths: 24 }, // LTCG-equity
    ]);
    // The STCG-other bucket floors its own net loss to 0 and contributes
    // NOTHING to slab-rate income (correct — it shouldn't reduce salary
    // income either way, Section 71(3) blocks capital losses from offsetting
    // other heads) — but it also fails to reduce the LTCG-equity gain,
    // which real law (Section 70(2)) would allow.
    expect(result.stcgOtherSlabRateIncome).toBe(0);
    expect(result.ltcgEquityTaxableGain).toBe(375_000); // 500,000 - 125,000 exemption, unreduced by the 200,000 loss
    const codeTax = result.ltcgEquityTax;
    const correctlyNettedTaxableGain = Math.max(0, 500_000 - 200_000 - 125_000); // 175,000
    const correctlyNettedTax = correctlyNettedTaxableGain * 0.125;
    expect(codeTax).toBeGreaterThan(correctlyNettedTax);
  });
});

describe("Self-occupied home-loan-interest 30,000 cap (not modeled) — quantify the understatement risk", () => {
  it("a loan that should be capped at 30,000 (e.g. renovation loan) instead gets the full 2,00,000 cap applied by this module — this UNDERSTATES tax owed, the dangerous direction for a filing tool", () => {
    const profile: FullIncomeInput = {
      ...emptyProfile,
      isSalaried: true,
      grossSalaryIncludingHra: 1_500_000,
      houseProperties: [{ type: "selfOccupied", homeLoanInterestPaid: 180_000 }],
    };
    const result = computeFullTaxLiability(profile, "old", 35);
    // This module allows the full 180,000 (under the 2,00,000 cap) as a
    // deduction. If this loan were actually a renovation loan (correct cap
    // 30,000 per Section 24(b) proviso), only 30,000 should be deductible —
    // 150,000 more taxable income than this module computes, understating
    // liability. Flagged in PROGRESS.md; not fixed (would need a new input
    // field — loan purpose / construction-completion timing — that the
    // Phase 2 brief scoped out). This test exists to make the magnitude of
    // the risk explicit rather than leave it as an abstract caveat.
    expect(result.income.houseProperty.properties[0]?.interestDeductionAllowed).toBe(180_000);
    const correctDeductionIfRenovationLoan = Math.min(180_000, 30_000);
    expect(correctDeductionIfRenovationLoan).toBe(30_000);
    expect(result.income.houseProperty.properties[0]?.interestDeductionAllowed).toBeGreaterThan(
      correctDeductionIfRenovationLoan,
    );
  });
});

describe("Regime-zeroing wiring, end-to-end through the full orchestrator (not just the individual module)", () => {
  it("every old-regime-only input (HRA, self-occupied interest, house-property loss set-off, 80C/80D/80CCD1B/80TTA/80TTB) is zero under the new regime when routed through computeFullTaxLiability", () => {
    const profile: FullIncomeInput = {
      isSalaried: true,
      grossSalaryIncludingHra: 2_000_000,
      hra: { basicSalary: 900_000, hraReceived: 300_000, rentPaid: 400_000, isMetro: true },
      houseProperties: [
        { type: "selfOccupied", homeLoanInterestPaid: 250_000 },
        { type: "letOut", annualRentReceived: 200_000, municipalTaxesPaid: 5_000, homeLoanInterestPaid: 600_000 },
      ],
      capitalGainTransactions: [],
      otherSourcesIncome: 60_000,
      deductions: {
        section80C: 150_000,
        section80D: {
          selfAndFamilyPremium: 25_000,
          selfOrFamilyHasSenior: false,
          parentsPremium: 25_000,
          parentsHaveSenior: false,
          preventiveHealthCheckup: 5_000,
        },
        section80CCD1B: 50_000,
        section80CCD2: { employerContribution: 100_000, salary: 1_000_000, employmentType: "other" },
        interestIncomeForTtaOrTtb: 15_000,
      },
    };
    const result = computeFullTaxLiability(profile, "new", 45);
    expect(result.income.hra?.exemptHra).toBe(0);
    expect(result.income.houseProperty.properties[0]?.interestDeductionAllowed).toBe(0); // self-occupied, new regime
    expect(result.income.houseProperty.lossSetOffAgainstOtherHeads).toBe(0); // inter-head set-off blocked, new regime
    expect(result.income.deductions.section80C).toBe(0);
    expect(result.income.deductions.section80D).toBe(0);
    expect(result.income.deductions.section80CCD1B).toBe(0);
    expect(result.income.deductions.section80TTA).toBe(0);
    expect(result.income.deductions.section80TTB).toBe(0);
    // 80CCD(2) survives both regimes.
    expect(result.income.deductions.section80CCD2).toBeGreaterThan(0);
    // Let-out property interest stays uncapped even under the new regime.
    expect(result.income.houseProperty.properties[1]?.interestDeductionAllowed).toBe(600_000);
  });
});

describe("Section 87A rebate eligibility boundary when capital gains push total income across the ₹12L threshold, at ±1 rupee", () => {
  it("total income exactly 12,00,000 (slab + CG combined): still eligible for full rebate", () => {
    const profile: FullIncomeInput = {
      ...emptyProfile,
      otherSourcesIncome: 1_100_000,
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 225_000, holdingPeriodMonths: 24 }, // taxable LTCG = 225,000-125,000=100,000 -> totalIncome = 1,100,000+100,000=1,200,000
      ],
    };
    const result = computeFullTaxLiability(profile, "new", 30);
    expect(result.income.totalIncome).toBe(1_200_000);
    expect(result.rebate.marginalReliefApplied).toBe(0);
    // Slab tax on 1,100,000 = 20,000(4-8L) + 30,000(8-11L) = 50,000, fully rebated (under 60,000 cap).
    expect(result.slabTaxAfterRebate).toBe(0);
  });

  it("total income at 12,00,001 (1 rupee over, via CG): marginal relief kicks in for the slab portion only", () => {
    const profile: FullIncomeInput = {
      ...emptyProfile,
      otherSourcesIncome: 1_100_000,
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 225_001, holdingPeriodMonths: 24 },
      ],
    };
    const result = computeFullTaxLiability(profile, "new", 30);
    expect(result.income.totalIncome).toBe(1_200_001);
    // excessIncome = 1, slabTaxBeforeRebate = 50,000 > 1 -> relief caps slab tax at 1.
    expect(result.slabTaxAfterRebate).toBeCloseTo(1, 2);
    expect(result.capitalGainsTaxBeforeSurcharge).toBeCloseTo(100_001 * 0.125, 2); // CG tax itself untouched by relief
  });
});
