/**
 * Surcharge on income tax for AY 2026-27 (FY 2025-26), both regimes, with
 * per-threshold marginal relief.
 *
 * Sources cross-checked (2026-07-28): ClearTax
 * (https://cleartax.in/s/marginal-relief-surcharge), Policybazaar, Axis Max
 * Life, and Tax2win write-ups all agree on the same threshold/rate table and
 * on the well-known old-vs-new divergence above ₹5 crore:
 *
 *   Taxable income          | Old regime | New regime
 *   ------------------------|------------|------------
 *   <= 50,00,000            | nil        | nil
 *   > 50,00,000, <= 1 Cr    | 10%        | 10%
 *   > 1 Cr, <= 2 Cr         | 15%        | 15%
 *   > 2 Cr, <= 5 Cr         | 25%        | 25%
 *   > 5 Cr                  | 37%        | 25% (capped — no further step)
 *
 * The new regime's rate does NOT increase again above ₹5 crore (it stays at
 * 25%, same as the 2-5 Cr band), so there is no rate "cliff" at ₹5 crore for
 * the new regime and consequently no marginal relief event there either —
 * that band is modeled as a single open-ended 25% band starting at ₹2 crore.
 * The old regime does step up to 37% above ₹5 crore, which does need its own
 * marginal-relief check. This is a well-known source of bugs; it's covered
 * explicitly in the test suite.
 *
 * Marginal relief (applies at every threshold where the rate steps up, not
 * just the last one): the statutory principle, stated identically across
 * every source above, is that tax + surcharge on income just above a
 * threshold must not exceed [tax + surcharge payable at the threshold] +
 * [the amount by which income exceeds the threshold]. Concretely, for a
 * taxpayer whose income falls in a band with rate R and lower bound
 * (threshold) T:
 *   totalAtIncome    = taxAfterRebate(income) * (1 + R)
 *   totalAtThreshold = taxAfterRebate(T) * (1 + prevR)   [prevR = rate of the band below T]
 *   cap              = totalAtThreshold + (income - T)
 *   relief           = max(0, totalAtIncome - cap)
 * Relief is conventionally attributed entirely to the surcharge line item
 * (the income-tax component is left unchanged), which is what
 * `surchargeAfterRelief` reflects.
 */
import type { Regime, SurchargeResult } from "../types";
import { percentOf, roundPaisa } from "./rounding";

export interface SurchargeBand {
  from: number;
  to: number | null;
  ratePercent: number;
}

export const SURCHARGE_THRESHOLDS = {
  fiftyLakh: 50_00_000,
  oneCrore: 1_00_00_000,
  twoCrore: 2_00_00_000,
  fiveCrore: 5_00_00_000,
} as const;

const T = SURCHARGE_THRESHOLDS;

export const NEW_REGIME_SURCHARGE_BANDS: SurchargeBand[] = [
  { from: 0, to: T.fiftyLakh, ratePercent: 0 },
  { from: T.fiftyLakh, to: T.oneCrore, ratePercent: 10 },
  { from: T.oneCrore, to: T.twoCrore, ratePercent: 15 },
  // New regime caps surcharge at 25% — no further step at 5 Cr.
  { from: T.twoCrore, to: null, ratePercent: 25 },
];

export const OLD_REGIME_SURCHARGE_BANDS: SurchargeBand[] = [
  { from: 0, to: T.fiftyLakh, ratePercent: 0 },
  { from: T.fiftyLakh, to: T.oneCrore, ratePercent: 10 },
  { from: T.oneCrore, to: T.twoCrore, ratePercent: 15 },
  { from: T.twoCrore, to: T.fiveCrore, ratePercent: 25 },
  // Old regime does NOT cap — steps up to 37% above 5 Cr.
  { from: T.fiveCrore, to: null, ratePercent: 37 },
];

export function getSurchargeBands(regime: Regime): SurchargeBand[] {
  return regime === "new" ? NEW_REGIME_SURCHARGE_BANDS : OLD_REGIME_SURCHARGE_BANDS;
}

function findBandIndex(taxableIncome: number, bands: SurchargeBand[]): number {
  const index = bands.findIndex((b) => b.to === null || taxableIncome <= b.to);
  return index === -1 ? bands.length - 1 : index;
}

export interface ComputeSurchargeParams {
  taxableIncome: number;
  taxAfterRebate: number;
  regime: Regime;
  /**
   * Computes tax-after-87A-rebate (i.e. before surcharge) for an arbitrary
   * income under the same regime/age/slab table as the actual computation.
   * Injected by the orchestrator so this module doesn't need to know about
   * slabs/rebate directly.
   */
  taxAfterRebateAtIncome: (income: number) => number;
}

export function computeSurcharge(params: ComputeSurchargeParams): SurchargeResult {
  const { taxableIncome, taxAfterRebate, regime, taxAfterRebateAtIncome } = params;
  const bands = getSurchargeBands(regime);
  const bandIndex = findBandIndex(taxableIncome, bands);
  const band = bands[bandIndex];

  if (!band || band.ratePercent === 0) {
    return {
      applicableRate: 0,
      thresholdUsedForRelief: null,
      surchargeBeforeRelief: 0,
      marginalReliefApplied: 0,
      surchargeAfterRelief: 0,
    };
  }

  const surchargeBeforeRelief = roundPaisa(percentOf(taxAfterRebate, band.ratePercent));
  const totalBeforeRelief = roundPaisa(taxAfterRebate + surchargeBeforeRelief);

  const threshold = band.from;
  const prevBand = bands[bandIndex - 1];
  const prevRatePercent = prevBand ? prevBand.ratePercent : 0;
  const taxAtThreshold = taxAfterRebateAtIncome(threshold);
  const totalAtThreshold = roundPaisa(taxAtThreshold + percentOf(taxAtThreshold, prevRatePercent));
  const incomeExcess = taxableIncome - threshold;
  const cap = roundPaisa(totalAtThreshold + incomeExcess);

  if (totalBeforeRelief > cap) {
    const marginalReliefApplied = roundPaisa(totalBeforeRelief - cap);
    return {
      applicableRate: band.ratePercent / 100,
      thresholdUsedForRelief: threshold,
      surchargeBeforeRelief,
      marginalReliefApplied,
      surchargeAfterRelief: roundPaisa(surchargeBeforeRelief - marginalReliefApplied),
    };
  }

  return {
    applicableRate: band.ratePercent / 100,
    thresholdUsedForRelief: threshold,
    surchargeBeforeRelief,
    marginalReliefApplied: 0,
    surchargeAfterRelief: surchargeBeforeRelief,
  };
}

