export const ITR_SCHEMA_PACKAGE = "@cleartax/itr-schema";

// Public input/result types
export type {
  ItrAddress,
  ItrExportInput,
  ItrHousePropertyDetailInput,
  ItrOtherSourceIncomeInput,
  ItrOtherSourceType,
  ItrSalaryEmployerInput,
  ItrTaxpayerProfileInput,
  MappedItrResult,
} from "./types";
export { ItrMappingError } from "./types";

// AY 2026-27 — eligibility, mappers, constants
export type { ItrEligibilityResult } from "./ay2026-27/eligibility";
export {
  ITR1_AGRICULTURAL_INCOME_LIMIT,
  ITR1_MAX_HOUSE_PROPERTIES,
  ITR1_TOTAL_INCOME_LIMIT,
  isEligibleForItr1,
} from "./ay2026-27/eligibility";
export { mapToItr1 } from "./ay2026-27/itr1Mapper";
export { mapToItr2 } from "./ay2026-27/itr2Mapper";
export {
  COUNTRY_CODE_INDIA,
  FOREIGN_STATE_CODE,
  ITR_FILING_DUE_DATE,
  RETURN_FILE_SECTION,
  SCHEMA_ASSESSMENT_YEAR,
  SCHEMA_FORM_VERSION,
  SOFTWARE_VENDOR_CODE,
  splitName,
  stateNameToCode,
  toIsoDateString,
} from "./ay2026-27/constants";

// Validation against the real vendored government schema
export { ItrValidationError, assertValidItr1, assertValidItr2 } from "./validate";

// Version registry — the primary entry point for most callers
export type { AssessmentYearItrMappers } from "./registry";
export { ITR_SCHEMA_REGISTRY, getItrMappersForAssessmentYear, mapToItrJson } from "./registry";

// Low-level schema-skeleton utilities (exposed mainly for this package's
// own tests; also useful if a future AY's mapper needs the same
// "skeleton + overlay" pattern).
export { SchemaSkeletonError, buildRequiredSkeleton, compact, deepMergeOverlay } from "./schemaSkeleton";
