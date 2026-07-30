/**
 * Running-total guardrails for the `/deductions` wizard step — warns the
 * user when what they've entered exceeds the real statutory cap, using the
 * actual exported constants from `@cleartax/tax-engine` (never a duplicated
 * hardcoded number, so this can't silently drift out of sync with the
 * engine's own caps). Purely a UX warning: `computeChapterVIA` itself
 * already clamps every section to its cap regardless of what's entered, so
 * an over-cap entry can never inflate the actual computed tax benefit — this
 * module just tells the user *before* they see a smaller-than-expected
 * number on the summary page why that happened.
 */
import {
  SECTION_80C_CAP,
  SECTION_80CCD_1B_CAP,
  SECTION_80D_PARENTS_CAP_NON_SENIOR,
  SECTION_80D_PARENTS_CAP_SENIOR,
  SECTION_80D_PREVENTIVE_CHECKUP_SUBLIMIT,
  SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR,
  SECTION_80D_SELF_FAMILY_CAP_SENIOR,
  SECTION_80TTA_CAP,
  SECTION_80TTB_CAP,
} from "@cleartax/tax-engine";

export interface CapCheck {
  claimed: number;
  cap: number;
  overCap: boolean;
  excess: number;
}

function checkCap(claimed: number, cap: number): CapCheck {
  const excess = Math.max(0, claimed - cap);
  return { claimed, cap, overCap: excess > 0, excess };
}

export function checkSection80CCap(totalClaimed: number): CapCheck {
  return checkCap(totalClaimed, SECTION_80C_CAP);
}

export function checkSection80CCD1BCap(totalClaimed: number): CapCheck {
  return checkCap(totalClaimed, SECTION_80CCD_1B_CAP);
}

/** 80D's preventive check-up sub-limit, checked independently of the self+family bucket's own cap (both apply). */
export function checkSection80DPreventiveCheckupCap(claimed: number): CapCheck {
  return checkCap(claimed, SECTION_80D_PREVENTIVE_CHECKUP_SUBLIMIT);
}

export function checkSection80DSelfFamilyCap(claimedPremiumPlusCheckup: number, hasSenior: boolean): CapCheck {
  return checkCap(claimedPremiumPlusCheckup, hasSenior ? SECTION_80D_SELF_FAMILY_CAP_SENIOR : SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR);
}

export function checkSection80DParentsCap(claimedPremium: number, hasSenior: boolean): CapCheck {
  return checkCap(claimedPremium, hasSenior ? SECTION_80D_PARENTS_CAP_SENIOR : SECTION_80D_PARENTS_CAP_NON_SENIOR);
}

export function checkSection80TtaCap(totalClaimed: number): CapCheck {
  return checkCap(totalClaimed, SECTION_80TTA_CAP);
}

export function checkSection80TtbCap(totalClaimed: number): CapCheck {
  return checkCap(totalClaimed, SECTION_80TTB_CAP);
}
