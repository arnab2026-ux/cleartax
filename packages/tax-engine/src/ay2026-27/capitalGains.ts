/**
 * Capital gains classification and taxation for AY 2026-27 (FY 2025-26).
 *
 * This is the module most likely to have shifted vs. training-data
 * recollection: Budget 2024 (effective 23 July 2024) substantially
 * rewrote capital-gains holding periods and rates, and Budget 2025 made no
 * further changes to these figures for FY 2025-26. Every numeric constant
 * below was verified via web search on 2026-07-28 against multiple
 * independent current sources (not assumed from pre-2024 training data) —
 * see citations per section.
 *
 * ============================================================================
 * HOLDING PERIODS (post-23-July-2024 simplified two-tier system)
 * ============================================================================
 *  - Listed equity shares / equity-oriented mutual funds / units of a
 *    business trust: LONG-TERM if held > 12 months, else SHORT-TERM.
 *  - Every other capital asset (unlisted shares, immovable property, gold/
 *    other movable property): LONG-TERM if held > 24 months, else
 *    SHORT-TERM. (Before Budget 2024 this used to vary — e.g. 36 months for
 *    gold — Budget 2024 collapsed everything non-listed into a single
 *    24-month line.)
 *  - Units of a "Specified Mutual Fund" under Section 50AA (in short: a
 *    mutual fund investing >65% of proceeds in debt/money-market
 *    instruments, or investing >=65% in units of such a fund) acquired on
 *    or after 1 April 2023: ALWAYS short-term, regardless of actual holding
 *    period — this module treats every `debtMutualFund` transaction as
 *    short-term unconditionally, matching Section 50AA.
 * Sources: taxgarden.in, patronaccounting.com, carajput.com (holding
 * periods, searched 2026-07-28); cleartax.in Section 50AA explainer +
 * finnovate.in "Mutual Fund Taxation FY 2025-26" (specified mutual fund
 * definition and the >65% debt threshold effective FY 2025-26, searched
 * 2026-07-28).
 *
 * ============================================================================
 * TAX RATES
 * ============================================================================
 *  - STCG on listed equity / equity MF (Section 111A): flat 20%. (Raised
 *    from 15% to 20% by Budget 2024, effective for transfers on/after
 *    23 July 2024; unchanged for FY 2025-26.)
 *  - LTCG on listed equity / equity MF (Section 112A): flat 12.5% on gains
 *    EXCEEDING an annual exemption of ₹1,25,000 (raised from ₹1,00,000 and
 *    from a 10% rate by Budget 2024, effective 23 July 2024; unchanged for
 *    FY 2025-26). No indexation.
 *  - STCG on every other asset (unlisted shares, property, gold, and ALL
 *    "specified mutual fund"/debt-fund gains regardless of holding period):
 *    NOT a special rate — added to normal income and taxed at slab rates.
 *    This module returns these as a single slab-rate-taxable bucket rather
 *    than computing a flat rate for them.
 *  - LTCG on every other asset (Section 112): flat 12.5%, WITHOUT
 *    indexation, as the default/primary rule (indexation was removed by
 *    Budget 2024 effective 23 July 2024).
 *    TRANSITIONAL OPTION (immovable property only, resident individuals/
 *    HUFs, property ACQUIRED BEFORE 23 July 2024): the taxpayer may instead
 *    compute tax at 20% WITH indexation and pay whichever of the two
 *    (12.5% no-indexation vs 20% with-indexation) is LOWER. This module
 *    implements that comparison when the caller supplies an
 *    `indexedGainAmount` for a pre-23-July-2024 `immovableProperty`
 *    transaction; otherwise it applies the 12.5%-no-indexation default.
 *    Sources: business-standard.com ("Budget 2024: indexation benefit
 *    removal"), moneylife.in, ascgroup.in ("New Grandfathering Rule in
 *    Capital Gain Tax") — all searched 2026-07-28, all agree on the
 *    "lower of the two, pre-23-July-2024 acquisition only" shape of the
 *    transitional rule.
 *
 * Sources for the rate table overall: venturasecurities.com, taxgarden.in,
 * anptaxcorp.com, business-standard.com's "Budget 2024 hikes LTCG tax rate
 * to 12.5%, STCG to 20%" (all searched 2026-07-28); explicitly confirmed
 * "Budget 2025 made no changes to the LTCG tax rate... for FY 2025-26" per
 * a dedicated search summary (anptaxcorp.com).
 *
 * ============================================================================
 * SURCHARGE CAP ON CAPITAL-GAINS TAX (Sections 111A / 112 / 112A) — AND ALSO
 * ON SECTION 115BB (see `computeTaxFull.ts`'s Phase 6 adversarial-review note)
 * ============================================================================
 * Tax computed under 111A, 112, and 112A is subject to a surcharge rate
 * CAPPED AT 15%, regardless of the taxpayer's total-income surcharge band
 * (which can otherwise reach 25%/37%). This is applied at the orchestrator
 * level (`computeTaxFull.ts`), not in this module, but the constant lives
 * here since it's a property of these sections. Verified (2026-07-28):
 * ebizfiling.com, casahuja.com ("LTCG under Section 112A after Finance Act
 * 2025... surcharge"), and a dedicated worked-example search summary citing
 * a ₹5.5 crore mixed-income case where CG-attributable surcharge is capped
 * at 15% even though the taxpayer's non-CG income alone would trigger 25%.
 *
 * A follow-up search during the Phase 6 adversarial review (2026-07-30,
 * fixing the newly-discovered Section 115BB gap) found the same 15% cap
 * applies to income taxed under Section 115BB (lottery/game-show/gambling
 * winnings) — the 2nd proviso to the Finance Act's surcharge section lists
 * 115BB alongside 111A/112/112A/115AD among the sections eligible for the
 * cap (source: a dedicated search summary citing the proviso's text and
 * cross-checked against a second, independent search). `computeTaxFull.ts`
 * reuses `CAPITAL_GAINS_SURCHARGE_CAP_PERCENT` for the 115BB computation
 * rather than duplicating the constant, since it's the same 15% figure for
 * the same statutory mechanism, not a coincidence.
 *
 * ============================================================================
 * SECTION 87A REBATE DOES NOT APPLY TO THIS TAX
 * ============================================================================
 * For FY 2025-26 onward, Section 87A rebate cannot offset tax computed
 * under 111A/112/112A, regardless of total income — this was the subject of
 * 2024-25 CPC-vs-ITAT litigation (taxpayers won for AY 2024-25 on the
 * "Parliament didn't explicitly block 111A" argument) but the law was
 * explicitly amended for FY 2025-26 onward to close that gap. Verified
 * (2026-07-28) via a dedicated search; this module doesn't compute rebate
 * itself (that's `computeTaxFull.ts`'s job) but every tax figure this
 * module returns is understood to be non-rebatable.
 *
 * ============================================================================
 * NOT MODELED (deliberate scope limits — flagged for review, see
 * PROGRESS.md)
 * ============================================================================
 *  - Inter-bucket capital LOSS set-off (Section 70/74: e.g. a short-term
 *    loss can be set off against long-term gains, but not vice versa; the
 *    real ordering/optimisation across many transactions is genuinely
 *    complex). This module nets gains/losses only WITHIN each bucket
 *    (same asset class + same short/long classification) and floors each
 *    bucket's net result at 0 for tax purposes — a loss in one bucket does
 *    NOT offset a gain in another bucket. This is a conservative
 *    simplification (may overstate tax when a taxpayer has losses in one
 *    bucket and gains in another) rather than an aggressive one.
 *  - Carry-forward of unabsorbed capital losses to future years.
 *  - Foreign assets / unlisted-outside-India nuances, slump sale, buyback
 *    taxation changes, and business/presumptive income (explicitly out of
 *    scope per the Phase 2 brief).
 */
