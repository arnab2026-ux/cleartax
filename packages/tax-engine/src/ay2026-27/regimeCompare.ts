/**
 * Regime comparison: given one full income profile (which may include
 * old-regime-only inputs like HRA and Chapter VI-A deductions — those
 * inputs are simply ignored/zeroed by the regime-aware modules when
 * evaluating the new regime, so the caller can fill in one form and get
 * both numbers back), compute the full tax liability under both regimes
 * and recommend whichever costs the taxpayer less. Pure function, no I/O —
 * this is what the Phase 5 wizard UI surfaces.
 *
 * WHICH FIGURE IS COMPARED (Phase 11 change): `netTaxLiabilityAfterReliefRounded`
 * — i.e. AFTER the Sections 90/90A/91 foreign tax credit — not the gross
 * `totalTaxLiabilityRounded`. The FTC is not regime-invariant: Rule 128's
 * per-source cap is the *Indian* tax on the foreign income, computed at the
 * taxpayer's average rate, which differs between regimes. Comparing gross
 * liabilities could therefore recommend the regime that actually leaves the
 * taxpayer worse off, by ignoring that one regime may waste more of the
 * available credit against the Rule 128(5)(i) ceiling. For a taxpayer with no
 * foreign income the two figures are identical by construction, so this
 * changes nothing for every pre-Phase-11 scenario.
 */
import { computeFullTaxLiability, type FullTaxLiabilityResult } from "./computeTaxFull";
import type { FullIncomeInput } from "./fullIncome";

export interface RegimeComparisonResult {
  old: FullTaxLiabilityResult;
  new: FullTaxLiabilityResult;
  recommendedRegime: "old" | "new";
  /** Absolute difference between the two regimes' net (post-foreign-tax-credit) liabilities. */
  savingsFromRecommendedRegime: number;
}

export function compareRegimes(input: FullIncomeInput, age: number): RegimeComparisonResult {
  const oldResult = computeFullTaxLiability(input, "old", age);
  const newResult = computeFullTaxLiability(input, "new", age);

  const recommendedRegime: "old" | "new" =
    oldResult.netTaxLiabilityAfterReliefRounded <= newResult.netTaxLiabilityAfterReliefRounded ? "old" : "new";
  const savingsFromRecommendedRegime = Math.abs(
    oldResult.netTaxLiabilityAfterReliefRounded - newResult.netTaxLiabilityAfterReliefRounded,
  );

  return {
    old: oldResult,
    new: newResult,
    recommendedRegime,
    savingsFromRecommendedRegime,
  };
}
