/**
 * Foreign-source income and the Foreign Tax Credit (FTC) for AY 2026-27
 * (FY 2025-26) — Phase 11.
 *
 * This module exists for the most common foreign-asset case among salaried
 * Indian filers: RSUs/ESOPs in a foreign (usually US) parent company, which
 * typically produce (a) a vesting perquisite already taxed as salary through
 * Form 16, (b) dividends withheld at source abroad, and (c) capital gains on
 * eventual sale. It is deliberately general enough to also cover foreign bank
 * interest and other foreign equity.
 *
 * ============================================================================
 * WHAT IS AND ISN'T COMPUTED HERE
 * ============================================================================
 * This module does NOT introduce a new tax RATE. Foreign-source income is
 * taxed in India under the ordinary head it belongs to:
 *  - Foreign dividends/interest -> "income from other sources", SLAB rates.
 *    There is no special rate for foreign dividends received by a resident
 *    individual (Section 115BBDA, which once taxed large domestic dividends
 *    at 10%, was abolished with effect from AY 2021-22, and never applied to
 *    foreign dividends anyway). Verified 2026-08-01 via web search:
 *    paasa.com ("Tax on Foreign Dividends in India: Rates & Rules"),
 *    vakilsearch.com ("Tax on Dividend income India and Foreign Stocks"),
 *    winvesta.in ("DTAA India-US tax treaty ... 2026") — all state foreign
 *    dividends are reported under Income from Other Sources and taxed at the
 *    taxpayer's applicable slab rate.
 *  - Foreign shares (including US-listed RSU shares) sold -> capital gains,
 *    handled by the EXISTING `capitalGains.ts` under its `unlistedShares`
 *    asset type: shares of a foreign company are not listed on a *recognised
 *    Indian* stock exchange, so for Indian holding-period purposes they get
 *    the 24-month long-term threshold (not 12), Section 112's flat 12.5%
 *    LTCG rate with no indexation, and slab-rate treatment for short-term
 *    gains — NOT Section 111A's 20% STCG or Section 112A's 12.5%-over-
 *    ₹1,25,000 LTCG, both of which are listed-equity-only. Verified
 *    2026-08-01: filewise.in ("RSU taxation in India (FY 2025-26)"),
 *    equitylist.co ("RSU Taxation in India"), rovia.one ("How to File Taxes
 *    for US RSUs in India (2026)"), taxgarden.in ("Unlisted Shares Tax:
 *    12.5% LTCG, FMV Rules (AY 2026-27)") — all agree US-listed shares are
 *    treated like unlisted shares for the Indian holding-period test.
 *  - RSU/ESOP VESTING is a Section 17(2) perquisite already included in
 *    salary (and in Form 16). It must therefore NEVER be added again here —
 *    see `alreadyIncludedInIndianIncome` below, which is the mechanism that
 *    prevents that double-count.
 *
 * What this module DOES compute is the Foreign Tax Credit under Section 90/
 * 90A/91 read with Rule 128 of the Income-tax Rules, 1962.
 *
 * ============================================================================
 * RULE 128 — THE FTC COMPUTATION, AS IMPLEMENTED
 * ============================================================================
 * Verified 2026-08-01 against the rule text (incometaxindia.gov.in's own
 * Rule 128 page returns HTTP 403 to automated fetches; the text below was
 * cross-checked against thakurani.in's reproduction of the rule, plus
 * indiafilings.com, tax2win.in and cleartax.in's Form 67 explainers, all of
 * which quote the same operative wording):
 *
 *  - Rule 128(3): "The credit ... shall be available against the amount of
 *    tax, surcharge and cess payable under the Act but not in respect of any
 *    sum payable by way of interest, fee or penalty." Hence the Indian-tax
 *    figure this module compares against is the GROSS tax liability
 *    INCLUDING surcharge and health & education cess, and interest under
 *    Sections 234A/B/C is excluded (this app never computes 234 interest
 *    anyway).
 *  - Rule 128(5): the credit is "the aggregate of the amounts of credit
 *    computed separately for each source of income arising from a particular
 *    country or specified territory outside India" — so this module computes
 *    per-source, per-country credits and sums them, rather than doing one
 *    aggregate min().
 *  - Rule 128(5)(i): "the credit shall be the lower of the tax payable under
 *    the Act on such income and the foreign tax paid on such income" —
 *    the cap this module implements literally.
 *  - Proviso to Rule 128(5)(i): "where the foreign tax paid exceeds the
 *    amount of tax payable in accordance with the provisions of the
 *    agreement for relief or avoidance of double taxation, such excess shall
 *    be ignored" — implemented via the optional `dtaaRateCapPercent`. For the
 *    India-US treaty the relevant retail cap is Article 10's 25% dividend
 *    rate (15% only where the beneficial owner is a company holding >=10% of
 *    the voting stock, which never applies to a retail RSU holder). Verified
 *    2026-08-01: winvesta.in, paasa.com ("India-US DTAA"), toolisky.com
 *    ("Foreign Dividend Tax in India 2026: 25% US WHT & DTAA Relief").
 *
 * "TAX PAYABLE UNDER THE ACT ON SUCH INCOME": Rule 128 does not prescribe a
 * formula, and the settled practice (and what the e-filing utility's own
 * Schedule FSI column (d) expects) is the AVERAGE-RATE method: the
 * taxpayer's total Indian tax liability divided by total income, applied to
 * the foreign income. Verified 2026-08-01 via search summaries of
 * pkcindia.com, tax2win.in ("Foreign Tax Credit (FTC) in India: Rules,
 * Calculation & Form 67") and cleartax.in ("How to Claim Tax Credit on
 * Foreign Income of a Resident"), which all describe
 * `averageRate = Indian tax liability / total income` applied to the foreign
 * income component. This is an approximation for a taxpayer whose foreign
 * income sits entirely in a marginal slab (it can under- or over-state the
 * "true" marginal attribution) — flagged in PROGRESS.md as a documented
 * judgment call, not a silently-chosen shortcut.
 *
 * ============================================================================
 * FORM 67 IS A HARD PREREQUISITE — THIS APP CANNOT FILE IT
 * ============================================================================
 * Rule 128(8)/(9): the FTC claim is allowed only on furnishing Form 67 (plus
 * a certificate/statement of the foreign tax) on the e-filing portal. Since
 * CBDT Notification No. 100/2022 dated 18-08-2022 amended sub-rule (9), the
 * deadline is "on or before the end of the assessment year" (i.e. 31 March
 * 2027 for AY 2026-27), provided the return itself is filed within the
 * Section 139(1) or 139(4) window; for an updated return under Section
 * 139(8A), Form 67 must be filed on or before the date of that updated
 * return. Verified 2026-08-01: the CBDT's own @IncomeTaxIndia announcement of
 * Notification 100/2022, taxcorner.co.in, fintaxblog.com, ey.com's alert on
 * the Madras High Court's delayed-Form-67 ruling. THIS APP CANNOT FILE FORM
 * 67 (it never submits anything to the portal — a fixed project boundary,
 * see PROGRESS.md's Phase 7 notes), so every UI surface that shows an FTC
 * figure must say so explicitly, or the user silently loses the credit.
 *
 * ============================================================================
 * NOT MODELED (deliberate scope limits)
 * ============================================================================
 *  - FTC against MAT/AMT (Sections 115JB/115JC) and the Rule 128(7) carry-
 *    forward of excess credit in those cases — this app models salaried
 *    resident individuals with no presumptive/business income, so AMT never
 *    arises here.
 *  - Rule 128(4)'s disallowance of credit for foreign tax that is "disputed
 *    in any manner" — the app has no field for a disputed foreign tax and
 *    assumes every entered figure is undisputed.
 *  - The Rule 128(5)(ii) currency-conversion rule (telegraphic transfer
 *    buying rate on the last day of the month immediately preceding the
 *    month in which the foreign tax was paid/deducted). This module takes
 *    already-converted INR figures; converting is the user's job, and the UI
 *    states the rule. Note this is a DIFFERENT rate/date convention from
 *    Schedule FA's asset valuation (TTBR on the date of peak balance /
 *    investment / 31 December) — the two must not be conflated.
 */

