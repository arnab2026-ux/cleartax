/**
 * House Rent Allowance (HRA) exemption under Section 10(13A) read with Rule
 * 2A of the Income-tax Rules, for AY 2026-27 (FY 2025-26). **Old regime
 * only** — the new regime (Section 115BAC) grants no HRA exemption at all;
 * the full HRA received is taxable salary income under the new regime. This
 * module computes the Section 10(13A) formula in isolation; the aggregation
 * layer (`fullIncome.ts`) is responsible for forcing the exemption to zero
 * when `regime === "new"` so the new-vs-old divergence isn't something every
 * caller has to remember to apply manually — see `getHraExemptionForRegime`
 * below, which is the regime-aware entry point callers should actually use.
 *
 * Formula (least of the three, floored at 0):
 *   1. Actual HRA received.
 *   2. Rent paid minus 10% of salary (basic + DA, where DA forms part of
 *      retirement benefits — this module takes the caller-supplied
 *      `basicSalary` figure as-is and doesn't model the DA nuance).
 *   3. 50% of salary if the employee resides in a "metro city", else 40%.
 *
 * Metro cities (50% rate) for THIS assessment year (AY 2026-27 / FY 2025-26):
 * only the original four — Delhi, Mumbai, Kolkata, Chennai. All other cities
 * get 40%, including Bengaluru, Hyderabad, Pune, and Ahmedabad.
 *
 * IMPORTANT — do not "fix" this to 8 cities: the Income-tax Rules, 2026
 * (notified under the new Income-tax Act, 2025) add Bengaluru, Hyderabad,
 * Pune, and Ahmedabad to the metro list at 50%, but that change takes effect
 * **1 April 2026**, i.e. FY 2026-27 / AY 2027-28 — the *next* filing year,
 * not this one. Verified explicitly: a search on the CBDT notification
 * confirms "the return due July 31, 2026 covers FY 2025-26 — still the old
 * Act. That filing gets 40%" for the newly-added cities (myfinancial.in,
 * corroborated by taxupdate.in and ascent-hr.com's rules-2026 analysis,
 * searched 2026-07-28). Revisit `isMetro`'s city list when this package
 * gains an AY 2027-28 directory.
 *
 * Sources cross-checked (2026-07-28):
 *  - Formula and 4-city/50%-vs-40% split for FY 2025-26: ClearTax
 *    (cleartax.in/s/hra-house-rent-allowance).
 *  - New regime has no HRA exemption: same source, corroborated by every
 *    other source cited across this Phase 2 module set.
 *  - The FY 2026-27 8-city expansion (Bengaluru/Hyderabad/Pune/Ahmedabad)
 *    and its 1-April-2026 effective date, explicitly NOT applicable to AY
 *    2026-27: myfinancial.in, taxupdate.in, ascent-hr.com "Income Tax Rules
 *    2026 Complete Analysis" (all searched 2026-07-28).
 */
import type { Regime } from "../types";

export interface HraExemptionInput {
  /** Annual basic salary (+ DA forming part of retirement benefits, if any), used as the "salary" base for the HRA formula. */
  basicSalary: number;
  /** Annual HRA actually received from the employer. */
  hraReceived: number;
  /** Annual rent actually paid by the employee. */
  rentPaid: number;
  /** True if the employee resides in Delhi, Mumbai, Kolkata, or Chennai for AY 2026-27; false otherwise. */
  isMetro: boolean;
}

export interface HraExemptionResult {
  actualHraReceived: number;
  rentPaidLessTenPercentSalary: number;
  salaryPercentLimit: number;
  metroPercentApplied: number;
  /** The exempt portion of HRA under Section 10(13A): the minimum of the three statutory limbs, floored at 0. */
  exemptHra: number;
  /** hraReceived - exemptHra: the taxable portion of HRA received. */
  taxableHra: number;
}

/**
 * Pure Section 10(13A) formula, independent of regime. Callers should
 * generally prefer `getHraExemptionForRegime`, which additionally applies
 * the new-regime rule (exemption forced to 0).
 */
export function computeHraExemption(input: HraExemptionInput): HraExemptionResult {
  const basicSalary = Math.max(0, input.basicSalary);
  const hraReceived = Math.max(0, input.hraReceived);
  const rentPaid = Math.max(0, input.rentPaid);
  const metroPercentApplied = input.isMetro ? 50 : 40;

  const rentPaidLessTenPercentSalary = Math.max(0, rentPaid - 0.1 * basicSalary);
  const salaryPercentLimit = (metroPercentApplied / 100) * basicSalary;

  const exemptHra = Math.max(0, Math.min(hraReceived, rentPaidLessTenPercentSalary, salaryPercentLimit));

  return {
    actualHraReceived: hraReceived,
    rentPaidLessTenPercentSalary,
    salaryPercentLimit,
    metroPercentApplied,
    exemptHra,
    taxableHra: hraReceived - exemptHra,
  };
}

/**
 * Regime-aware entry point: under the new regime, Section 10(13A) simply
 * does not apply, so the entire HRA received is taxable and exemptHra is 0.
 * This is the function the income-aggregation layer should call, so the
 * new-regime rule lives in exactly one place rather than being re-derived by
 * every caller.
 */
export function getHraExemptionForRegime(input: HraExemptionInput, regime: Regime): HraExemptionResult {
  if (regime === "new") {
    const hraReceived = Math.max(0, input.hraReceived);
    return {
      actualHraReceived: hraReceived,
      rentPaidLessTenPercentSalary: 0,
      salaryPercentLimit: 0,
      metroPercentApplied: input.isMetro ? 50 : 40,
      exemptHra: 0,
      taxableHra: hraReceived,
    };
  }
  return computeHraExemption(input);
}
