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

// AY 2026-27 — Phase 2: HRA exemption (Section 10(13A), old regime only)
export type { HraExemptionInput, HraExemptionResult } from "./ay2026-27/hra.js";
export { computeHraExemption, getHraExemptionForRegime } from "./ay2026-27/hra.js";

// AY 2026-27 — Phase 2: income from house property
export type {
  HousePropertyAggregateResult,
  HousePropertyComputation,
  HousePropertyInput,
  LetOutPropertyInput,
  SelfOccupiedPropertyInput,
} from "./ay2026-27/houseProperty.js";
export {
  HOUSE_PROPERTY_LOSS_SETOFF_CAP_OLD_REGIME,
  SELF_OCCUPIED_INTEREST_CAP_OLD_REGIME,
  aggregateHousePropertyIncome,
  housePropertyContributionToGrossTotalIncome,
} from "./ay2026-27/houseProperty.js";

// AY 2026-27 — Phase 2: capital gains classification and taxation
export type { CapitalAssetType, CapitalGainTransactionInput, CapitalGainsResult, HoldingClassification } from "./ay2026-27/capitalGains.js";
export {
  CAPITAL_GAINS_REGIME_CHANGE_DATE,
  CAPITAL_GAINS_SURCHARGE_CAP_PERCENT,
  LTCG_EQUITY_EXEMPTION,
  LTCG_EQUITY_RATE_PERCENT,
  LTCG_OTHER_RATE_PERCENT,
  LTCG_OTHER_WITH_INDEXATION_RATE_PERCENT,
  STCG_EQUITY_RATE_PERCENT,
  classifyHoldingPeriod,
  computeCapitalGains,
} from "./ay2026-27/capitalGains.js";

// AY 2026-27 — Phase 2: Chapter VI-A deductions
export type { ChapterVIAInput, ChapterVIAResult, Section80CCD2Input, Section80DInput } from "./ay2026-27/deductions.js";
export {
  SECTION_80C_CAP,
  SECTION_80CCD_1B_CAP,
  SECTION_80CCD_2_RATE_PERCENT_NEW_REGIME,
  SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_GOVERNMENT,
  SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_OTHER,
  SECTION_80D_PARENTS_CAP_NON_SENIOR,
  SECTION_80D_PARENTS_CAP_SENIOR,
  SECTION_80D_PREVENTIVE_CHECKUP_SUBLIMIT,
  SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR,
  SECTION_80D_SELF_FAMILY_CAP_SENIOR,
  SECTION_80TTA_CAP,
  SECTION_80TTB_CAP,
  computeChapterVIA,
} from "./ay2026-27/deductions.js";

// AY 2026-27 — Phase 2: full income aggregation (salary+HRA+house property+capital gains+deductions)
export type { DeductionsInput, FullIncomeInput, FullTaxableIncomeResult } from "./ay2026-27/fullIncome.js";
export { computeFullTaxableIncome } from "./ay2026-27/fullIncome.js";

// AY 2026-27 — Phase 2: combined slab + capital-gains tax orchestrator
export type { FullTaxLiabilityResult } from "./ay2026-27/computeTaxFull.js";
export { computeFullTaxLiability } from "./ay2026-27/computeTaxFull.js";

// AY 2026-27 — Phase 2: regime comparison
export type { RegimeComparisonResult } from "./ay2026-27/regimeCompare.js";
export { compareRegimes } from "./ay2026-27/regimeCompare.js";