import { percentOf, roundPaisa } from "./rounding";

/** Schedule FSI's four income heads (`IncFromSal`/`IncFromHP`/`IncCapGain`/`IncOthSrc` in the real ITR-2 JSON schema). */
export type ForeignIncomeHead = "salary" | "houseProperty" | "capitalGains" | "otherSources";

/**
 * Which relief provision the credit is claimed under — matches the real
 * ITR-2 schema's `ScheduleTR.ReliefClaimedUsSection` enum exactly
 * (`"90" | "90A" | "91"`):
 *  - 90  — bilateral relief under a DTAA with a foreign country (the US
 *          treaty case this app is primarily built for).
 *  - 90A — relief under an agreement with a "specified association" in a
 *          specified territory (rare).
 *  - 91  — unilateral relief where no DTAA exists with that country.
 */
export type ForeignTaxReliefSection = "90" | "90A" | "91";

export interface ForeignSourceIncomeInput {
  /** ISD-style country code matching the ITR schema's `CountryCodeExcludingIndia` enum (e.g. "2" = United States of America). */
  countryCode: string;
  /** Free-text country name for Schedule FSI/TR's `CountryName`. */
  countryName: string;
  /** Taxpayer Identification Number in that country (or passport number if none was allotted) — required by Schedule FSI/TR. */
  taxIdentificationNumber: string;
  head: ForeignIncomeHead;
  /** Gross foreign income in INR, BEFORE foreign withholding tax (the gross figure is what is taxable in India; the withheld amount is claimed separately as FTC, it is not a deduction from income). */
  incomeInr: number;
  /** Foreign tax actually paid/withheld on that income, in INR. */
  foreignTaxPaidInr: number;
  /**
   * Treaty-capped rate, if a DTAA limits the source country's taxing right
   * (proviso to Rule 128(5)(i): foreign tax paid in excess of the treaty
   * rate is IGNORED for credit purposes). E.g. 25 for US dividends paid to
   * an Indian-resident retail investor under Article 10(2)(b) of the
   * India-US DTAA. Omit when no treaty cap applies (Section 91 cases, or
   * income the treaty doesn't rate-limit).
   */
  dtaaRateCapPercent?: number;
  reliefSection: ForeignTaxReliefSection;
  /**
   * True when this income is ALREADY counted in the other `FullIncomeInput`
   * buckets and must NOT be added again — the single most important field
   * here, and the mechanism that prevents the classic RSU double-taxation
   * bug:
   *  - RSU/ESOP vesting perquisite: already inside `grossSalaryIncludingHra`
   *    via Form 16 -> `true`.
   *  - RSU sale: already entered as a `capitalGainTransactions` entry ->
   *    `true`.
   *  - Foreign rent: already entered as a `houseProperties` entry -> `true`.
   *  - Foreign dividend/interest not entered anywhere else -> `false`, and
   *    this module adds it to slab-rate other-sources income.
   *
   * A source with `false` and a head other than `"otherSources"` is rejected
   * (see `ForeignIncomeInputError`) rather than silently mis-taxed: adding a
   * capital gain to slab income, or salary to other-sources, would both be
   * wrong, and guessing is worse than failing loudly.
   */
  alreadyIncludedInIndianIncome: boolean;
}

