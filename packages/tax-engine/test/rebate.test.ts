import { describe, expect, it } from "vitest";
import {
  computeNewRegimeRebate,
  computeOldRegimeRebate,
  NEW_REGIME_REBATE_CAP,
  NEW_REGIME_REBATE_THRESHOLD,
  OLD_REGIME_REBATE_CAP,
  OLD_REGIME_REBATE_THRESHOLD,
} from "../src/ay2026-27/rebate.js";
import { computeSlabTax, getOldRegimeSlabs, NEW_REGIME_SLABS } from "../src/ay2026-27/slabs.js";

describe("87A rebate cap exactly matches tax-at-threshold (verified arithmetically, not assumed)", () => {
  it("new regime: tax on exactly 12,00,000 is exactly the 60,000 cap", () => {
    const tax = computeSlabTax(NEW_REGIME_REBATE_THRESHOLD, NEW_REGIME_SLABS).taxBeforeRebate;
    expect(tax).toBe(NEW_REGIME_REBATE_CAP);
  });

  it("old regime, below60: tax on exactly 5,00,000 is exactly the 12,500 cap", () => {
    const tax = computeSlabTax(OLD_REGIME_REBATE_THRESHOLD, getOldRegimeSlabs("below60")).taxBeforeRebate;
    expect(tax).toBe(OLD_REGIME_REBATE_CAP);
  });

  it("old regime, senior: tax on exactly 5,00,000 (10,000) is within the 12,500 cap", () => {
    const tax = computeSlabTax(OLD_REGIME_REBATE_THRESHOLD, getOldRegimeSlabs("senior")).taxBeforeRebate;
    expect(tax).toBe(10_000);
    expect(tax).toBeLessThanOrEqual(OLD_REGIME_REBATE_CAP);
  });

  it("old regime, superSenior: tax on exactly 5,00,000 (0) is within the 12,500 cap", () => {
    const tax = computeSlabTax(OLD_REGIME_REBATE_THRESHOLD, getOldRegimeSlabs("superSenior")).taxBeforeRebate;
    expect(tax).toBe(0);
  });
});

describe("computeNewRegimeRebate", () => {
  it("zero income -> zero everything", () => {
    const result = computeNewRegimeRebate(0, 0);
    expect(result).toEqual({ rebateApplied: 0, marginalReliefApplied: 0, taxAfterRebate: 0 });
  });

  it("exactly at threshold (12,00,000): full rebate, tax after rebate is 0", () => {
    const result = computeNewRegimeRebate(1_200_000, 60_000);
    expect(result.rebateApplied).toBe(60_000);
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("just below threshold (11,99,999): rebate still fully zeroes tax", () => {
    // hand-derived slab tax at 11,99,999 under new regime
    const taxBeforeRebate = 59_999.9;
    const result = computeNewRegimeRebate(1_199_999, taxBeforeRebate);
    expect(result.rebateApplied).toBeCloseTo(59_999.9, 2);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("rebate is capped at 60,000 even if tax before rebate is higher (hypothetical)", () => {
    const result = computeNewRegimeRebate(1_200_000, 70_000);
    expect(result.rebateApplied).toBe(60_000);
    expect(result.taxAfterRebate).toBe(10_000);
  });

  it("just above threshold (12,00,001): marginal relief caps tax at the excess income (₹1)", () => {
    const taxBeforeRebate = 60_000.15; // 60,000 + 15% of ₹1
    const result = computeNewRegimeRebate(1_200_001, taxBeforeRebate);
    expect(result.rebateApplied).toBe(0);
    expect(result.marginalReliefApplied).toBeCloseTo(59_999.15, 2);
    expect(result.taxAfterRebate).toBeCloseTo(1, 2);
  });

  it("marginal relief midway through the 12-16L band (13,00,000): tax below excess, no relief needed", () => {
    // slab tax at 13,00,000 = 60,000 + 15% * 1,00,000 = 75,000; excess income = 1,00,000
    const result = computeNewRegimeRebate(1_300_000, 75_000);
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.taxAfterRebate).toBe(75_000);
  });

  it("marginal relief applies at 12,50,000: tax (67,500) exceeds excess (50,000)", () => {
    const result = computeNewRegimeRebate(1_250_000, 67_500);
    expect(result.marginalReliefApplied).toBeCloseTo(17_500, 2);
    expect(result.taxAfterRebate).toBeCloseTo(50_000, 2);
  });

  it("marginal relief phases out around 12,70,588-12,70,589 (crossover point)", () => {
    // Just before crossover: relief still (barely) applies.
    const justBefore = computeNewRegimeRebate(1_270_588, 70_588.2);
    expect(justBefore.marginalReliefApplied).toBeCloseTo(0.2, 2);
    expect(justBefore.taxAfterRebate).toBeCloseTo(70_588, 2);

    // Just after crossover: tax no longer exceeds excess income, no relief.
    const justAfter = computeNewRegimeRebate(1_270_589, 70_588.35);
    expect(justAfter.marginalReliefApplied).toBe(0);
    expect(justAfter.taxAfterRebate).toBeCloseTo(70_588.35, 2);
  });

  it("well above threshold (20,00,000): no rebate, no marginal relief", () => {
    const result = computeNewRegimeRebate(2_000_000, 200_000);
    expect(result.rebateApplied).toBe(0);
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.taxAfterRebate).toBe(200_000);
  });
});

describe("computeOldRegimeRebate", () => {
  it("zero income -> zero everything", () => {
    expect(computeOldRegimeRebate(0, 0)).toEqual({
      rebateApplied: 0,
      marginalReliefApplied: 0,
      taxAfterRebate: 0,
    });
  });

  it("exactly at threshold (5,00,000), below60: full rebate, tax after rebate is 0", () => {
    const result = computeOldRegimeRebate(500_000, 12_500);
    expect(result.rebateApplied).toBe(12_500);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("just below threshold (4,99,999): rebate still fully zeroes tax", () => {
    const result = computeOldRegimeRebate(499_999, 12_499.95);
    expect(result.rebateApplied).toBeCloseTo(12_499.95, 2);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("at threshold, senior citizen: tax (10,000) fully rebated even though cap is 12,500", () => {
    const result = computeOldRegimeRebate(500_000, 10_000);
    expect(result.rebateApplied).toBe(10_000);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("at threshold, super senior citizen: tax (0) trivially rebated", () => {
    const result = computeOldRegimeRebate(500_000, 0);
    expect(result.rebateApplied).toBe(0);
    expect(result.taxAfterRebate).toBe(0);
  });

  it("HARD CLIFF: just above threshold (5,00,001) gets NO rebate and NO marginal relief", () => {
    // slab tax at 5,00,001 = 12,500 + 20% of ₹1 = 12,500.20
    const result = computeOldRegimeRebate(500_001, 12_500.2);
    expect(result.rebateApplied).toBe(0);
    expect(result.marginalReliefApplied).toBe(0);
    expect(result.taxAfterRebate).toBeCloseTo(12_500.2, 2);
  });

  it("the cliff is real: tax jumps from 0 to ~12,500 for a ₹2 increase in income", () => {
    const atThreshold = computeOldRegimeRebate(500_000, 12_500);
    const justAbove = computeOldRegimeRebate(500_002, 12_500.4);
    expect(atThreshold.taxAfterRebate).toBe(0);
    expect(justAbove.taxAfterRebate).toBeGreaterThan(12_000);
  });

  it("well above threshold (10,00,000): no rebate", () => {
    const result = computeOldRegimeRebate(1_000_000, 112_500);
    expect(result.rebateApplied).toBe(0);
    expect(result.taxAfterRebate).toBe(112_500);
  });
});
