import { describe, expect, it } from "vitest";
import { computeTaxFromTaxableIncome } from "../src/ay2026-27/computeTax.js";
import { computeTaxableIncomePhase1 } from "../src/ay2026-27/income.js";

/**
 * Adversarial review pass (see PROGRESS.md "Phase 1 adversarial review" note).
 *
 * These cases were added after an independent re-derivation of the
 * surcharge marginal-relief fixtures in `surcharge.test.ts` from first
 * principles (by hand, without reading the implementation first), which
 * matched the existing fixtures exactly for all four thresholds, both
 * regimes, and all three old-regime age bands. The one genuinely new
 * external data point found during that pass is reproduced below: a
 * worked example from Zoho Payroll's tax guide (independent of every
 * source already cited in this codebase) for a new-regime taxpayer with
 * income just above the 50L surcharge threshold, including cess. It
 * matches this engine's output to the rupee, which is the third-party
 * numeric confirmation PROGRESS.md flagged as missing for the surcharge
 * module.
 */
describe("adversarial review — independent third-party surcharge worked example", () => {
  it("Zoho Payroll example: Rs 51,00,000 total income, new regime -> Rs 12,27,200 total liability incl. cess", () => {
    // Source: Zoho Payroll tax guide worked example (independent of ClearTax/
    // Policybazaar/Axis Max Life/Tax2win sources already cited in surcharge.ts).
    // "total tax payable will be Rs. 12,21,000 (tax before cess)... marginal
    // relief will be Rs. 41,000... income tax liability on income of
    // Rs. 51,00,000 will be Rs. 12,27,200 (including cess)".
    const result = computeTaxFromTaxableIncome(51_00_000, "new", 35);

    expect(result.taxBeforeRebate).toBeCloseTo(11_10_000, 2);
    // tax + surcharge before relief = 12,21,000 (matches source's "before cess" figure)
    expect(result.taxAfterRebate + result.surcharge.surchargeBeforeRelief).toBeCloseTo(12_21_000, 2);
    expect(result.surcharge.marginalReliefApplied).toBeCloseTo(41_000, 2);
    expect(result.taxPlusSurchargeAfterRelief).toBeCloseTo(11_80_000, 2);
    expect(result.cess.cess).toBeCloseTo(47_200, 2);
    expect(result.totalTaxLiability).toBeCloseTo(12_27_200, 2);
  });
});

describe("adversarial review — degenerate income inputs at the orchestrator level", () => {
  it("zero taxable income, both regimes, all age bands: zero liability, no crash", () => {
    for (const regime of ["new", "old"] as const) {
      for (const age of [25, 65, 85]) {
        const result = computeTaxFromTaxableIncome(0, regime, age);
        expect(result.totalTaxLiability).toBe(0);
        expect(result.totalTaxLiabilityRounded).toBe(0);
      }
    }
  });

  it("negative taxable income is defensively clamped to zero liability rather than throwing or going negative", () => {
    // computeTaxFromTaxableIncome does not itself validate the domain (callers
    // assembling real income should never produce a negative figure — see
    // income.ts, which clamps both components with Math.max(0, ...) before
    // this function is ever called). This test documents/pins the current
    // defensive behavior at the orchestrator boundary: it degrades gracefully
    // (zero tax) instead of crashing or producing a negative liability, but it
    // does NOT throw on invalid input. Flagged in review as a legitimate
    // defensive design choice, not a bug — pinning it so a future change
    // can't silently start returning negative tax without a test noticing.
    const result = computeTaxFromTaxableIncome(-500_000, "new", 30);
    expect(result.totalTaxLiability).toBe(0);
    expect(result.totalTaxLiability).toBeGreaterThanOrEqual(0);
  });

  it("income.ts clamps negative otherSourcesIncome to zero rather than allowing it to reduce taxable income", () => {
    // Documents current behavior: a negative "other sources" figure (e.g. a
    // caller bug upstream) is silently floored to 0 rather than surfaced as
    // an error. This is defensible for Phase 1 (no legitimate negative
    // other-sources figure exists in scope), but worth re-checking once
    // Phase 2 adds heads where negative components are legitimate (e.g. house
    // property loss) — Math.max(0, ...) clamping at the wrong layer could
    // silently swallow a real loss instead of carrying it forward.
    const withNegative = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: false,
      grossSalary: 0,
      otherSourcesIncome: -50_000,
    });
    expect(withNegative.otherSourcesIncome).toBe(0);
    expect(withNegative.taxableIncome).toBe(0);
  });
});

describe("adversarial review — multi-threshold marginal relief uses the correct prevRate, not zero", () => {
  // Independently hand-derived (see review notes): at the 1Cr and 2Cr
  // thresholds, the band immediately below is NOT the nil band — it already
  // carries its own surcharge rate (10% below 1Cr, 15% below 2Cr). The
  // relief cap must be computed as taxAtThreshold * (1 + prevRate), not
  // taxAtThreshold * 1 (i.e. not assuming prevRate = 0 unconditionally).
  // This pins that behavior explicitly and independently of surcharge.test.ts.
  it("old regime, 1,00,00,001: relief cap uses prevRate=10% (the 50L-1Cr band's rate), not 0%", () => {
    const result = computeTaxFromTaxableIncome(1_00_00_001, "old", 30);
    // taxAtThreshold(1Cr) = 28,12,500; totalAtThreshold with prevRate=10% = 30,93,750
    // If prevRate were wrongly treated as 0, totalAtThreshold would be 28,12,500
    // instead, understating the cap by exactly 2,81,250 and over-granting relief.
    expect(result.taxAfterRebate + result.surcharge.surchargeAfterRelief).toBeCloseTo(30_93_751, 2);
  });

  it("old regime, 2,00,00,001: relief cap uses prevRate=15% (the 1Cr-2Cr band's rate), not 0%", () => {
    const result = computeTaxFromTaxableIncome(2_00_00_001, "old", 30);
    // taxAtThreshold(2Cr) = 58,12,500; totalAtThreshold with prevRate=15% = 66,84,375
    expect(result.taxAfterRebate + result.surcharge.surchargeAfterRelief).toBeCloseTo(66_84_376, 2);
  });
});