export class ForeignIncomeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForeignIncomeInputError";
  }
}

export interface ForeignTaxCreditPerSource {
  countryCode: string;
  countryName: string;
  /** Carried through from the input so `packages/itr-schema` can build Schedules FSI and TR (both require `TaxIdentificationNo`) entirely from this result, with no second parallel input list to keep in sync. */
  taxIdentificationNumber: string;
  head: ForeignIncomeHead;
  reliefSection: ForeignTaxReliefSection;
  /** Gross foreign income in INR (floored at 0). */
  foreignIncome: number;
  /** Foreign tax paid as entered (floored at 0). */
  foreignTaxPaid: number;
  /** Foreign tax after applying the treaty-rate cap, i.e. the proviso to Rule 128(5)(i). Equals `foreignTaxPaid` when no `dtaaRateCapPercent` was supplied. */
  eligibleForeignTax: number;
  /** `foreignTaxPaid - eligibleForeignTax` — the excess over the treaty rate, permanently lost (not creditable, not deductible). Surfaced so the UI can warn about it rather than silently dropping it. */
  foreignTaxIgnoredAboveTreatyRate: number;
  /** Average-rate Indian tax attributable to this income — see file header. */
  indianTaxOnThisIncome: number;
  /** min(eligibleForeignTax, indianTaxOnThisIncome) — Rule 128(5)(i). */
  creditAllowed: number;
  /** Which side of the min() bound the credit (useful for UI explanation). */
  limitedBy: "foreignTax" | "indianTax";
}

