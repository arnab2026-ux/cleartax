/**
 * Chapter VI-A deductions for AY 2026-27 (FY 2025-26): 80C, 80D, 80CCD(1B),
 * 80CCD(2), and 80TTA/80TTB. Regime-aware by design: `computeChapterVIA`
 * takes the regime and zeroes out every section that doesn't apply under
 * the new regime itself, so callers never need to duplicate that knowledge.
 *
 * ============================================================================
 * REGIME APPLICABILITY (verified 2026-07-28)
 * ============================================================================
 * Almost none of Chapter VI-A survives under the new regime. Confirmed via
 * search (taxbuddy.com "Deductions Allowed in New Tax Regime", cleartax.in
 * Section 115BAC explainer, kotaklife.com, corroborated by kmgcollp.com):
 * the new regime allows the standard deduction (handled in slabs.ts, not
 * here), Section 80CCD(2) (employer's NPS contribution), Section 80CCH
 * (Agniveer Corpus Fund — NOT modeled in this module, out of scope), and
 * Section 57(iia) family pension deduction (not a Chapter VI-A section, not
 * modeled here). Sections 80C, 80D, 80CCD(1B), 80TTA, and 80TTB are ALL
 * old-regime-only and forced to 0 under the new regime by this module.
 *
 * ============================================================================
 * SECTION 80C (+ 80CCC + 80CCD(1), aggregated under the 80CCE umbrella cap)
 * ============================================================================
 * Aggregate cap ₹1,50,000/year (old regime only). This module accepts a
 * single pre-aggregated amount rather than modeling every sub-instrument
 * (PPF/ELSS/life insurance/principal repayment/etc.) individually, per the
 * Phase 2 scope brief.
 *
 * ============================================================================
 * SECTION 80D (health insurance premium)
 * ============================================================================
 * Old regime only. Verified caps (2026-07-28, finnovate.in "Section 80D for
 * Parents & Senior Citizens FY 2025-26", corroborated by taxclue.in and
 * toolisky.com):
 *  - Self + family: ₹25,000/year, raised to ₹50,000 if the eldest of
 *    self/spouse covered is a senior citizen (60+).
 *  - Parents: an ADDITIONAL ₹25,000/year, raised to ₹50,000 if the parents
 *    (or the elder of the two) are senior citizens.
 *  - Preventive health check-up: up to ₹5,000/year, WITHIN (not in addition
 *    to) the self/family cap — this module folds it into the self/family
 *    bucket before applying that bucket's cap, a common simplification
 *    (the check-up sub-limit can technically apply to either bucket; this
 *    module always attributes it to the self/family bucket).
 *  - Maximum combined claim (both self/family and parents senior):
 *    ₹1,00,000/year — this module doesn't hardcode that combined figure; it
 *    falls out naturally from summing the two ₹50,000 caps.
 *
 * ============================================================================
 * SECTION 80CCD(1B) — additional NPS (own contribution)
 * ============================================================================
 * Old regime only. Cap ₹50,000/year, ON TOP OF (not counted against) the
 * 80C/80CCE ₹1,50,000 cap. Verified (2026-07-28): 1finance.co.in, taxgarden.in,
 * oquilia.com, disytax.com all agree.
 *
 * ============================================================================
 * SECTION 80CCD(2) — employer's NPS contribution
 * ============================================================================
 * Available in BOTH regimes (the one Chapter VI-A section that survives the
 * new regime, aside from 80CCH). Cap, as a percentage of salary (basic+DA):
 *  - New regime: 14% for ALL employees (government and private/other alike)
 *    — unified to 14% effective FY 2025-26 / AY 2026-27. Verified
 *    (2026-07-28): calcguru.in, arthaengine.com, taxbuddy.com "80CCD Deduction
 *    Limit Under the New Tax Regime FY 2025-26" all agree.
 *  - Old regime: 14% for government employees, but still only 10% for
 *    private-sector/other employees — the old regime did NOT get the
 *    14%-for-everyone unification. Verified (2026-07-28): same sources,
 *    which explicitly contrast "old regime still restricts private
 *    employees to 10%... the 14% private-sector limit applies only when
 *    you opt for the new regime."
 *
 * ============================================================================
 * SECTION 80TTA / 80TTB — interest income
 * ============================================================================
 * Both old-regime only. Verified (2026-07-28): paytm.com, taxbuddy.com,
 * cleartax.in Section 80TTB explainer, taxgarden.in.
 *  - 80TTA (below 60): savings-account interest only, capped ₹10,000/year.
 *  - 80TTB (60+, senior/super-senior): ALL interest income (savings + FD +
 *    RD, bank/co-op/post office), capped ₹50,000/year. Mutually exclusive
 *    with 80TTA — a senior citizen uses 80TTB, never both. This module
 *    selects 80TTA vs 80TTB automatically from the caller's `age`.
 *
 * ============================================================================
 * NOT MODELED (out of scope — see Phase 2 brief's scope discipline)
 * ============================================================================
 * 80E (education loan interest), 80EE/80EEA (first-time homebuyer interest),
 * 80G (donations), 80GG (rent paid, no HRA), 80CCH (Agniveer), 80U/80DD
 * (disability), and every other Chapter VI-A section not listed above.
 */
