/**
 * Shared types for the tax-engine package.
 *
 * Scope note (Phase 1): these types cover slab computation, Section 87A
 * rebate + marginal relief, surcharge + marginal relief, cess, and a minimal
 * salary + other-sources income aggregation for Assessment Year 2026-27
 * (Financial Year 2025-26). HRA, house property, capital gains, and Chapter
 * VI-A deductions (80C/80D/etc.) are out of scope for Phase 1 — see
 * `ay2026-27/income.ts` for the exact boundary of what's implemented.
 */

/** Which of the two parallel tax regimes a computation is for. */
export type Regime = "new" | "old";

/**
 * Age-based category used only by the old regime (the new regime does not
 * grant a higher basic exemption for senior/super-senior citizens under
 * current law). Categories follow the Income-tax Act's resident-individual
 * age bands:
 *  - below60: age < 60
 *  - senior: 60 <= age < 80 ("senior citizen")
 *  - superSenior: age >= 80 ("super senior citizen")
 *
 * Phase 1 assumes a resident individual taxpayer (the personal-use scope of
 * this app) — non-resident age-based exemption rules are not modeled.
 */
export type AgeCategory = "below60" | "senior" | "superSenior";

/** One slab in a slab table, as an absolute income range. */
export interface SlabDefinition {
  /** Lower bound of the slab (exclusive, except for the first slab). */
  from: number;
  /** Upper bound of the slab (inclusive), or null for "and above". */
  to: number | null;
  /** Rate for this slab, as an integer percentage (e.g. 5 for 5%). */
  ratePercent: number;
}

/** Slab-by-slab breakdown entry produced by the slab tax calculation. */
export interface SlabBreakdownEntry {
  slabIndex: number;
  from: number;
  to: number | null;
  ratePercent: number;
  taxableAmountInSlab: number;
  taxForSlab: number;
}

export interface SlabTaxResult {
  breakdown: SlabBreakdownEntry[];
  /** Total tax as per slab rates, before any rebate. */
  taxBeforeRebate: number;
}

/** Result of applying Section 87A rebate (and, for the new regime, marginal relief). */
export interface RebateResult {
  rebateApplied: number;
  marginalReliefApplied: number;
  taxAfterRebate: number;
}

/** Result of applying surcharge (and per-threshold marginal relief). */
export interface SurchargeResult {
  /** Applicable surcharge rate as a decimal fraction (e.g. 0.10 for 10%). */
  applicableRate: number;
  /** The surcharge threshold marginal relief was evaluated against, if any. */
  thresholdUsedForRelief: number | null;
  surchargeBeforeRelief: number;
  marginalReliefApplied: number;
  surchargeAfterRelief: number;
}

export interface CessResult {
  /** The amount cess is computed on: tax after rebate + surcharge after relief. */
  cessableAmount: number;
  cess: number;
}

/** Full breakdown returned by `computeTaxFromTaxableIncome`. */
export interface TaxComputationResult {
  regime: Regime;
  age: AgeCategory;
  taxableIncome: number;
  slabBreakdown: SlabBreakdownEntry[];
  taxBeforeRebate: number;
  rebate: RebateResult;
  taxAfterRebate: number;
  surcharge: SurchargeResult;
  /** taxAfterRebate + surcharge.surchargeAfterRelief */
  taxPlusSurchargeAfterRelief: number;
  cess: CessResult;
  /** Exact total tax liability, unrounded. */
  totalTaxLiability: number;
  /** Total tax liability rounded to the nearest ₹10 per Section 288B. */
  totalTaxLiabilityRounded: number;
}
