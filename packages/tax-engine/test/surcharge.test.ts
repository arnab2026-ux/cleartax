import { describe, expect, it } from "vitest";
import { computeSurcharge, NEW_REGIME_SURCHARGE_BANDS, OLD_REGIME_SURCHARGE_BANDS } from "../src/ay2026-27/surcharge.js";
import { computeRebate } from "../src/ay2026-27/rebate.js";
import { computeSlabTax, getOldRegimeSlabs, NEW_REGIME_SLABS } from "../src/ay2026-27/slabs.js";
import type { AgeCategory, Regime } from "../src/types.js";

/**
 * All expected figures in this file are hand-derived independently (see the
 * PR description / session notes for the worked arithmetic), then
 * cross-checked for internal consistency: whenever marginal relief applies,
 * taxAfterRebate + surchargeAfterRelief must equal exactly
 * (tax-at-threshold with the lower rate) + (income - threshold).
 */
function taxAfterRebateAtIncomeFor(regime: Regime, ageCategory: AgeCategory) {
  const slabs = regime === "new" ? NEW_REGIME_SLABS : getOldRegimeSlabs(ageCategory);
  return (income: number): number => {
    const taxBeforeRebate = computeSlabTax(income, slabs).taxBeforeRebate;
    return computeRebate(regime, income, taxBeforeRebate).taxAfterRebate;
  };
}

describe("surcharge band selection", () => {
  it("new regime: nil up to and including 50L", () => {
    expect(NEW_REGIME_SURCHARGE_BANDS[0]).toMatchObject({ from: 0, to: 50_00_000, ratePercent: 0 });
  });

  it("new regime caps at 25% — a single open-ended band from 2Cr, no separate 5Cr step", () => {
    const bands = NEW_REGIME_SURCHARGE_BANDS;
    const lastBand = bands[bands.length - 1];
    expect(lastBand).toMatchObject({ from: 2_00_00_000, to: null, ratePercent: 25 });
    // No band boundary at 5 Cr for the new regime.
    expect(bands.some((b) => b.from === 5_00_00_000)).toBe(false);
  });

  it("old regime steps up to 37% strictly above 5Cr — the well-known old-vs-new divergence", () => {
    const bands = OLD_REGIME_SURCHARGE_BANDS;
    const lastBand = bands[bands.length - 1];
    expect(lastBand).toMatchObject({ from: 5_00_00_000, to: null, ratePercent: 37 });
  });
});

