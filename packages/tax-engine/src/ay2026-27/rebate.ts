/**
 * Section 87A rebate for AY 2026-27 (FY 2025-26), both regimes.
 *
 * New regime: taxable income <= 12,00,000 gets a rebate capped at 60,000,
 * fully zeroing out tax (verified arithmetically below: slab tax at exactly
 * 12,00,000 is 0 (nil to 4L) + 20,000 (4-8L @5%) + 40,000 (8-12L @10%) =
 * 60,000, exactly matching the cap — no gap at the boundary). Above
 * 12,00,000, the statutory marginal relief formula applies: tax payable in
 * the relief band = taxable income − 12,00,000, i.e. the incremental tax
 * above the threshold never exceeds the incremental income above it. This
 * phases out once ordinary slab tax stops exceeding that amount.
 *
 * Old regime: taxable income <= 5,00,000 gets a rebate capped at 12,500,
 * fully zeroing out tax for a below-60 taxpayer (verified arithmetically:
 * slab tax at exactly 5,00,000 for below-60 is 0 (nil to 2.5L) + 12,500
 * (2.5-5L @5%) = 12,500, exactly matching the cap). For senior/super-senior
 * taxpayers, tax at 5,00,000 is <= 12,500 (10,000 and 0 respectively), so
 * the cap still fully zeroes it out.
 *
 * Unlike the new regime, the old regime's Section 87A rebate has **no
 * statutory marginal relief** above its 5,00,000 threshold — this is a
 * well-documented hard cliff (confirmed via Tax2win, ClearTax, and
 * TaxBuddy write-ups on Section 87A): a taxpayer with taxable income of
 * 5,00,001 loses the entire rebate and owes tax on the full slab amount,
 * with no smoothing. This is intentional current law, not a gap to patch.
 */
import type { RebateResult } from "../types.js";
import { roundPaisa } from "./rounding.js";

export const NEW_REGIME_REBATE_THRESHOLD = 1_200_000;
export const NEW_REGIME_REBATE_CAP = 60_000;

export const OLD_REGIME_REBATE_THRESHOLD = 500_000;
export const OLD_REGIME_REBATE_CAP = 12_500;

export function computeNewRegimeRebate(taxableIncome: number, taxBeforeRebate: number): RebateResult {
  if (taxableIncome <= NEW_REGIME_REBATE_THRESHOLD) {
    const rebateApplied = Math.min(taxBeforeRebate, NEW_REGIME_REBATE_CAP);
    return {
      rebateApplied,
      marginalReliefApplied: 0,
      taxAfterRebate: roundPaisa(taxBeforeRebate - rebateApplied),
    };
  }

  const excessIncome = taxableIncome - NEW_REGIME_REBATE_THRESHOLD;
  if (taxBeforeRebate > excessIncome) {
    const marginalReliefApplied = roundPaisa(taxBeforeRebate - excessIncome);
    return {
      rebateApplied: 0,
      marginalReliefApplied,
      taxAfterRebate: roundPaisa(taxBeforeRebate - marginalReliefApplied),
    };
  }

  return { rebateApplied: 0, marginalReliefApplied: 0, taxAfterRebate: roundPaisa(taxBeforeRebate) };
}

export function computeOldRegimeRebate(taxableIncome: number, taxBeforeRebate: number): RebateResult {
  if (taxableIncome <= OLD_REGIME_REBATE_THRESHOLD) {
    const rebateApplied = Math.min(taxBeforeRebate, OLD_REGIME_REBATE_CAP);
    return {
      rebateApplied,
      marginalReliefApplied: 0,
      taxAfterRebate: roundPaisa(taxBeforeRebate - rebateApplied),
    };
  }

  // No marginal relief under the old regime — hard cliff by design (see file header).
  return { rebateApplied: 0, marginalReliefApplied: 0, taxAfterRebate: roundPaisa(taxBeforeRebate) };
}

export function computeRebate(regime: "new" | "old", taxableIncome: number, taxBeforeRebate: number): RebateResult {
  return regime === "new"
    ? computeNewRegimeRebate(taxableIncome, taxBeforeRebate)
    : computeOldRegimeRebate(taxableIncome, taxBeforeRebate);
}
