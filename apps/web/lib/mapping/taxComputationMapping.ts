/**
 * Maps `packages/tax-engine`'s `FullTaxLiabilityResult` (plus TDS already
 * on record) into the exact column shape `TaxComputation` expects — this is
 * a direct implementation of the field-by-field mapping already documented
 * in `schema.prisma`'s `TaxComputation` doc comment (re-derived and
 * spot-checked against the real engine source during Phase 4's adversarial
 * review; this function is the first code that actually performs it).
 */
import type { FullTaxLiabilityResult } from "@cleartax/tax-engine";

export interface TaxComputationRowValues {
  grossTotalIncome: number;
  totalDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  capitalGainsTax: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  marginalRelief: number;
  cess: number;
  totalTaxLiability: number;
  tdsCredit: number;
  netPayableOrRefund: number;
}

/**
 * `grossTotalIncome` = sum of all income heads BEFORE Chapter VI-A
 * deductions, per `schema.prisma`'s `TaxComputation` doc comment:
 * `salaryTaxable + housePropertyContribution + otherSourcesIncome +
 * capitalGains.stcgOtherSlabRateIncome +
 * capitalGains.totalSpecialRateTaxableIncome + lotteryOrGameWinningsIncome`
 * (the last term added in the Phase 6 adversarial review alongside the
 * Section 115BB fix — omitting it would silently UNDER-report a taxpayer's
 * total income by exactly their lottery/game-winnings amount, since that
 * income is real gross income even though it's taxed on its own special
 * flat rate rather than through the slab pipeline). Summed directly from
 * those six already-exposed `FullTaxableIncomeResult` fields (all present
 * on `result.income`), NOT reconstructed by adding `deductions.totalDeduction`
 * back onto `slabTaxableIncomeBeforeRounding`.
 *
 * That reverse-derivation was tried first and is wrong whenever
 * `fullIncome.ts`'s pre-floor slab total is negative: `computeFullTaxableIncome`
 * clamps `slabTaxableIncomeBeforeRounding` to `Math.max(0, ...)` before this
 * mapping layer ever sees it, so "floored total + deductions added back"
 * overstates the true pre-deduction income by exactly however far negative
 * the pre-floor figure was. This is a completely realistic scenario, not a
 * theoretical corner case — e.g. a salaried taxpayer with a modest salary
 * and a large self-occupied home-loan-interest loss set against other heads
 * (up to ₹2,00,000/year, old regime) easily drives the pre-Chapter-VI-A slab
 * total negative even with zero Chapter VI-A deductions claimed. Confirmed
 * concretely: salary ₹1,75,000 after standard deduction ₹1,25,000, self-occupied
 * home loan interest ₹2,00,000 (housePropertyContribution -₹2,00,000), plus
 * ₹1,75,000 LTCG-equity taxable gain — the reverse-derivation returned
 * ₹1,75,000 more than the direct sum, because it silently absorbed the
 * ₹75,000 the floor clamp had discarded. See
 * `test/mapping/taxComputationMapping.test.ts`'s "does not overstate
 * grossTotalIncome" regression test.
 */
export function computeGrossTotalIncome(result: FullTaxLiabilityResult): number {
  return (
    result.income.salaryTaxable +
    result.income.housePropertyContribution +
    result.income.otherSourcesIncome +
    result.income.capitalGains.stcgOtherSlabRateIncome +
    result.income.capitalGains.totalSpecialRateTaxableIncome +
    result.income.lotteryOrGameWinningsIncome
  );
}

export function mapFullTaxLiabilityToTaxComputation(
  result: FullTaxLiabilityResult,
  tdsCredit: number,
): TaxComputationRowValues {
  const grossTotalIncome = computeGrossTotalIncome(result);
  const totalDeductions = result.income.deductions.totalDeduction;
  const taxableIncome = result.income.totalIncome;
  const taxBeforeRebate = result.slabTaxBeforeRebate;
  const capitalGainsTax = result.capitalGainsTaxBeforeSurcharge;
  const rebate = result.rebate.rebateApplied;
  const taxAfterRebate = result.slabTaxAfterRebate;
  // Includes lotterySurcharge (Section 115BB, added in the Phase 6 adversarial
  // review) alongside capitalGainsSurcharge — both are capped-at-15% special-
  // rate surcharges, both belong in this single flattened "surcharge" column
  // (this row-level schema doesn't break surcharge out per income category,
  // matching how `capitalGainsTax` below likewise doesn't have a sibling
  // `lotteryTax` column — see PROGRESS.md's Phase 6 adversarial review note
  // on why that was judged out of scope to add).
  const surcharge = result.slabSurcharge.surchargeAfterRelief + result.capitalGainsSurcharge + result.lotterySurcharge;
  const marginalRelief = result.rebate.marginalReliefApplied + result.slabSurcharge.marginalReliefApplied;
  const cess = result.cess.cess;
  const totalTaxLiability = result.totalTaxLiabilityRounded;
  const netPayableOrRefund = totalTaxLiability - tdsCredit;

  return {
    grossTotalIncome,
    totalDeductions,
    taxableIncome,
    taxBeforeRebate,
    capitalGainsTax,
    rebate,
    taxAfterRebate,
    surcharge,
    marginalRelief,
    cess,
    totalTaxLiability,
    tdsCredit,
    netPayableOrRefund,
  };
}
