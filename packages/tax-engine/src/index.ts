export const TAX_ENGINE_PACKAGE = "@cleartax/tax-engine";

// Shared types
export type {
  AgeCategory,
  CessResult,
  Regime,
  RebateResult,
  SlabBreakdownEntry,
  SlabDefinition,
  SlabTaxResult,
  SurchargeResult,
  TaxComputationResult,
} from "./types.js";

// AY 2026-27 (FY 2025-26) — slabs
export {
  NEW_REGIME_SLABS,
  NEW_REGIME_STANDARD_DEDUCTION,
  OLD_REGIME_EXEMPTION_LIMIT,
  OLD_REGIME_STANDARD_DEDUCTION,
  computeSlabTax,
  getAgeCategory,
  getOldRegimeSlabs,
} from "./ay2026-27/slabs.js";

// AY 2026-27 — Section 87A rebate
export {
  NEW_REGIME_REBATE_CAP,
  NEW_REGIME_REBATE_THRESHOLD,
  OLD_REGIME_REBATE_CAP,
  OLD_REGIME_REBATE_THRESHOLD,
  computeNewRegimeRebate,
  computeOldRegimeRebate,
  computeRebate,
} from "./ay2026-27/rebate.js";

// AY 2026-27 — surcharge + marginal relief
export type { ComputeSurchargeParams, SurchargeBand } from "./ay2026-27/surcharge.js";
export {
  NEW_REGIME_SURCHARGE_BANDS,
  OLD_REGIME_SURCHARGE_BANDS,
  SURCHARGE_THRESHOLDS,
  computeSurcharge,
  getSurchargeBands,
} from "./ay2026-27/surcharge.js";

// AY 2026-27 — cess
export { CESS_RATE_PERCENT, computeCess } from "./ay2026-27/cess.js";

// AY 2026-27 — rounding (Sections 288A/288B)
export { percentOf, roundPaisa, roundToNearestTen } from "./ay2026-27/rounding.js";

// AY 2026-27 — orchestrator
export { computeTaxFromTaxableIncome } from "./ay2026-27/computeTax.js";

// AY 2026-27 — Phase-1-only income aggregation
export type { Phase1IncomeInput, Phase1TaxableIncomeResult } from "./ay2026-27/income.js";
export { computeTaxableIncomePhase1 } from "./ay2026-27/income.js";
