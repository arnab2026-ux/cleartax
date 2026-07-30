/**
 * Version registry mapping assessment year -> the right mapper/eligibility
 * functions + vendored schema, per the Phase 6 brief: "so a future AY is
 * additive." A new assessment year's schema/mappers should live in a new
 * `src/ay20XX-XX/` directory (mirroring `packages/tax-engine`'s own
 * `src/ay2026-27/` convention) and get a new entry here — nothing in
 * `ay2026-27/*` should need to change.
 */
import { isEligibleForItr1, type ItrEligibilityResult } from "./ay2026-27/eligibility";
import { mapToItr1 } from "./ay2026-27/itr1Mapper";
import { mapToItr2 } from "./ay2026-27/itr2Mapper";
import type { ItrExportInput, MappedItrResult } from "./types";

export interface AssessmentYearItrMappers {
  isEligibleForItr1: (input: ItrExportInput) => ItrEligibilityResult;
  mapToItr1: (input: ItrExportInput, generatedAt?: Date) => MappedItrResult;
  mapToItr2: (input: ItrExportInput, generatedAt?: Date) => MappedItrResult;
}

export const ITR_SCHEMA_REGISTRY: Record<string, AssessmentYearItrMappers> = {
  "2026-27": {
    isEligibleForItr1,
    mapToItr1,
    mapToItr2,
  },
};

export function getItrMappersForAssessmentYear(assessmentYear: string): AssessmentYearItrMappers {
  const mappers = ITR_SCHEMA_REGISTRY[assessmentYear];
  if (!mappers) {
    throw new Error(
      `No ITR JSON mappers registered for assessment year "${assessmentYear}". Registered years: ${Object.keys(ITR_SCHEMA_REGISTRY).join(", ")}.`,
    );
  }
  return mappers;
}

/**
 * Convenience entry point: picks ITR-1 when the input is eligible, else
 * ITR-2 — matching the Phase 6 brief's "ITR-1 if eligible, else ITR-2" rule.
 * A caller that wants to let the taxpayer choose explicitly between the two
 * (when both are viable — always true when ITR-1 eligible, since ITR-2 can
 * represent every ITR-1-eligible taxpayer too) should call
 * `getItrMappersForAssessmentYear(...).isEligibleForItr1` +
 * `mapToItr1`/`mapToItr2` directly instead of this function.
 */
export function mapToItrJson(input: ItrExportInput, generatedAt?: Date): MappedItrResult {
  const mappers = getItrMappersForAssessmentYear(input.assessmentYear);
  const eligibility = mappers.isEligibleForItr1(input);
  return eligibility.eligible ? mappers.mapToItr1(input, generatedAt) : mappers.mapToItr2(input, generatedAt);
}
