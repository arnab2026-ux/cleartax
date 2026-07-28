/**
 * Phase 2 orchestrator: combines slab-rate tax (via the existing, untouched
 * `computeTaxFromTaxableIncome`) with special-rate capital-gains tax
 * (Sections 111A/112/112A, from `capitalGains.ts`) into one total
 * liability, per the design goal stated in the Phase 2 brief: this file is
 * purely ADDITIVE — it calls the Phase 1 primitives, it does not modify
 * them, and `computeTaxFromTaxableIncome` remains usable standalone exactly
 * as it was.
 *
 * ============================================================================
 * WHY THIS CAN'T JUST CALL `computeTaxFromTaxableIncome` ONCE
 * ============================================================================
 * Capital gains under 111A/112/112A are taxed at their own flat rates, not
 * slab rates — but they still count toward "total income" for (a) which
 * Section 87A rebate/surcharge band the SLAB-rate income falls into, and
 * (b) whether the taxpayer crosses a surcharge threshold at all. And per a
 * dedicated verification pass (2026-07-28): tax computed under 111A/112/112A
 * is NOT eligible for Section 87A rebate (see `capitalGains.ts` file header),
 * and its surcharge is CAPPED AT 15% regardless of the taxpayer's ordinary
 * surcharge band (which can reach 25%/37%). Neither of those two rules can
 * be expressed by feeding one combined number into the Phase 1 orchestrator.
 *
 * ============================================================================
 * HOW THE PIECES ARE COMBINED
 * ============================================================================
 *  1. Slab tax computed on `income.slabTaxableIncome` only (capital gains
 *     already excluded from this figure by `fullIncome.ts`).
 *  2. Section 87A rebate: threshold/eligibility check uses `income.totalIncome`
 *     (slab + capital gains, matching "total income" as the Act defines it),
 *     but the rebate amount itself only ever offsets slab tax — this falls
 *     out naturally from calling the existing `computeRebate(regime,
 *     totalIncome, slabTaxBeforeRebate)` with the SLAB tax as the amount to
 *     rebate, so capital-gains tax is never touched by it.
 *  3. Surcharge band is selected using `income.totalIncome` (reusing the
 *     existing `computeSurcharge`, which already accepts an arbitrary
 *     `taxableIncome` for band lookup) and applied at the FULL band rate to
 *     slab tax (with the existing per-threshold marginal-relief formula,
 *     unchanged), but at min(bandRate, 15%) to capital-gains tax.
 *  4. Cess: flat 4% on the sum of everything above (slab tax after rebate +
 *     relief + capital-gains tax + capital-gains surcharge), reusing the
 *     existing `computeCess`.
 *  5. Section 288B rounding to the nearest ₹10 on the grand total, same as
 *     the Phase 1 orchestrator.
 *
 * ============================================================================
 * KNOWN SIMPLIFICATION — FLAGGED, NOT SILENTLY ASSUMED CORRECT
 * ============================================================================
 * Marginal relief for the SLAB portion reuses the exact Phase 1 formula,
 * with one approximation: the "tax at the threshold income" callback it
 * needs recomputes slab tax only at that hypothetical income (ignoring that,
 * in reality, part of the taxpayer's income near a threshold might be
 * capital gains rather than slab income). This is an approximation, not the
 * literal ITR-utility computation, for taxpayers whose income composition
 * shifts materially around a surcharge threshold. The capital-gains
 * surcharge itself (capped at 15%) has NO marginal-relief smoothing applied
 * in this module — a taxpayer crossing (say) the ₹50L total-income
 * threshold purely because of capital gains could see a step from 0% to
 * 10%-capped-effectively-lower surcharge on their capital-gains tax without
 * relief cushioning that specific step. Real-world DIY tax tools have
 * similar edge-case gaps; replicating the exact Schedule-SI marginal-relief
 * apportionment used by the department's own utility was judged out of
 * scope for this session's effort budget. Flagged explicitly in PROGRESS.md
 * for a follow-up review pass — do not treat this corner as verified.
 */
