/**
 * Income from house property (Section 22-27), for AY 2026-27 (FY 2025-26).
 * Covers the common personal-use case: one self-occupied property plus
 * (optionally) one or more let-out properties. Multiple self-occupied
 * properties, deemed-let-out treatment for a second self-occupied property,
 * and pre-construction interest amortisation are out of scope by design
 * (scope discipline — see PROGRESS.md Phase 2 notes).
 *
 * ## Self-occupied property
 * Net annual value is always nil (Section 23(2)). The only deduction is
 * home loan interest under Section 24(b):
 *  - Old regime: capped at ₹2,00,000/year, PROVIDED the loan is for
 *    acquisition/construction and that acquisition/construction completed
 *    within 5 years of the end of the FY in which the loan was taken (the
 *    well-known lower ₹30,000 cap for loans that miss this condition, or
 *    for loans taken for repair/renovation, is NOT modeled here — flagged
 *    as a known simplification; this module always applies the ₹2,00,000
 *    cap for self-occupied interest under the old regime).
 *  - New regime: Section 24(b) interest deduction for a SELF-OCCUPIED
 *    property is **not allowed at all** (deduction = 0). Verified via
 *    search (2026-07-28): "If the assessee opts for taxation under Section
 *    115BAC, deduction under Section 24(b) shall not be allowed for
 *    self-occupied property" — corroborated across kmgcollp.com,
 *    kotaklife.com, callmyca.com, and 1finance.co.in.
 * Since NAV is nil, self-occupied "income" is always <= 0 (a loss equal to
 * the allowed interest deduction, or 0 if no interest / new regime).
 *
 * ## Let-out property
 *   Net Annual Value (NAV) = rent received - municipal taxes paid
 *     (this module treats actual rent received as the Gross Annual Value;
 *     it does not model the "higher of actual rent or fair/reasonable rent"
 *     GAV rule some vacant/under-rented properties require — scope
 *     discipline, common case only).
 *   Less: standard deduction, flat 30% of NAV (Section 24(a)) — allowed
 *     even if NAV is negative in principle the deduction is just 0 on a
 *     non-positive NAV (30% of a negative number would increase the loss,
 *     which isn't how Section 24(a) works; this module floors the
 *     deduction at 0 when NAV <= 0).
 *   Less: home loan interest (Section 24(b)) — **uncapped** for let-out
 *     property, in BOTH regimes. Verified (2026-07-28): the new-regime
 *     restriction targets self-occupied property only; "the entire interest
 *     paid can be claimed as a deduction in case of a property let out on
 *     rent against the rental income of such property" (kmgcollp.com,
 *     corroborated by kotaklife.com and callmyca.com).
 *
 * ## Loss set-off against other heads (Section 71(3A))
 * Intra-head netting across multiple properties is allowed in both regimes
 * (Section 70) — this module simply sums each property's result. For
 * set-off of a NET house-property loss against OTHER heads of income
 * (salary, other sources, etc.):
 *  - Old regime: capped at ₹2,00,000/year (Section 71(3A), unchanged for AY
 *    2026-27). Any loss beyond that is carried forward up to 8 assessment
 *    years (Section 71B), settable only against future house-property
 *    income — carry-forward bookkeeping is reported but not applied to the
 *    current year's tax by this module.
 *  - New regime: Section 115BAC disallows set-off of a house-property loss
 *    against any OTHER head of income entirely (cap = ₹0). Verified
 *    (2026-07-28): "Under the new tax regime, loss under the head income
 *    from house property would not be allowed to be set off against income
 *    under any other head... It can only be set off against other house
 *    property income or carried forward" (taxbuddy.com, corroborated by
 *    patronaccounting.com and the statutory text of Section 71(3A) itself
 *    read alongside 115BAC's exclusion list). This module still allows
 *    intra-head (property-vs-property) netting under the new regime — only
 *    the INTER-head set-off against salary/other-sources is zeroed.
 */
import type { Regime } from "../types.js";

export const SELF_OCCUPIED_INTEREST_CAP_OLD_REGIME = 200_000;
export const HOUSE_PROPERTY_LOSS_SETOFF_CAP_OLD_REGIME = 200_000;

export interface SelfOccupiedPropertyInput {
  type: "selfOccupied";
  /** Annual home loan interest paid (Section 24(b)) on this self-occupied property. */
  homeLoanInterestPaid: number;
}

