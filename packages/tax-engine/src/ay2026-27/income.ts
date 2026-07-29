/**
 * Phase-1-ONLY minimal income aggregation: salary income (gross salary less
 * the regime-appropriate standard deduction) plus other-sources income
 * (e.g. bank/FD interest), combined into taxable income.
 *
 * Explicitly OUT OF SCOPE for this phase (Phase 2 territory — do not extend
 * this file to cover them without revisiting the plan):
 *   - HRA exemption
 *   - Income from house property (incl. home loan interest)
 *   - Capital gains (short/long-term, equity/debt/property)
 *   - Chapter VI-A deductions (80C, 80D, 80CCD(1B), 80TTA/80TTB, etc.)
 *   - Regime comparison / recommendation
 *
 * This module is intentionally thin so Phase 2 can extend the income model
 * (more heads, more deductions) without needing to touch the slab/rebate/
 * surcharge/cess primitives in this directory at all — those stay untouched
 * regardless of how income aggregation grows.
 *
 * Section 288A: total income is rounded to the nearest ₹10 before tax is
 * computed on it (same procedure as Section 288B — see `rounding.ts`). That
 * rounding is applied here, at the boundary between "assembling real-world
 * income" and "computing tax on a taxable income figure" — `computeTax.ts`
 * itself deliberately does NOT round its input, so boundary-value tests
 * there stay exact.
 */
import type { Regime } from "../types";
import { NEW_REGIME_STANDARD_DEDUCTION, OLD_REGIME_STANDARD_DEDUCTION } from "./slabs";
import { roundToNearestTen } from "./rounding";

export interface Phase1IncomeInput {
  regime: Regime;
  /** Whether the standard deduction applies (true for salaried employees/pensioners). */
  isSalaried: boolean;
  /** Gross salary income before any deduction. 0 if not salaried. */
  grossSalary: number;
  /**
   * Income from other sources (Phase 1 scope: e.g. savings/FD interest).
   * No deductions (like 80TTA/80TTB) are applied to this in Phase 1.
   */
  otherSourcesIncome: number;
}

export interface Phase1TaxableIncomeResult {
  grossSalary: number;
  standardDeduction: number;
  salaryIncomeAfterStandardDeduction: number;
  otherSourcesIncome: number;
  /** salaryIncomeAfterStandardDeduction + otherSourcesIncome, unrounded. */
  grossTotalIncome: number;
  /** grossTotalIncome rounded to the nearest ₹10 per Section 288A. */
  taxableIncome: number;
}

export function computeTaxableIncomePhase1(input: Phase1IncomeInput): Phase1TaxableIncomeResult {
  const standardDeduction = input.isSalaried
    ? input.regime === "new"
      ? NEW_REGIME_STANDARD_DEDUCTION
      : OLD_REGIME_STANDARD_DEDUCTION
    : 0;

  const salaryIncomeAfterStandardDeduction = Math.max(0, input.grossSalary - standardDeduction);
  const otherSourcesIncome = Math.max(0, input.otherSourcesIncome);
  const grossTotalIncome = salaryIncomeAfterStandardDeduction + otherSourcesIncome;
  const taxableIncome = roundToNearestTen(grossTotalIncome);

  return {
    grossSalary: input.grossSalary,
    standardDeduction,
    salaryIncomeAfterStandardDeduction,
    otherSourcesIncome,
    grossTotalIncome,
    taxableIncome,
  };
}
