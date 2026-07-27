/**
 * Health & Education Cess for AY 2026-27 (FY 2025-26): a flat 4% on
 * (income tax + surcharge − rebate already applied), i.e. on
 * taxAfterRebate + surchargeAfterRelief. Same rate for both regimes; this
 * rate has been stable at 4% since FY 2018-19 and is corroborated by every
 * source consulted for the slab/surcharge figures above.
 */
import type { CessResult } from "../types.js";
import { percentOf, roundPaisa } from "./rounding.js";

export const CESS_RATE_PERCENT = 4;

export function computeCess(taxPlusSurchargeAfterRelief: number): CessResult {
  const cessableAmount = Math.max(0, taxPlusSurchargeAfterRelief);
  const cess = roundPaisa(percentOf(cessableAmount, CESS_RATE_PERCENT));
  return { cessableAmount, cess };
}
