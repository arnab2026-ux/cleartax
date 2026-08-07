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
 * PHASE 11 UPDATE — FOREIGN ASSETS AND RESIDENTIAL STATUS ARE NOW CHECKED
 * FOR REAL. Two of the conditions this function previously had to assume
 * away are now modeled:
 *
 *  - **Holding ANY foreign asset disqualifies ITR-1 outright, regardless of
 *    income, and so does any foreign-source income.** ITR-1 (and ITR-4) do
 *    not contain Schedule FA at all, so there is physically nowhere to make
 *    the disclosure. The Income Tax Department's own "Step-by-Step Guide to
 *    Fill FSI, TR, and FA Schedule in ITR" (fetched 2026-08-01 from
 *    incometax.gov.in/iec/foportal/sites/default/files/2026-03/) says so
 *    directly: "Taxpayers with any foreign assets or income should not file
 *    using ITR-1 or ITR-4, as these forms lack the necessary reporting
 *    schedules for foreign disclosures." The stakes are asymmetric and high:
 *    a missed foreign-asset disclosure carries a ₹10,00,000-per-year penalty
 *    under Section 43 of the Black Money Act, 2015.
 *  - **ITR-1 requires Resident and Ordinarily Resident status.** An RNOR or
 *    Non-Resident filer cannot use it, and `TaxpayerProfile.residentialStatus`
 *    now records this.
 *
 * WHAT THIS FUNCTION STILL CAN'T CHECK: director status, holdings of
 * *Indian* unlisted equity shares, VDA/crypto income, and Section 194N TDS
 * have no representation anywhere in this app's data model. This function
 * can only evaluate what the data it's given actually contains; it silently
 * assumes "no" for those remaining unmodeled conditions rather than
 * pretending to check them. Flagged in PROGRESS.md and in
 * `toItrSchemaInput.ts`.
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

  // Phase 11 — foreign assets/income and residential status. Note these are
  // checked on the RAW COUNT, not on any value threshold: there is no
  // de-minimis limit below which a foreign asset can be left out of Schedule
  // FA, and ITR-1 has no Schedule FA at all. See this file's header.
  const foreignAssets = input.foreignAssets ?? [];
  if (foreignAssets.length > 0) {
    reasons.push(
      `${foreignAssets.length} foreign asset${foreignAssets.length === 1 ? "" : "s"} held — ITR-1 has no Schedule FA, so ANY foreign asset (regardless of its value) requires ITR-2.`,
    );
  }

  const foreignSourceIncomes = fullIncomeInput.foreignSourceIncomes ?? [];
  if (foreignSourceIncomes.length > 0) {
    reasons.push("Foreign-source income is present — ITR-1 has no Schedule FSI/TR, so this requires ITR-2.");
  }

  const residentialStatus = input.residentialStatus ?? "ROR";
  if (residentialStatus !== "ROR") {
    reasons.push(
      `Residential status is ${residentialStatus === "RNOR" ? "Resident but Not Ordinarily Resident" : "Non-Resident"} — ITR-1 is available only to a Resident and Ordinarily Resident individual.`,
    );
  }

  return { eligible: reasons.length === 0, reasons };
}