export interface LetOutPropertyInput {
  type: "letOut";
  /** Annual rent actually received (treated as Gross Annual Value — see file header). */
  annualRentReceived: number;
  /** Municipal/property taxes actually paid by the owner during the year. */
  municipalTaxesPaid: number;
  /** Annual home loan interest paid (Section 24(b)) on this let-out property — uncapped. */
  homeLoanInterestPaid: number;
}

export type HousePropertyInput = SelfOccupiedPropertyInput | LetOutPropertyInput;

export interface HousePropertyComputation {
  input: HousePropertyInput;
  netAnnualValue: number;
  standardDeduction30Percent: number;
  interestDeductionAllowed: number;
  /** Net income (positive) or loss (negative) from this single property. */
  incomeOrLoss: number;
}

export interface HousePropertyAggregateResult {
  properties: HousePropertyComputation[];
  /** Sum of incomeOrLoss across all properties (intra-head netting already applied). Can be negative. */
  totalHousePropertyIncome: number;
  /**
   * The portion of a net house-property LOSS that may be set off against
   * other heads of income this year (0 if totalHousePropertyIncome >= 0).
   * Old regime: min(loss, 2,00,000). New regime: always 0.
   */
  lossSetOffAgainstOtherHeads: number;
  /** Loss remaining after this year's set-off, carried forward under Section 71B (informational only — not applied to current-year tax). */
  lossCarriedForward: number;
}

function computeSingleProperty(input: HousePropertyInput, regime: Regime): HousePropertyComputation {
  if (input.type === "selfOccupied") {
    const interestPaid = Math.max(0, input.homeLoanInterestPaid);
    const interestDeductionAllowed =
      regime === "old" ? Math.min(interestPaid, SELF_OCCUPIED_INTEREST_CAP_OLD_REGIME) : 0;
    return {
      input,
      netAnnualValue: 0,
      standardDeduction30Percent: 0,
      interestDeductionAllowed,
      incomeOrLoss: -interestDeductionAllowed,
    };
  }

  const rentReceived = Math.max(0, input.annualRentReceived);
  const municipalTaxesPaid = Math.max(0, input.municipalTaxesPaid);
  const netAnnualValue = rentReceived - municipalTaxesPaid;
  const standardDeduction30Percent = netAnnualValue > 0 ? 0.3 * netAnnualValue : 0;
  const interestDeductionAllowed = Math.max(0, input.homeLoanInterestPaid); // uncapped, both regimes
  const incomeOrLoss = netAnnualValue - standardDeduction30Percent - interestDeductionAllowed;

  return {
    input,
    netAnnualValue,
    standardDeduction30Percent,
    interestDeductionAllowed,
    incomeOrLoss,
  };
}

export function aggregateHousePropertyIncome(
  inputs: HousePropertyInput[],
  regime: Regime,
): HousePropertyAggregateResult {
  const properties = inputs.map((input) => computeSingleProperty(input, regime));
  const totalHousePropertyIncome = properties.reduce((sum, p) => sum + p.incomeOrLoss, 0);

  if (totalHousePropertyIncome >= 0) {
    return {
      properties,
      totalHousePropertyIncome,
      lossSetOffAgainstOtherHeads: 0,
      lossCarriedForward: 0,
    };
  }

  const totalLoss = -totalHousePropertyIncome;
  const setOffCap = regime === "old" ? HOUSE_PROPERTY_LOSS_SETOFF_CAP_OLD_REGIME : 0;
  const lossSetOffAgainstOtherHeads = Math.min(totalLoss, setOffCap);
  const lossCarriedForward = totalLoss - lossSetOffAgainstOtherHeads;

  return {
    properties,
    totalHousePropertyIncome,
    lossSetOffAgainstOtherHeads,
    lossCarriedForward,
  };
}

/**
 * The net effect of house-property income/loss on Gross Total Income this
 * year: positive income is added in full; a loss contributes only up to
 * `lossSetOffAgainstOtherHeads` (negative), with any excess merely carried
 * forward (not reflected in this year's GTI).
 */
export function housePropertyContributionToGrossTotalIncome(result: HousePropertyAggregateResult): number {
  if (result.totalHousePropertyIncome >= 0) return result.totalHousePropertyIncome;
  // Avoid producing -0 when the set-off amount is 0 (new regime, or a
  // below-cap-but-zero case) — Object.is(-0, 0) is false, which would trip
  // up naive equality checks on the returned figure.
  return result.lossSetOffAgainstOtherHeads > 0 ? -result.lossSetOffAgainstOtherHeads : 0;
}
