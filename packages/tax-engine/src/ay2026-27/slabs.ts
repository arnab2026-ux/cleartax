/**
 * AY 2026-27 (FY 2025-26) slab tables and slab-by-slab tax calculation for
 * both regimes.
 *
 * Sources cross-checked (2026-07-28):
 *  - ClearTax slab table: https://cleartax.in/c/income-tax-slab-rates
 *  - Axis Max Life: https://www.axismaxlife.com/blog/tax-savings/income-tax-slab-2025-26
 *  - Bajaj Finserv (via search summary): https://www.bajajfinserv.in/investments/income-tax-slabs
 *  - Canara HSBC Life / Tax2win / myITreturn (via search summaries) corroborate the same figures.
 *
 * New regime slabs (same for all ages under current law):
 *   0 - 4,00,000            : nil
 *   4,00,000 - 8,00,000     : 5%
 *   8,00,000 - 12,00,000    : 10%
 *   12,00,000 - 16,00,000   : 15%
 *   16,00,000 - 20,00,000   : 20%
 *   20,00,000 - 24,00,000   : 25%
 *   above 24,00,000         : 30%
 *
 * Old regime basic exemption limit depends on resident-individual age:
 *   below 60           : 2,50,000
 *   60-79 (senior)      : 3,00,000
 *   80+  (super senior) : 5,00,000
 * Above the exemption limit: next slab up to 5,00,000 total @ 5% (absent
 * for super senior citizens, whose exemption limit already is 5,00,000),
 * 5,00,000 - 10,00,000 @ 20%, above 10,00,000 @ 30%.
 *
 * Standard deduction for salaried taxpayers:
 *   New regime: 75,000
 *   Old regime: 50,000
 * (Confirmed these differ — do not assume parity between regimes.)
 */
import type { AgeCategory, SlabBreakdownEntry, SlabDefinition, SlabTaxResult } from "../types";
import { percentOf, roundPaisa } from "./rounding";

export const NEW_REGIME_STANDARD_DEDUCTION = 75_000;
export const OLD_REGIME_STANDARD_DEDUCTION = 50_000;

export const OLD_REGIME_EXEMPTION_LIMIT: Record<AgeCategory, number> = {
  below60: 250_000,
  senior: 300_000,
  superSenior: 500_000,
};

export const NEW_REGIME_SLABS: SlabDefinition[] = [
  { from: 0, to: 400_000, ratePercent: 0 },
  { from: 400_000, to: 800_000, ratePercent: 5 },
  { from: 800_000, to: 1_200_000, ratePercent: 10 },
  { from: 1_200_000, to: 1_600_000, ratePercent: 15 },
  { from: 1_600_000, to: 2_000_000, ratePercent: 20 },
  { from: 2_000_000, to: 2_400_000, ratePercent: 25 },
  { from: 2_400_000, to: null, ratePercent: 30 },
];

const OLD_REGIME_MIDDLE_BAND_CEILING = 500_000;
const OLD_REGIME_UPPER_BAND_CEILING = 1_000_000;

/**
 * Build the old-regime slab table for a given age category. The 5% band's
 * lower bound moves with the exemption limit (e.g. starts at 3,00,000 for
 * seniors instead of 2,50,000); super senior citizens have no 5% band at all
 * because their exemption limit (5,00,000) already covers that entire range.
 */
export function getOldRegimeSlabs(ageCategory: AgeCategory): SlabDefinition[] {
  const exemption = OLD_REGIME_EXEMPTION_LIMIT[ageCategory];
  const slabs: SlabDefinition[] = [{ from: 0, to: exemption, ratePercent: 0 }];
  if (exemption < OLD_REGIME_MIDDLE_BAND_CEILING) {
    slabs.push({ from: exemption, to: OLD_REGIME_MIDDLE_BAND_CEILING, ratePercent: 5 });
  }
  slabs.push({ from: OLD_REGIME_MIDDLE_BAND_CEILING, to: OLD_REGIME_UPPER_BAND_CEILING, ratePercent: 20 });
  slabs.push({ from: OLD_REGIME_UPPER_BAND_CEILING, to: null, ratePercent: 30 });
  return slabs;
}

/**
 * Derive the age category used by old-regime slab selection. Ages below 0
 * are clamped to 0 defensively; callers are expected to pass a validated age.
 */
export function getAgeCategory(age: number): AgeCategory {
  const clamped = Math.max(0, Math.floor(age));
  if (clamped >= 80) return "superSenior";
  if (clamped >= 60) return "senior";
  return "below60";
}

/**
 * Compute slab-by-slab tax for a given taxable income against a slab table.
 * Each slab taxes the portion of income strictly above the previous slab's
 * upper bound and up to (inclusive of) its own upper bound — i.e. an income
 * exactly equal to a boundary falls in the *lower* (cheaper) slab, matching
 * standard practice (e.g. taxable income of exactly 4,00,000 under the new
 * regime is entirely within the nil slab).
 */
export function computeSlabTax(taxableIncome: number, slabs: SlabDefinition[]): SlabTaxResult {
  const income = Math.max(0, taxableIncome);
  const breakdown: SlabBreakdownEntry[] = [];
  let totalTax = 0;

  slabs.forEach((slab, slabIndex) => {
    const upper = slab.to ?? Infinity;
    const taxableAmountInSlab = Math.max(0, Math.min(income, upper) - slab.from);
    const taxForSlab = roundPaisa(percentOf(taxableAmountInSlab, slab.ratePercent));
    breakdown.push({
      slabIndex,
      from: slab.from,
      to: slab.to,
      ratePercent: slab.ratePercent,
      taxableAmountInSlab,
      taxForSlab,
    });
    totalTax += taxForSlab;
  });

  return { breakdown, taxBeforeRebate: roundPaisa(totalTax) };
}