export interface ForeignTaxCreditResult {
  /**
   * Total Indian tax liability / total income, as a percentage, rounded to
   * paisa precision FOR DISPLAY ONLY. 0 when total income is 0. The
   * per-source computation deliberately uses the UNROUNDED ratio — rounding
   * a *rate* to 2 dp costs ₹10 per ₹1,00,000 of foreign income, which is a
   * real (if small) error in a figure that directly reduces tax payable.
   */
  averageRateOfTaxPercent: number;
  perSource: ForeignTaxCreditPerSource[];
  totalForeignIncome: number;
  totalForeignTaxPaid: number;
  /** Sum of the per-source credits, before the overall "can't exceed the Indian tax actually payable" cap. */
  totalCreditBeforeOverallCap: number;
  /** min(totalCreditBeforeOverallCap, grossTaxLiability) — the amount actually relievable. */
  totalCredit: number;
  /** Portion of `totalCredit` claimed under Sections 90/90A (ITR-2 `TaxRelief.Section90`). */
  creditUnderSection90: number;
  /** Portion of `totalCredit` claimed under Section 91 (ITR-2 `TaxRelief.Section91`). */
  creditUnderSection91: number;
}

/** Empty (no foreign income) result — also what every caller that omits `foreignSourceIncomes` entirely gets, so nothing downstream needs a null check. */
export const EMPTY_FOREIGN_TAX_CREDIT: ForeignTaxCreditResult = {
  averageRateOfTaxPercent: 0,
  perSource: [],
  totalForeignIncome: 0,
  totalForeignTaxPaid: 0,
  totalCreditBeforeOverallCap: 0,
  totalCredit: 0,
  creditUnderSection90: 0,
  creditUnderSection91: 0,
};

/**
 * Validates the "don't double-count" invariant. Called by
 * `computeFullTaxableIncome` before anything else touches these rows, so a
 * mis-classified source fails at the top of the computation with a clear
 * message rather than producing a plausible-looking wrong number.
 */
export function assertForeignSourceIncomesAreWellFormed(sources: readonly ForeignSourceIncomeInput[]): void {
  for (const [index, source] of sources.entries()) {
    if (!source.alreadyIncludedInIndianIncome && source.head !== "otherSources") {
      throw new ForeignIncomeInputError(
        `foreignSourceIncomes[${index}] has head "${source.head}" with alreadyIncludedInIndianIncome=false. ` +
          "Only other-sources income (foreign dividends/interest) can be added to Indian total income by this module — " +
          "foreign salary must be entered in gross salary, foreign capital gains as a capital-gain transaction, and " +
          "foreign rent as a house property, each with alreadyIncludedInIndianIncome=true. See foreignIncome.ts's header.",
      );
    }
  }
}

/**
 * The foreign income this module ADDS to slab-rate other-sources income:
 * other-sources-head income not already counted elsewhere (i.e. foreign
 * dividends and foreign bank interest). Everything else is already inside
 * one of `FullIncomeInput`'s existing buckets — see
 * `ForeignSourceIncomeInput.alreadyIncludedInIndianIncome`.
 */
export function sumForeignSlabRateIncome(sources: readonly ForeignSourceIncomeInput[]): number {
  return sources
    .filter((s) => !s.alreadyIncludedInIndianIncome && s.head === "otherSources")
    .reduce((sum, s) => sum + Math.max(0, s.incomeInr), 0);
}

export interface ComputeForeignTaxCreditParams {
  sources: readonly ForeignSourceIncomeInput[];
  /** The taxpayer's total income (post-Chapter-VI-A, slab + special-rate) — the denominator of the average rate. */
  totalIncome: number;
  /** Gross Indian tax liability INCLUDING surcharge and cess, before any relief (Rule 128(3)) — the numerator of the average rate, and the overall cap on total credit. */
  grossTaxLiability: number;
}