import { percentOf, roundPaisa } from "./rounding";

export const STCG_EQUITY_RATE_PERCENT = 20; // Section 111A
export const LTCG_EQUITY_RATE_PERCENT = 12.5; // Section 112A
export const LTCG_EQUITY_EXEMPTION = 125_000; // Section 112A annual exemption
export const LTCG_OTHER_RATE_PERCENT = 12.5; // Section 112, no indexation (default rule)
export const LTCG_OTHER_WITH_INDEXATION_RATE_PERCENT = 20; // Section 112, transitional option for pre-23-Jul-2024 immovable property
export const CAPITAL_GAINS_SURCHARGE_CAP_PERCENT = 15; // Sections 111A/112/112A

/** The date Budget 2024's new capital-gains regime took effect; also the grandfathering cutoff for the property indexation option. */
export const CAPITAL_GAINS_REGIME_CHANGE_DATE = "2024-07-23";

export type CapitalAssetType =
  | "listedEquityOrEquityMF"
  | "unlistedShares"
  | "debtMutualFund"
  | "immovableProperty"
  | "gold"
  | "otherAsset";

export interface CapitalGainTransactionInput {
  assetType: CapitalAssetType;
  /** Gain (positive) or loss (negative) on this transaction. */
  gainAmount: number;
  /** Holding period in months; ignored for `debtMutualFund` (always short-term per Section 50AA). */
  holdingPeriodMonths: number;
  /**
   * Only meaningful for `assetType: "immovableProperty"` with a long-term
   * holding period: true if acquired before 23 July 2024, making the
   * indexation transitional option available.
   */
  acquiredBeforeRegimeChange?: boolean;
  /**
   * The gain as computed WITH indexation (i.e. sale price minus indexed
   * cost of acquisition), supplied by the caller for pre-23-Jul-2024
   * immovable property so this module can compare 12.5%-no-indexation vs.
   * 20%-with-indexation and use whichever is lower. If omitted, the
   * 12.5%-no-indexation default is used even for eligible property.
   */
  indexedGainAmount?: number;
}

