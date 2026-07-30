/**
 * Small, pure date-arithmetic helpers shared by the Phase 5 mapping layer
 * and validation schemas. Kept separate from any Prisma/tax-engine types so
 * they're trivially unit-testable in isolation.
 *
 * All calculations use UTC getters/constructors deliberately (never local-
 * timezone `Date` methods) — Phase 3's adversarial review found a real bug
 * elsewhere in this repo (`packages/pdf-form16`'s `derivePanDobPassword`)
 * caused by exactly this kind of local-timezone drift, so this module avoids
 * the same class of bug from the start.
 */

/**
 * Number of *completed* calendar months between two dates (UTC), used to
 * classify a capital asset's holding period against the 12/24-month
 * thresholds in `packages/tax-engine`'s `capitalGains.ts`.
 *
 * "Completed months" means: count whole month boundaries crossed, but don't
 * count a partial final month — e.g. 15-Jan-2024 to 15-Jan-2025 is exactly
 * 12 completed months; 15-Jan-2024 to 14-Jan-2025 is 11 (one day short of
 * the twelfth month completing), matching how holding-period thresholds are
 * conventionally applied ("more than 12 months" requires the 12-month mark
 * to have actually passed).
 *
 * Returns 0 (not negative) if `to` is before `from` — callers that need to
 * reject that as invalid input should check the raw dates themselves first
 * (see `lib/validation/capitalGain.ts`).
 */
export function monthsBetween(from: Date, to: Date): number {
  if (to.getTime() < from.getTime()) return 0;

  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * The last day of the financial year an assessment-year string refers to,
 * e.g. "2026-27" (AY 2026-27, FY 2025-26) -> 31 March 2026 (UTC midnight).
 * Age for senior/super-senior citizen classification is computed as of this
 * date (standard convention: age as on the last day of the relevant
 * previous year).
 *
 * Throws on a malformed assessment-year string rather than silently
 * returning a nonsense date.
 */
export function financialYearEndDate(assessmentYear: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(assessmentYear);
  if (!match) {
    throw new Error(`Malformed assessment year "${assessmentYear}" — expected "YYYY-YY" (e.g. "2026-27").`);
  }
  const startYear = Number(match[1]);
  return new Date(Date.UTC(startYear, 2, 31)); // month 2 = March (0-indexed)
}

/**
 * Age in completed years as of `asOf`. Used to derive `AgeCategory`
 * (below60 / senior / superSenior) for the tax engine.
 */
export function computeAgeAsOf(dateOfBirth: Date, asOf: Date): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/** Convenience: age as of the end of the financial year for `assessmentYear`. */
export function computeAgeForAssessmentYear(dateOfBirth: Date, assessmentYear: string): number {
  return computeAgeAsOf(dateOfBirth, financialYearEndDate(assessmentYear));
}