export function computeForeignTaxCredit(params: ComputeForeignTaxCreditParams): ForeignTaxCreditResult {
  const { sources, totalIncome, grossTaxLiability } = params;
  if (sources.length === 0) return EMPTY_FOREIGN_TAX_CREDIT;

  const safeTotalIncome = Math.max(0, totalIncome);
  const safeGrossTax = Math.max(0, grossTaxLiability);
  // Guard against divide-by-zero: a taxpayer with zero total income owes zero
  // Indian tax, so the Rule 128(5)(i) cap binds at 0 and no credit is
  // available regardless of how much foreign tax was withheld.
  const averageRateOfTaxFraction = safeTotalIncome > 0 ? safeGrossTax / safeTotalIncome : 0;
  const averageRateOfTaxPercent = roundPaisa(averageRateOfTaxFraction * 100);

  const perSource: ForeignTaxCreditPerSource[] = sources.map((source) => {
    const foreignIncome = Math.max(0, source.incomeInr);
    const foreignTaxPaid = Math.max(0, source.foreignTaxPaidInr);

    // Proviso to Rule 128(5)(i): foreign tax charged above the treaty rate is ignored.
    const treatyCap =
      source.dtaaRateCapPercent === undefined ? undefined : roundPaisa(percentOf(foreignIncome, Math.max(0, source.dtaaRateCapPercent)));
    const eligibleForeignTax = treatyCap === undefined ? foreignTaxPaid : Math.min(foreignTaxPaid, treatyCap);
    const foreignTaxIgnoredAboveTreatyRate = roundPaisa(foreignTaxPaid - eligibleForeignTax);

    const indianTaxOnThisIncome = roundPaisa(foreignIncome * averageRateOfTaxFraction);
    const creditAllowed = Math.min(eligibleForeignTax, indianTaxOnThisIncome);

    return {
      countryCode: source.countryCode,
      countryName: source.countryName,
      taxIdentificationNumber: source.taxIdentificationNumber,
      head: source.head,
      reliefSection: source.reliefSection,
      foreignIncome,
      foreignTaxPaid,
      eligibleForeignTax,
      foreignTaxIgnoredAboveTreatyRate,
      indianTaxOnThisIncome,
      creditAllowed,
      // Ties (equal on both sides) are reported as `indianTax`: the Indian
      // limb is the one that actually constrains the taxpayer in the
      // ambiguous case, and reporting a single deterministic value keeps this
      // field a simple discriminant rather than a three-way one.
      limitedBy: eligibleForeignTax < indianTaxOnThisIncome ? "foreignTax" : "indianTax",
    };
  });

  const totalCreditBeforeOverallCap = roundPaisa(perSource.reduce((sum, s) => sum + s.creditAllowed, 0));
  const totalCredit = Math.min(totalCreditBeforeOverallCap, safeGrossTax);

  // The overall cap can shave the sum; apportion the shaved total between the
  // Section 90/90A and Section 91 buckets in proportion to their uncapped
  // credits so the two ITR-2 `TaxRelief` lines always add up to `totalCredit`
  // exactly (the real schema has no "unallocated relief" field, and a
  // mismatch there is exactly the kind of internal inconsistency the
  // department's utility flags).
  const uncapped90 = roundPaisa(perSource.filter((s) => s.reliefSection !== "91").reduce((sum, s) => sum + s.creditAllowed, 0));
  const scale = totalCreditBeforeOverallCap > 0 ? totalCredit / totalCreditBeforeOverallCap : 0;
  const creditUnderSection90 = roundPaisa(uncapped90 * scale);
  const creditUnderSection91 = roundPaisa(totalCredit - creditUnderSection90);

  return {
    averageRateOfTaxPercent,
    perSource,
    totalForeignIncome: roundPaisa(perSource.reduce((sum, s) => sum + s.foreignIncome, 0)),
    totalForeignTaxPaid: roundPaisa(perSource.reduce((sum, s) => sum + s.foreignTaxPaid, 0)),
    totalCreditBeforeOverallCap,
    totalCredit,
    creditUnderSection90,
    creditUnderSection91,
  };
}