export type HoldingClassification = "short" | "long";

export function classifyHoldingPeriod(assetType: CapitalAssetType, holdingPeriodMonths: number): HoldingClassification {
  if (assetType === "debtMutualFund") return "short"; // Section 50AA: always short-term
  const longTermThresholdMonths = assetType === "listedEquityOrEquityMF" ? 12 : 24;
  return holdingPeriodMonths > longTermThresholdMonths ? "long" : "short";
}

interface PerTransactionTax {
  transaction: CapitalGainTransactionInput;
  classification: HoldingClassification;
  /** Tax computed on this single transaction, if it falls in a special (flat-rate) bucket; 0 for slab-rate buckets (tax computed later, at the slab level). */
  specialRateTax: number;
  /** Method used for LTCG-other transactions eligible for the indexation comparison. */
  indexationOptionUsed: "notApplicable" | "noIndexation12.5%" | "withIndexation20%";
}

function computeLtcgOtherTransactionTax(t: CapitalGainTransactionInput): {
  tax: number;
  method: PerTransactionTax["indexationOptionUsed"];
  /**
   * The taxable-gain figure actually used to arrive at `tax` (raw gain for
   * the no-indexation method, indexed gain for the with-indexation method).
   * Callers must accumulate THIS (not the raw `gainAmount`) into any
   * "total income" figure — see the bug this fixed, below.
   */
  taxableGainUsed: number;
} {
  const gain = Math.max(0, t.gainAmount);
  const noIndexationTax = roundPaisa(percentOf(gain, LTCG_OTHER_RATE_PERCENT));

  const grandfatheringEligible =
    t.assetType === "immovableProperty" && t.acquiredBeforeRegimeChange === true && t.indexedGainAmount !== undefined;

  if (!grandfatheringEligible) {
    return { tax: noIndexationTax, method: "notApplicable", taxableGainUsed: gain };
  }

  const indexedGain = Math.max(0, t.indexedGainAmount as number);
  const withIndexationTax = roundPaisa(percentOf(indexedGain, LTCG_OTHER_WITH_INDEXATION_RATE_PERCENT));

  if (withIndexationTax < noIndexationTax) {
    // Bug fix (adversarial review, 2026-07-28): this branch used to still
    // accumulate the caller's RAW (pre-indexation) gainAmount into
    // ltcgOtherTaxableGainEquivalent even though tax was computed on the
    // smaller indexedGain. That inflated `totalSpecialRateTaxableIncome` (and
    // therefore fullIncome.ts's `totalIncome`) by the indexation benefit
    // whenever the cheaper with-indexation method was chosen — which could
    // wrongly push a taxpayer's total income above the Section 87A ₹12L
    // rebate threshold or into a higher surcharge band than their actual
    // taxable income supports. Now returns the indexed gain, matching what
    // was actually taxed.
    return { tax: withIndexationTax, method: "withIndexation20%", taxableGainUsed: indexedGain };
  }
  return { tax: noIndexationTax, method: "noIndexation12.5%", taxableGainUsed: gain };
}

