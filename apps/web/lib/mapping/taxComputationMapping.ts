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
 * deductions. The engine never names this figure directly
 * (`FullTaxableIncomeResult` only exposes the POST-deduction
 * `slabTaxableIncome`), so it's reconstructed here as
 * `slabTaxableIncomeBeforeRounding + deductions.totalDeduction +
 * capitalGains.totalSpecialRateTaxableIncome` — i.e. add back the
 * deductions that were already subtracted, and add the special-rate capital
 * gains that were deliberately excluded from the slab-rate figure. Uses the
 * *pre-rounding* slab figure specifically so `grossTotalIncome -
 * totalDeductions` lines up with `slabTaxableIncomeBeforeRounding` exactly
 * (the schema's own doc comment already flags that the ROUNDED
 * `taxableIncome` column is only approximately, not exactly, equal to
 * `grossTotalIncome - totalDeductions` — using the pre-rounding figure here
 * is what makes this reconstruction as precise as it can be).
 */
export function computeGrossTotalIncome(result: FullTaxLiabilityResult): number {
  return (
    result.income.slabTaxableIncomeBeforeRounding +
    result.income.deductions.totalDeduction +
    result.income.capitalGains.totalSpecialRateTaxableIncome
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
  const surcharge = result.slabSurcharge.surchargeAfterRelief + result.capitalGainsSurcharge;
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