import type { Regime, RebateResult, SurchargeResult } from "../types.js";
import type { FullIncomeInput, FullTaxableIncomeResult } from "./fullIncome.js";
import { computeFullTaxableIncome } from "./fullIncome.js";
import { computeRebate } from "./rebate.js";
import { computeSurcharge } from "./surcharge.js";
import { computeCess } from "./cess.js";
import { getOldRegimeSlabs, NEW_REGIME_SLABS, computeSlabTax } from "./slabs.js";
import { percentOf, roundPaisa, roundToNearestTen } from "./rounding.js";
import { CAPITAL_GAINS_SURCHARGE_CAP_PERCENT } from "./capitalGains.js";

export interface FullTaxLiabilityResult {
  regime: Regime;
  income: FullTaxableIncomeResult;
  slabTaxBeforeRebate: number;
  rebate: RebateResult;
  slabTaxAfterRebate: number;
  slabSurcharge: SurchargeResult;
  capitalGainsTaxBeforeSurcharge: number;
  capitalGainsSurchargeRatePercent: number;
  capitalGainsSurcharge: number;
  /** slabTaxAfterRebate + slabSurcharge.surchargeAfterRelief + capitalGainsTaxBeforeSurcharge + capitalGainsSurcharge */
  taxPlusSurchargeAfterRelief: number;
  cess: { cessableAmount: number; cess: number };
  /** Exact total tax liability, unrounded. */
  totalTaxLiability: number;
  /** Total tax liability rounded to the nearest ₹10 per Section 288B. */
  totalTaxLiabilityRounded: number;
}

export function computeFullTaxLiability(input: FullIncomeInput, regime: Regime, age: number): FullTaxLiabilityResult {
  const income = computeFullTaxableIncome(input, regime, age);
  const slabs = regime === "new" ? NEW_REGIME_SLABS : getOldRegimeSlabs(income.ageCategory);

  const slabTaxResult = computeSlabTax(income.slabTaxableIncome, slabs);
  const slabTaxBeforeRebate = slabTaxResult.taxBeforeRebate;

  // Threshold/eligibility uses TOTAL income (slab + capital gains); the
  // amount actually rebated is the slab tax only (capital-gains tax under
  // 111A/112/112A is never rebatable — see capitalGains.ts file header).
  const rebate = computeRebate(regime, income.totalIncome, slabTaxBeforeRebate);
  const slabTaxAfterRebate = rebate.taxAfterRebate;

  const taxAfterRebateAtIncome = (hypotheticalIncome: number): number => {
    const slabTaxAtIncome = computeSlabTax(hypotheticalIncome, slabs).taxBeforeRebate;
    return computeRebate(regime, hypotheticalIncome, slabTaxAtIncome).taxAfterRebate;
  };

  const slabSurcharge = computeSurcharge({
    taxableIncome: income.totalIncome,
    taxAfterRebate: slabTaxAfterRebate,
    regime,
    taxAfterRebateAtIncome,
  });

  const capitalGainsTaxBeforeSurcharge = income.capitalGains.totalSpecialRateTax;
  const capitalGainsSurchargeRatePercent = Math.min(
    slabSurcharge.applicableRate * 100,
    CAPITAL_GAINS_SURCHARGE_CAP_PERCENT,
  );
  const capitalGainsSurcharge = roundPaisa(percentOf(capitalGainsTaxBeforeSurcharge, capitalGainsSurchargeRatePercent));

  const taxPlusSurchargeAfterRelief = roundPaisa(
    slabTaxAfterRebate + slabSurcharge.surchargeAfterRelief + capitalGainsTaxBeforeSurcharge + capitalGainsSurcharge,
  );

  const cess = computeCess(taxPlusSurchargeAfterRelief);
  const totalTaxLiability = roundPaisa(taxPlusSurchargeAfterRelief + cess.cess);
  const totalTaxLiabilityRounded = roundToNearestTen(totalTaxLiability);

  return {
    regime,
    income,
    slabTaxBeforeRebate,
    rebate,
    slabTaxAfterRebate,
    slabSurcharge,
    capitalGainsTaxBeforeSurcharge,
    capitalGainsSurchargeRatePercent,
    capitalGainsSurcharge,
    taxPlusSurchargeAfterRelief,
    cess,
    totalTaxLiability,
    totalTaxLiabilityRounded,
  };
}