export interface CapitalGainsResult {
  perTransaction: PerTransactionTax[];
  /** Net STCG on listed equity/equity MF (Section 111A), floored at 0 for tax purposes. */
  stcgEquityNetGain: number;
  stcgEquityTax: number;
  /** Net LTCG on listed equity/equity MF (Section 112A) before the annual exemption, floored at 0. */
  ltcgEquityNetGain: number;
  /** Net LTCG on listed equity/equity MF after the ₹1,25,000 exemption, floored at 0. */
  ltcgEquityTaxableGain: number;
  ltcgEquityTax: number;
  /** Net LTCG on all other assets (Section 112), summed per-transaction tax (see file header on indexation option). */
  ltcgOtherTax: number;
  ltcgOtherTaxableGainEquivalent: number;
  /**
   * Net STCG on every asset that is NOT taxed at a special rate — unlisted
   * shares, property, gold held short-term, and ALL debt/specified-mutual-
   * fund gains (Section 50AA) regardless of holding period. Floored at 0.
   * This is NOT taxed by this module; it must be added to slab-rate taxable
   * income by the caller (see `fullIncome.ts`).
   */
  stcgOtherSlabRateIncome: number;
  /** Sum of stcgEquityTax + ltcgEquityTax + ltcgOtherTax — the total special-rate capital-gains tax, before surcharge/cess. */
  totalSpecialRateTax: number;
  /**
   * Sum of the taxABLE amounts behind totalSpecialRateTax (stcgEquityNetGain
   * + ltcgEquityTaxableGain + ltcgOtherTaxableGainEquivalent) — this is what
   * gets added to slab-rate taxable income to form "total income" for
   * Section 87A rebate threshold and surcharge-band purposes. It intentionally
   * excludes stcgOtherSlabRateIncome, which is already counted once it's
   * folded into slab-rate taxable income.
   */
  totalSpecialRateTaxableIncome: number;
}

export function computeCapitalGains(transactions: CapitalGainTransactionInput[]): CapitalGainsResult {
  let stcgEquityNetGain = 0;
  let ltcgEquityNetGain = 0;
  let ltcgOtherTax = 0;
  let ltcgOtherTaxableGainEquivalent = 0;
  let stcgOtherSlabRateIncome = 0;
  const perTransaction: PerTransactionTax[] = [];

  for (const t of transactions) {
    const classification = classifyHoldingPeriod(t.assetType, t.holdingPeriodMonths);

    if (t.assetType === "listedEquityOrEquityMF") {
      if (classification === "short") {
        stcgEquityNetGain += t.gainAmount;
        perTransaction.push({ transaction: t, classification, specialRateTax: 0, indexationOptionUsed: "notApplicable" });
      } else {
        ltcgEquityNetGain += t.gainAmount;
        perTransaction.push({ transaction: t, classification, specialRateTax: 0, indexationOptionUsed: "notApplicable" });
      }
      continue;
    }

    if (classification === "short") {
      // Includes debtMutualFund (always short, Section 50AA), unlistedShares,
      // immovableProperty, gold, otherAsset held short-term: all slab-rate.
      stcgOtherSlabRateIncome += t.gainAmount;
      perTransaction.push({ transaction: t, classification, specialRateTax: 0, indexationOptionUsed: "notApplicable" });
      continue;
    }

    // Long-term, non-equity: Section 112.
    const { tax, method, taxableGainUsed } = computeLtcgOtherTransactionTax(t);
    ltcgOtherTax = roundPaisa(ltcgOtherTax + tax);
    ltcgOtherTaxableGainEquivalent += taxableGainUsed;
    perTransaction.push({ transaction: t, classification, specialRateTax: tax, indexationOptionUsed: method });
  }

  const stcgEquityFloored = Math.max(0, stcgEquityNetGain);
  const stcgEquityTax = roundPaisa(percentOf(stcgEquityFloored, STCG_EQUITY_RATE_PERCENT));

  const ltcgEquityFloored = Math.max(0, ltcgEquityNetGain);
  const ltcgEquityTaxableGain = Math.max(0, ltcgEquityFloored - LTCG_EQUITY_EXEMPTION);
  const ltcgEquityTax = roundPaisa(percentOf(ltcgEquityTaxableGain, LTCG_EQUITY_RATE_PERCENT));

  const stcgOtherFloored = Math.max(0, stcgOtherSlabRateIncome);

  const totalSpecialRateTax = roundPaisa(stcgEquityTax + ltcgEquityTax + ltcgOtherTax);
  const totalSpecialRateTaxableIncome = stcgEquityFloored + ltcgEquityTaxableGain + ltcgOtherTaxableGainEquivalent;

  return {
    perTransaction,
    stcgEquityNetGain: stcgEquityFloored,
    stcgEquityTax,
    ltcgEquityNetGain: ltcgEquityFloored,
    ltcgEquityTaxableGain,
    ltcgEquityTax,
    ltcgOtherTax,
    ltcgOtherTaxableGainEquivalent,
    stcgOtherSlabRateIncome: stcgOtherFloored,
    totalSpecialRateTax,
    totalSpecialRateTaxableIncome,
  };
}
