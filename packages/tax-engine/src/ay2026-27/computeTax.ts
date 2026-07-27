/**
 * Orchestrator for AY 2026-27 (FY 2025-26) tax computation. This is the
 * core, exhaustively-tested primitive: a pure function from
 * (taxable income, regime, age) to a full breakdown of slab tax, rebate,
 * marginal relief, surcharge, cess, and total liability.
 *
 * Pipeline order (matches how the Income-tax Act / ITR forms present it):
 *   1. Slab tax on taxable income.
 *   2. Less: Section 87A rebate (+ new-regime marginal relief).
 *   3. Add: surcharge on the result of (2), with per-threshold marginal
 *      relief so total tax+surcharge never jumps by more than the income
 *      that crossed the threshold.
 *   4. Add: 4% Health & Education Cess on (2)+(3).
 *   5. Round the final figure to the nearest ₹10 (Section 288B).
 *
 * NOTE: `taxableIncome` is taken as-is — this function does *not* apply
 * Section 288A income rounding to its input, so that exact boundary-value
 * tests (e.g. 12,00,000 vs 12,00,001) aren't silently erased by rounding.
 * Callers assembling taxable income from real-world figures (see
 * `income.ts`) apply Section 288A rounding before calling this function.
 */
import type { Regime, TaxComputationResult } from "../types.js";
import { computeCess } from "./cess.js";
import { computeRebate } from "./rebate.js";
import { getAgeCategory, getOldRegimeSlabs, NEW_REGIME_SLABS, computeSlabTax } from "./slabs.js";
import { computeSurcharge } from "./surcharge.js";
import { roundPaisa, roundToNearestTen } from "./rounding.js";

export function computeTaxFromTaxableIncome(
  taxableIncome: number,
  regime: Regime,
  age: number,
): TaxComputationResult {
  const ageCategory = getAgeCategory(age);
  const slabs = regime === "new" ? NEW_REGIME_SLABS : getOldRegimeSlabs(ageCategory);

  const slabResult = computeSlabTax(taxableIncome, slabs);
  const rebateResult = computeRebate(regime, taxableIncome, slabResult.taxBeforeRebate);

  // Used by the surcharge module to recompute tax-after-rebate at each
  // surcharge threshold, under the same regime/age/slab table.
  const taxAfterRebateAtIncome = (income: number): number => {
    const slabTaxAtIncome = computeSlabTax(income, slabs).taxBeforeRebate;
    return computeRebate(regime, income, slabTaxAtIncome).taxAfterRebate;
  };

  const surchargeResult = computeSurcharge({
    taxableIncome,
    taxAfterRebate: rebateResult.taxAfterRebate,
    regime,
    taxAfterRebateAtIncome,
  });

  const taxPlusSurchargeAfterRelief = roundPaisa(
    rebateResult.taxAfterRebate + surchargeResult.surchargeAfterRelief,
  );
  const cessResult = computeCess(taxPlusSurchargeAfterRelief);
  const totalTaxLiability = roundPaisa(taxPlusSurchargeAfterRelief + cessResult.cess);
  const totalTaxLiabilityRounded = roundToNearestTen(totalTaxLiability);

  return {
    regime,
    age: ageCategory,
    taxableIncome,
    slabBreakdown: slabResult.breakdown,
    taxBeforeRebate: slabResult.taxBeforeRebate,
    rebate: rebateResult,
    taxAfterRebate: rebateResult.taxAfterRebate,
    surcharge: surchargeResult,
    taxPlusSurchargeAfterRelief,
    cess: cessResult,
    totalTaxLiability,
    totalTaxLiabilityRounded,
  };
}
