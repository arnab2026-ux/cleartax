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
 * ============================================================================
 * SECTION 115BB (LOTTERY/GAME-WINNINGS) — ADDED IN THE PHASE 6 ADVERSARIAL
 * REVIEW, FOLLOWING THE EXACT SAME PATTERN AS CAPITAL GAINS ABOVE
 * ============================================================================
 * Bug found during the Phase 6 adversarial review: `fullIncome.ts` used to
 * have no separate input for lottery/game-show/race-horse winnings at all —
 * `toTaxEngineInput.ts`'s `sumOtherSourcesIncome` folded them into
 * `otherSourcesIncome`, which this orchestrator taxes at ordinary SLAB
 * rates. That is wrong: Section 115BB taxes such winnings at a flat 30%,
 * with NO basic-exemption benefit, NO Chapter VI-A deductions, and NO
 * Section 87A rebate, regardless of the taxpayer's slab (verified via a
 * dedicated web search during this review, not assumed from training data —
 * see PROGRESS.md's Phase 6 adversarial review section for sources). A
 * taxpayer in the 5%/10%/20% slab with real lottery income was getting that
 * income UNDER-taxed by this engine.
 *
 * Fixed the same way capital gains are handled: `lotteryOrGameWinningsIncome`
 * is a separate bucket, excluded from `slabTaxableIncome` (so Chapter VI-A
 * deductions never apply to it) but included in `income.totalIncome` (so it
 * correctly affects the Section 87A eligibility threshold and surcharge
 * band for the REST of the taxpayer's income). Tax on it is flat 30%,
 * non-rebatable (never touched by `computeRebate`, matching the pattern
 * above), and — per the same dedicated search — its surcharge is ALSO
 * capped at 15% (the 2nd proviso to the Finance Act's section 2 caps
 * surcharge at 15% for income chargeable under several special-rate
 * sections including 111A/112/112A AND 115BB, not just capital gains — see
 * `capitalGains.ts`'s updated file header). Reuses
 * `CAPITAL_GAINS_SURCHARGE_CAP_PERCENT` rather than duplicating the
 * constant, since it's genuinely the same 15% figure for the same statutory
 * reason.
 *
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
import type { Regime, RebateResult, SurchargeResult } from "../types";
import type { FullIncomeInput, FullTaxableIncomeResult } from "./fullIncome";
import { computeFullTaxableIncome } from "./fullIncome";
import { computeRebate } from "./rebate";
import { computeSurcharge } from "./surcharge";
import { computeCess } from "./cess";
import { getOldRegimeSlabs, NEW_REGIME_SLABS, computeSlabTax } from "./slabs";
import { percentOf, roundPaisa, roundToNearestTen } from "./rounding";
import { CAPITAL_GAINS_SURCHARGE_CAP_PERCENT } from "./capitalGains";

/** Section 115BB: flat rate on lottery/game-show/race-horse/gambling winnings, no slab treatment. */
export const LOTTERY_TAX_RATE_PERCENT = 30;

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
  /** Section 115BB flat 30% tax on `income.lotteryOrGameWinningsIncome`, before surcharge. Never rebated (Section 87A does not apply). */
  lotteryTaxBeforeSurcharge: number;
  /** min(taxpayer's slab surcharge band, 15%) — same cap and reasoning as `capitalGainsSurchargeRatePercent`, see file header. */
  lotterySurchargeRatePercent: number;
  lotterySurcharge: number;
  /** slabTaxAfterRebate + slabSurcharge.surchargeAfterRelief + capitalGainsTaxBeforeSurcharge + capitalGainsSurcharge + lotteryTaxBeforeSurcharge + lotterySurcharge */
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

  // Section 115BB: flat 30% on lottery/game-winnings income, never rebated
  // (computeRebate is never called with this figure — see file header),
  // surcharge capped at 15% for the same statutory reason as capital gains.
  const lotteryTaxBeforeSurcharge = roundPaisa(percentOf(income.lotteryOrGameWinningsIncome, LOTTERY_TAX_RATE_PERCENT));
  const lotterySurchargeRatePercent = Math.min(slabSurcharge.applicableRate * 100, CAPITAL_GAINS_SURCHARGE_CAP_PERCENT);
  const lotterySurcharge = roundPaisa(percentOf(lotteryTaxBeforeSurcharge, lotterySurchargeRatePercent));

  const taxPlusSurchargeAfterRelief = roundPaisa(
    slabTaxAfterRebate +
      slabSurcharge.surchargeAfterRelief +
      capitalGainsTaxBeforeSurcharge +
      capitalGainsSurcharge +
      lotteryTaxBeforeSurcharge +
      lotterySurcharge,
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
    lotteryTaxBeforeSurcharge,
    lotterySurchargeRatePercent,
    lotterySurcharge,
    taxPlusSurchargeAfterRelief,
    cess,
    totalTaxLiability,
    totalTaxLiabilityRounded,
  };
}
