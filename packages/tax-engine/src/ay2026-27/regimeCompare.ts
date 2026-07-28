/**
 * Regime comparison: given one full income profile (which may include
 * old-regime-only inputs like HRA and Chapter VI-A deductions — those
 * inputs are simply ignored/zeroed by the regime-aware modules when
 * evaluating the new regime, so the caller can fill in one form and get
 * both numbers back), compute the full tax liability under both regimes
 * and recommend whichever has the lower `totalTaxLiability`. Pure function,
 * no I/O — this is what the Phase 5 wizard UI will surface.
 */
import { computeFullTaxLiability, type FullTaxLiabilityResult } from "./computeTaxFull.js";
import type { FullIncomeInput } from "./fullIncome.js";

export interface RegimeComparisonResult {
  old: FullTaxLiabilityResult;
  new: FullTaxLiabilityResult;
  recommendedRegime: "old" | "new";
  /** Positive: old regime costs this much more than new. Negative: new regime costs more. */
  savingsFromRecommendedRegime: number;
}

export function compareRegimes(input: FullIncomeInput, age: number): RegimeComparisonResult {
  const oldResult = computeFullTaxLiability(input, "old", age);
  const newResult = computeFullTaxLiability(input, "new", age);

  const recommendedRegime: "old" | "new" =
    oldResult.totalTaxLiabilityRounded <= newResult.totalTaxLiabilityRounded ? "old" : "new";
  const savingsFromRecommendedRegime = Math.abs(
    oldResult.totalTaxLiabilityRounded - newResult.totalTaxLiabilityRounded,
  );

  return {
    old: oldResult,
    new: newResult,
    recommendedRegime,
    savingsFromRecommendedRegime,
  };
}
