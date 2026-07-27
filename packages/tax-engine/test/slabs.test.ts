import { describe, expect, it } from "vitest";
import {
  NEW_REGIME_SLABS,
  computeSlabTax,
  getAgeCategory,
  getOldRegimeSlabs,
} from "../src/ay2026-27/slabs.js";

describe("getAgeCategory", () => {
  const cases: Array<[number, "below60" | "senior" | "superSenior"]> = [
    [0, "below60"],
    [18, "below60"],
    [59, "below60"],
    [60, "senior"],
    [65, "senior"],
    [79, "senior"],
    [80, "superSenior"],
    [81, "superSenior"],
    [100, "superSenior"],
  ];

  it.each(cases)("age %i -> %s", (age, expected) => {
    expect(getAgeCategory(age)).toBe(expected);
  });
});

describe("getOldRegimeSlabs shape", () => {
  it("below60: has a 2.5L-5L 5% band", () => {
    const slabs = getOldRegimeSlabs("below60");
    expect(slabs).toEqual([
      { from: 0, to: 250_000, ratePercent: 0 },
      { from: 250_000, to: 500_000, ratePercent: 5 },
      { from: 500_000, to: 1_000_000, ratePercent: 20 },
      { from: 1_000_000, to: null, ratePercent: 30 },
    ]);
  });

  it("senior (60-79): 5% band starts at 3L, not 2.5L", () => {
    const slabs = getOldRegimeSlabs("senior");
    expect(slabs).toEqual([
      { from: 0, to: 300_000, ratePercent: 0 },
      { from: 300_000, to: 500_000, ratePercent: 5 },
      { from: 500_000, to: 1_000_000, ratePercent: 20 },
      { from: 1_000_000, to: null, ratePercent: 30 },
    ]);
  });

  it("superSenior (80+): no 5% band at all — exemption limit absorbs it", () => {
    const slabs = getOldRegimeSlabs("superSenior");
    expect(slabs).toEqual([
      { from: 0, to: 500_000, ratePercent: 0 },
      { from: 500_000, to: 1_000_000, ratePercent: 20 },
      { from: 1_000_000, to: null, ratePercent: 30 },
    ]);
  });
});

describe("computeSlabTax — new regime", () => {
  const cases: Array<[number, number]> = [
    [0, 0],
    [400_000, 0], // boundary belongs to the cheaper (lower) slab
    [400_001, 0.05],
    [800_000, 20_000],
    [800_001, 20_000.1],
    [1_200_000, 60_000], // exactly matches the 87A rebate cap — verified below in rebate.test.ts
    [1_200_001, 60_000.15],
    [1_600_000, 120_000],
    [1_600_001, 120_000.2],
    [2_000_000, 200_000],
    [2_000_001, 200_000.25],
    [2_400_000, 300_000],
    [2_400_001, 300_000.3],
    [3_000_000, 480_000],
    [10_000_000, 2_580_000],
  ];

  it.each(cases)("taxable income %i -> tax %f", (income, expectedTax) => {
    const result = computeSlabTax(income, NEW_REGIME_SLABS);
    expect(result.taxBeforeRebate).toBeCloseTo(expectedTax, 2);
  });

  it("negative income is clamped to zero tax", () => {
    expect(computeSlabTax(-100, NEW_REGIME_SLABS).taxBeforeRebate).toBe(0);
  });

  it("produces one breakdown entry per slab with correct partitioning at 14,25,000", () => {
    const result = computeSlabTax(1_425_000, NEW_REGIME_SLABS);
    expect(result.breakdown).toHaveLength(7);
    expect(result.breakdown[0]?.taxableAmountInSlab).toBe(400_000); // nil slab full
    expect(result.breakdown[1]?.taxableAmountInSlab).toBe(400_000); // 5% slab full
    expect(result.breakdown[2]?.taxableAmountInSlab).toBe(400_000); // 10% slab full
    expect(result.breakdown[3]?.taxableAmountInSlab).toBe(225_000); // 15% slab partial
    expect(result.breakdown[4]?.taxableAmountInSlab).toBe(0);
    expect(result.breakdown[3]?.taxForSlab).toBeCloseTo(33_750, 2);
  });
});

describe("computeSlabTax — old regime, below60", () => {
  const slabs = getOldRegimeSlabs("below60");
  const cases: Array<[number, number]> = [
    [0, 0],
    [250_000, 0],
    [250_001, 0.05],
    [500_000, 12_500],
    [500_001, 12_500.2],
    [1_000_000, 112_500],
    [1_000_001, 112_500.3],
    [1_500_000, 262_500],
  ];

  it.each(cases)("taxable income %i -> tax %f", (income, expectedTax) => {
    expect(computeSlabTax(income, slabs).taxBeforeRebate).toBeCloseTo(expectedTax, 2);
  });
});

describe("computeSlabTax — old regime, senior (60-79)", () => {
  const slabs = getOldRegimeSlabs("senior");
  const cases: Array<[number, number]> = [
    [0, 0],
    [300_000, 0],
    [300_001, 0.05],
    [500_000, 10_000],
    [500_001, 10_000.2],
    [1_000_000, 110_000],
    [1_000_001, 110_000.3],
  ];

  it.each(cases)("taxable income %i -> tax %f", (income, expectedTax) => {
    expect(computeSlabTax(income, slabs).taxBeforeRebate).toBeCloseTo(expectedTax, 2);
  });
});

describe("computeSlabTax — old regime, superSenior (80+)", () => {
  const slabs = getOldRegimeSlabs("superSenior");
  const cases: Array<[number, number]> = [
    [0, 0],
    [500_000, 0],
    [500_001, 0.2],
    [1_000_000, 100_000],
    [1_000_001, 100_000.3],
  ];

  it.each(cases)("taxable income %i -> tax %f", (income, expectedTax) => {
    expect(computeSlabTax(income, slabs).taxBeforeRebate).toBeCloseTo(expectedTax, 2);
  });
});