describe("computeSurcharge — no surcharge below 50L", () => {
  it("new regime, income = 49,99,999", () => {
    const fn = taxAfterRebateAtIncomeFor("new", "below60");
    const tax = fn(49_99_999);
    const result = computeSurcharge({ taxableIncome: 49_99_999, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(result.applicableRate).toBe(0);
    expect(result.surchargeAfterRelief).toBe(0);
  });

  it("old regime, income = exactly 50,00,000 (boundary belongs to nil band)", () => {
    const fn = taxAfterRebateAtIncomeFor("old", "below60");
    const tax = fn(50_00_000);
    const result = computeSurcharge({ taxableIncome: 50_00_000, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.applicableRate).toBe(0);
    expect(tax).toBeCloseTo(1_312_500, 2);
  });
});

describe("computeSurcharge — old regime, below60, all four thresholds", () => {
  const fn = taxAfterRebateAtIncomeFor("old", "below60");

  it("50L: no surcharge at threshold, tax = 13,12,500", () => {
    expect(fn(50_00_000)).toBeCloseTo(1_312_500, 2);
  });

  it("50L+1: 10% surcharge kicks in but marginal relief limits total increase to ₹1", () => {
    const income = 50_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(1_312_500.3, 2);
    expect(result.marginalReliefApplied).toBeCloseTo(131_249.33, 2);
    expect(result.surchargeAfterRelief).toBeCloseTo(0.7, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(1_312_501, 2);
  });

  it("1Cr: 10% surcharge, no relief (deep enough in band) — tax+surcharge = 30,93,750", () => {
    const income = 1_00_00_000;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(2_812_500, 2);
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.surchargeAfterRelief).toBeCloseTo(281_250, 2);
  });

  it("1Cr+1: 15% surcharge kicks in, marginal relief limits total increase to ₹1", () => {
    const income = 1_00_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.marginalReliefApplied).toBeCloseTo(140_624.35, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(3_093_751, 2);
  });

  it("2Cr: 15% surcharge, no relief — tax+surcharge = 66,84,375", () => {
    const income = 2_00_00_000;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(5_812_500, 2);
    expect(result.marginalReliefApplied).toBe(0);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(6_684_375, 2);
  });

  it("2Cr+1: 25% surcharge kicks in, marginal relief limits total increase to ₹1", () => {
    const income = 2_00_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.marginalReliefApplied).toBeCloseTo(581_249.38, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(6_684_376, 2);
  });

  it("5Cr: 25% surcharge, no relief — tax+surcharge = 1,85,15,625", () => {
    const income = 5_00_00_000;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(14_812_500, 2);
    expect(result.marginalReliefApplied).toBe(0);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(18_515_625, 2);
  });

  it("5Cr+1: rate steps up to 37% (old regime only), marginal relief limits total increase to ₹1", () => {
    const income = 5_00_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.applicableRate).toBeCloseTo(0.37, 5);
    expect(result.marginalReliefApplied).toBeCloseTo(1_777_499.41, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(18_515_626, 2);
  });
});

describe("computeSurcharge — new regime, below60: 25% cap, no cliff at 5Cr", () => {
  const fn = taxAfterRebateAtIncomeFor("new", "below60");

  it("50L+1: same 10% marginal-relief mechanics as old regime at this threshold", () => {
    const income = 50_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(1_080_000.3, 2);
    expect(result.marginalReliefApplied).toBeCloseTo(107_999.33, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(1_080_001, 2);
  });

  it("2Cr: still 15% (boundary belongs to the 1Cr-2Cr band, not the 25% band)", () => {
    const income = 2_00_00_000;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(5_580_000, 2);
    expect(result.applicableRate).toBeCloseTo(0.15, 5);
    expect(result.marginalReliefApplied).toBe(0);
  });

  it("2Cr+1: 25% surcharge kicks in with marginal relief against the 2Cr threshold", () => {
    const income = 2_00_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(result.applicableRate).toBeCloseTo(0.25, 5);
    expect(result.thresholdUsedForRelief).toBe(2_00_00_000);
    expect(result.marginalReliefApplied).toBeCloseTo(557_999.38, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(6_417_001, 2);
  });

  it("5Cr: still 25%, threshold reference is still 2Cr (no new step) — no relief, deep in band", () => {
    const income = 5_00_00_000;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(tax).toBeCloseTo(14_580_000, 2);
    expect(result.applicableRate).toBeCloseTo(0.25, 5);
    expect(result.thresholdUsedForRelief).toBe(2_00_00_000); // NOT 5Cr — no such threshold exists for new regime
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.surchargeAfterRelief).toBeCloseTo(3_645_000, 2);
  });

  it("5Cr+1: rate stays flat at 25% — this is the key old-vs-new divergence point", () => {
    const income = 5_00_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "new", taxAfterRebateAtIncome: fn });
    expect(result.applicableRate).toBeCloseTo(0.25, 5); // capped — old regime would be 0.37 here
    expect(result.thresholdUsedForRelief).toBe(2_00_00_000);
    expect(result.marginalReliefApplied).toBe(0); // no cliff, so no relief needed
    expect(result.surchargeAfterRelief).toBeCloseTo(3_645_000.08, 2);
  });
});

describe("computeSurcharge — 50L threshold across all three old-regime age bands", () => {
  it("senior (60-79): tax 13,10,000 at threshold; +1 gets 10% relief-capped surcharge", () => {
    const fn = taxAfterRebateAtIncomeFor("old", "senior");
    expect(fn(50_00_000)).toBeCloseTo(1_310_000, 2);

    const income = 50_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.marginalReliefApplied).toBeCloseTo(130_999.33, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(1_310_001, 2);
  });

  it("superSenior (80+): tax 13,00,000 at threshold; +1 gets 10% relief-capped surcharge", () => {
    const fn = taxAfterRebateAtIncomeFor("old", "superSenior");
    expect(fn(50_00_000)).toBeCloseTo(1_300_000, 2);

    const income = 50_00_001;
    const tax = fn(income);
    const result = computeSurcharge({ taxableIncome: income, taxAfterRebate: tax, regime: "old", taxAfterRebateAtIncome: fn });
    expect(result.marginalReliefApplied).toBeCloseTo(129_999.33, 2);
    expect(tax + result.surchargeAfterRelief).toBeCloseTo(1_300_001, 2);
  });
});