import type { AgeCategory, Regime } from "../types";

export const SECTION_80C_CAP = 150_000;
export const SECTION_80CCD_1B_CAP = 50_000;
export const SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR = 25_000;
export const SECTION_80D_SELF_FAMILY_CAP_SENIOR = 50_000;
export const SECTION_80D_PARENTS_CAP_NON_SENIOR = 25_000;
export const SECTION_80D_PARENTS_CAP_SENIOR = 50_000;
export const SECTION_80D_PREVENTIVE_CHECKUP_SUBLIMIT = 5_000;
export const SECTION_80CCD_2_RATE_PERCENT_NEW_REGIME = 14;
export const SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_GOVERNMENT = 14;
export const SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_OTHER = 10;
export const SECTION_80TTA_CAP = 10_000;
export const SECTION_80TTB_CAP = 50_000;

export interface Section80DInput {
  selfAndFamilyPremium: number;
  /** True if the eldest of self/spouse covered under the self+family policy is 60+. */
  selfOrFamilyHasSenior: boolean;
  parentsPremium: number;
  /** True if either covered parent is 60+. */
  parentsHaveSenior: boolean;
  /** Preventive health check-up spend (attributed to the self/family bucket — see file header). */
  preventiveHealthCheckup: number;
}

export interface Section80CCD2Input {
  employerContribution: number;
  /** Annual salary (basic + DA) used as the base for the percentage cap. */
  salary: number;
  employmentType: "government" | "other";
}

export interface ChapterVIAInput {
  regime: Regime;
  age: AgeCategory;
  section80C: number;
  section80D: Section80DInput;
  section80CCD1B: number;
  section80CCD2: Section80CCD2Input;
  /**
   * Interest income eligible for 80TTA (savings-account interest, if
   * below 60) or 80TTB (all bank/post-office interest, if 60+).
   */
  interestIncomeForTtaOrTtb: number;
}

export interface ChapterVIAResult {
  section80C: number;
  section80D: number;
  section80CCD1B: number;
  section80CCD2: number;
  section80TTA: number;
  section80TTB: number;
  totalDeduction: number;
}

function computeSection80D(input: Section80DInput, regime: Regime): number {
  if (regime === "new") return 0;

  const selfFamilyCap = input.selfOrFamilyHasSenior
    ? SECTION_80D_SELF_FAMILY_CAP_SENIOR
    : SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR;
  const parentsCap = input.parentsHaveSenior ? SECTION_80D_PARENTS_CAP_SENIOR : SECTION_80D_PARENTS_CAP_NON_SENIOR;

  const cappedCheckup = Math.max(0, Math.min(input.preventiveHealthCheckup, SECTION_80D_PREVENTIVE_CHECKUP_SUBLIMIT));
  const selfFamilyAllowed = Math.min(Math.max(0, input.selfAndFamilyPremium) + cappedCheckup, selfFamilyCap);
  const parentsAllowed = Math.min(Math.max(0, input.parentsPremium), parentsCap);

  return selfFamilyAllowed + parentsAllowed;
}

function computeSection80CCD2(input: Section80CCD2Input, regime: Regime): number {
  const salary = Math.max(0, input.salary);
  const contribution = Math.max(0, input.employerContribution);

  const ratePercent =
    regime === "new"
      ? SECTION_80CCD_2_RATE_PERCENT_NEW_REGIME
      : input.employmentType === "government"
        ? SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_GOVERNMENT
        : SECTION_80CCD_2_RATE_PERCENT_OLD_REGIME_OTHER;

  const cap = (ratePercent / 100) * salary;
  return Math.min(contribution, cap);
}

function computeSection80TtaOrTtb(interestIncome: number, age: AgeCategory, regime: Regime): { tta: number; ttb: number } {
  if (regime === "new") return { tta: 0, ttb: 0 };
  const interest = Math.max(0, interestIncome);
  const isSenior = age === "senior" || age === "superSenior";
  if (isSenior) {
    return { tta: 0, ttb: Math.min(interest, SECTION_80TTB_CAP) };
  }
  return { tta: Math.min(interest, SECTION_80TTA_CAP), ttb: 0 };
}

export function computeChapterVIA(input: ChapterVIAInput): ChapterVIAResult {
  const { regime } = input;

  const section80C = regime === "old" ? Math.min(Math.max(0, input.section80C), SECTION_80C_CAP) : 0;
  const section80D = computeSection80D(input.section80D, regime);
  const section80CCD1B = regime === "old" ? Math.min(Math.max(0, input.section80CCD1B), SECTION_80CCD_1B_CAP) : 0;
  const section80CCD2 = computeSection80CCD2(input.section80CCD2, regime);
  const { tta: section80TTA, ttb: section80TTB } = computeSection80TtaOrTtb(
    input.interestIncomeForTtaOrTtb,
    input.age,
    regime,
  );

  const totalDeduction = section80C + section80D + section80CCD1B + section80CCD2 + section80TTA + section80TTB;

  return {
    section80C,
    section80D,
    section80CCD1B,
    section80CCD2,
    section80TTA,
    section80TTB,
    totalDeduction,
  };
}
