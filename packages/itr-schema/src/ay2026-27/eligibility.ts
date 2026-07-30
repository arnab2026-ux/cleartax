/**
 * ITR-1 (Sahaj) eligibility check for AY 2026-27, sourced 2026-07-30 via web
 * search against multiple independent, AY-2026-27-dated sources
 * (1finance.co.in "ITR-1 Sahaj AY 2026-27 Guide", cleartax.in "ITR1 AY
 * 2026-27") — deliberately NOT assumed from training-data recollection,
 * since this repo's own established practice (see PROGRESS.md's HRA
 * metro-city note in Phase 2) is that ITR eligibility/threshold rules shift
 * year to year and a stale assumption reads as confidently as a correct
 * one. Both sources independently corroborate:
 *
 *  - Total income must not exceed ₹50,00,000.
 *  - Up to TWO house properties are now allowed (a real AY 2026-27 change
 *    — historically ITR-1 allowed only ONE; flagged here specifically
 *    because assuming the old "one property" rule would have been a
 *    plausible-looking but wrong training-data-shaped mistake).
 *  - Other-sources income is allowed EXCEPT lottery/game-show/racehorse
 *    winnings (Section 115BB special-rate income) — this requires its own
 *    ITR-1-incompatible schedule.
 *  - Agricultural income up to ₹5,000 only.
 *  - Capital gains are allowed ONLY as LTCG under Section 112A (listed
 *    equity/equity MF) with the gain not exceeding the ₹1,25,000 annual
 *    exemption (i.e. zero ACTUAL 112A tax liability) and no capital losses
 *    to carry forward. ANY short-term capital gain, any LTCG on a
 *    non-equity asset, or any capital loss requires ITR-2 instead.
 *  - Must be Resident and Ordinarily Resident (ROR); not a company
 *    director; no unlisted equity shareholding; no foreign income/assets;
 *    no Virtual Digital Asset (crypto) income; no Section 194N TDS.
 *
 * WHAT THIS FUNCTION CAN AND CAN'T ACTUALLY CHECK: several of the
 * disqualifying conditions above (director status, unlisted shares, foreign
 * assets, VDA/crypto income, Section 194N TDS) have NO representation
 * anywhere in this app's data model — `packages/tax-engine` only ever
 * assumes "resident individual" (see its Phase 1 scope note) and
 * `apps/web`'s Prisma schema has no field for any of these. This function
 * can only evaluate what the data it's given actually contains; it
 * silently assumes "no" for every one of these unmodeled conditions rather
 * than pretending to check them. This is flagged prominently in
 * PROGRESS.md and in `toItrSchemaInput.ts` — a real user with unlisted
 * shares or foreign assets would get an incorrect "eligible for ITR-1"
 * verdict from this function, because this app has no way to know about
 * those facts at all.
 *
 * The capital-loss check is a conservative proxy, not a literal
 * implementation of "no losses to carry forward" (this app doesn't track
 * loss carry-forward at all — a deliberate `packages/tax-engine` Phase 2
 * scope boundary, see `capitalGains.ts`'s file header): ANY individual
 * transaction with a negative `gainAmount` anywhere in
 * `computation.income.capitalGains.perTransaction` is treated as
 * disqualifying, even if it nets against a gain within the same bucket and
 * produces no actual carried-forward loss. This can disqualify some
 * ITR-1-eligible taxpayers from this function's verdict (a false negative,
 * pushing them to ITR-2 unnecessarily) but never wrongly qualifies someone
 * with a real loss — the conservative direction this codebase consistently
 * prefers for tax-liability-adjacent judgment calls (see PROGRESS.md's
 * Phase 2 notes on the same principle).
 */
import type { ItrExportInput } from "../types";

export const ITR1_TOTAL_INCOME_LIMIT = 5_000_000; // ₹50,00,000
export const ITR1_MAX_HOUSE_PROPERTIES = 2;
export const ITR1_AGRICULTURAL_INCOME_LIMIT = 5_000; // not modeled anywhere in this app — see isEligibleForItr1's doc comment

export interface ItrEligibilityResult {
  eligible: boolean;
  /** Empty when eligible; one entry per specific disqualifying reason otherwise (not just the first one found), so a caller can show the taxpayer everything that needs ITR-2 instead of one at a time. */
  reasons: string[];
}

export function isEligibleForItr1(input: ItrExportInput): ItrEligibilityResult {
  const reasons: string[] = [];
  const { computation, fullIncomeInput, otherSourceIncomes } = input;
  const cg = computation.income.capitalGains;

  if (computation.income.totalIncome > ITR1_TOTAL_INCOME_LIMIT) {
    reasons.push(`Total income ₹${computation.income.totalIncome.toLocaleString("en-IN")} exceeds the ITR-1 limit of ₹50,00,000.`);
  }

  if (fullIncomeInput.houseProperties.length > ITR1_MAX_HOUSE_PROPERTIES) {
    reasons.push(`${fullIncomeInput.houseProperties.length} house properties reported — ITR-1 allows at most ${ITR1_MAX_HOUSE_PROPERTIES}.`);
  }

  if (cg.stcgEquityNetGain > 0) {
    reasons.push("Short-term capital gains on listed equity/equity mutual funds (Section 111A) are present — not allowed on ITR-1.");
  }
  if (cg.stcgOtherSlabRateIncome > 0) {
    reasons.push("Short-term capital gains on other assets are present — not allowed on ITR-1.");
  }
  if (cg.ltcgOtherTaxableGainEquivalent > 0) {
    reasons.push("Long-term capital gains on non-equity assets (Section 112) are present — not allowed on ITR-1.");
  }
  if (cg.ltcgEquityTaxableGain > 0) {
    reasons.push(
      `Taxable long-term capital gains on listed equity/equity mutual funds (Section 112A) of ₹${cg.ltcgEquityTaxableGain.toLocaleString("en-IN")} exceed the ₹1,25,000 exemption threshold — not allowed on ITR-1.`,
    );
  }
  const hasCapitalLoss = cg.perTransaction.some((t) => t.transaction.gainAmount < 0);
  if (hasCapitalLoss) {
    reasons.push("At least one capital-loss transaction is present — ITR-1 does not permit capital losses to be carried forward.");
  }

  const lotteryIncome = otherSourceIncomes.filter((r) => r.sourceType === "LOTTERY_OR_GAME_WINNINGS").reduce((sum, r) => sum + r.amount, 0);
  if (lotteryIncome > 0) {
    reasons.push("Lottery/game-show/racehorse winnings (Section 115BB) are present — not allowed on ITR-1.");
  }

  return { eligible: reasons.length === 0, reasons };
}
