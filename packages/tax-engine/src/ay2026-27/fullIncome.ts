/**
 * Phase 2 full income aggregation: composes salary + HRA + house property +
 * capital gains + other sources + Chapter VI-A deductions into (a) a
 * slab-rate taxable income figure that can be fed straight into the
 * existing, untouched `computeTaxFromTaxableIncome` from `computeTax.ts`,
 * and (b) the capital-gains breakdown needed to add special-rate tax on top
 * (see `computeTaxFull.ts`, which is the orchestrator that actually does
 * that combination — this module only assembles the income figures).
 *
 * This is additive to, not a replacement for, `income.ts` (which stays as
 * the Phase-1-only minimal salary+other-sources aggregator and is not
 * modified). Regime-conditional rules (HRA exemption, house-property
 * interest caps and loss set-off, Chapter VI-A availability) are each
 * delegated to their own module (`hra.ts`, `houseProperty.ts`,
 * `deductions.ts`), which are themselves regime-aware — this module just
 * wires the regime through consistently so callers building a full income
 * profile don't have to re-derive any regime rule themselves.
 *
 * Section 288A rounding (nearest ₹10) is applied to the slab-rate portion
 * only, at the same layer as Phase 1's `income.ts`, for the same reason:
 * `computeTax.ts` deliberately never rounds its own input so boundary-value
 * tests stay exact.
 */
import type { AgeCategory, Regime } from "../types";
import { getAgeCategory, NEW_REGIME_STANDARD_DEDUCTION, OLD_REGIME_STANDARD_DEDUCTION } from "./slabs";
import { roundToNearestTen } from "./rounding";
import { getHraExemptionForRegime, type HraExemptionInput, type HraExemptionResult } from "./hra";
import {
  aggregateHousePropertyIncome,
  housePropertyContributionToGrossTotalIncome,
  type HousePropertyAggregateResult,
  type HousePropertyInput,
} from "./houseProperty";
import { computeCapitalGains, type CapitalGainTransactionInput, type CapitalGainsResult } from "./capitalGains";
import { computeChapterVIA, type ChapterVIAInput, type ChapterVIAResult } from "./deductions";
import {
  assertForeignSourceIncomesAreWellFormed,
  sumForeignSlabRateIncome,
  type ForeignSourceIncomeInput,
} from "./foreignIncome";

export type DeductionsInput = Omit<ChapterVIAInput, "regime" | "age">;

const ZERO_DEDUCTIONS: DeductionsInput = {
  section80C: 0,
  section80D: {
    selfAndFamilyPremium: 0,
    selfOrFamilyHasSenior: false,
    parentsPremium: 0,
    parentsHaveSenior: false,
    preventiveHealthCheckup: 0,
  },
  section80CCD1B: 0,
  section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" },
  interestIncomeForTtaOrTtb: 0,
};

export interface FullIncomeInput {
  isSalaried: boolean;
  /** Gross salary INCLUDING HRA received, before standard deduction and before any HRA exemption. */
  grossSalaryIncludingHra: number;
  hra?: HraExemptionInput;
  /**
   * Section 10 exemptions OTHER than HRA that survive BOTH regimes —
   * principally the retirement heads a Form 16 lists under item 2:
   * gratuity 10(10), commuted pension 10(10A), leave encashment 10(10AA),
   * and VRS compensation 10(10C).
   *
   * Deducted from gross salary in both the old and new regimes. Verified
   * 2026-08-07 against ClearTax's Section 115BAC guide
   * (cleartax.in/c/section-115bac-for-new-tax-regime) and Tax2win's
   * (tax2win.in/guide/section-115bac-of-income-tax-act), which both state
   * that exemptions for gratuity 10(10), leave encashment 10(10AA) and VRS
   * 10(10C) remain available under the new regime — unlike HRA 10(13A) and
   * LTA 10(5), which do not (and which `oldRegimeOnlySection10Exemptions`
   * below covers).
   *
   * This split is not academic: a real AY 2026-27 Form 16 for a taxpayer who
   * had NOT opted out of 115BAC (i.e. on the new regime) still claimed
   * ₹3,51,000 of leave encashment exemption. Folding these into the
   * old-regime-only bucket would silently over-tax exactly that case.
   *
   * Optional/defaults to 0 so every caller and fixture predating this field
   * keeps compiling and behaving identically.
   */
  otherSection10Exemptions?: number;
  /**
   * Section 10 exemptions available under the OLD regime ONLY, excluding HRA
   * (which has its own dedicated `hra` input and regime handling). In
   * practice this is LTA/travel concession 10(5) plus the special allowances
   * under 10(14) that the new regime withdraws.
   *
   * Ignored entirely under the new regime — see the sources cited on
   * `otherSection10Exemptions` above. Optional/defaults to 0.
   */
  oldRegimeOnlySection10Exemptions?: number;
  /**
   * Section 16(iii) tax on employment ("professional tax"), as deducted by
   * the employer and shown on Form 16 item 4(c).
   *
   * OLD REGIME ONLY. Verified 2026-08-07 (cleartax.in/c/section-115bac-for-
   * new-tax-regime, tax2win.in/guide/section-115bac-of-income-tax-act,
   * canarahsbclife.com's Section 16 guide): under 115BAC the standard
   * deduction is the only Section 16 deduction that survives — both
   * entertainment allowance 16(ii) and professional tax 16(iii) are
   * withdrawn. Optional/defaults to 0.
   */
  professionalTax?: number;
  houseProperties: HousePropertyInput[];
  capitalGainTransactions: CapitalGainTransactionInput[];
  /**
   * Income from other sources (e.g. bank/FD interest, dividends), no
   * deductions netted in yet. Does NOT include lottery/game-show/race-horse
   * winnings — those are Section 115BB special-rate income and must be
   * supplied separately via `lotteryOrGameWinningsIncome` (see that field's
   * doc comment; folding them in here would tax them at slab rates, which
   * is wrong — see `computeTaxFull.ts`'s file header for the bug this fixed).
   */
  otherSourcesIncome: number;
  /**
   * Winnings from lotteries, crossword puzzles, card games, betting,
   * gambling, horse races, or any game of any sort (Section 115BB) —
   * ALWAYS taxed at a flat 30%, with no basic-exemption benefit, no
   * Chapter VI-A deductions, and no Section 87A rebate, regardless of the
   * taxpayer's slab. Kept as a separate bucket from `otherSourcesIncome`
   * (which is slab-rate) for exactly that reason — see `computeTaxFull.ts`.
   * Optional/defaults to 0 so every existing caller/fixture that predates
   * this field keeps compiling and behaving identically.
   */
  lotteryOrGameWinningsIncome?: number;
  /**
   * Phase 11: foreign-source income rows for Schedule FSI/TR and the
   * Foreign Tax Credit computation (see `foreignIncome.ts`). Optional and
   * defaulting to `[]` so every caller/fixture that predates this field
   * keeps compiling and behaving identically — the same additive shape the
   * Phase 6 review used for `lotteryOrGameWinningsIncome`.
   *
   * Rows flagged `alreadyIncludedInIndianIncome` (RSU vesting perquisite
   * inside gross salary, RSU sale already entered as a capital-gain
   * transaction, foreign rent already entered as a house property) affect
   * ONLY the FTC computation — they are never added to income again here.
   * Rows NOT so flagged must be other-sources-head income (foreign
   * dividends/interest) and are added to slab-rate other-sources income;
   * anything else throws `ForeignIncomeInputError` rather than being
   * silently mis-taxed.
   */
  foreignSourceIncomes?: ForeignSourceIncomeInput[];
  deductions?: DeductionsInput;
}

export interface FullTaxableIncomeResult {
  ageCategory: AgeCategory;
  hra: HraExemptionResult | null;
  standardDeduction: number;
  /**
   * Section 16(iii) professional tax actually allowed after the regime test
   * (always 0 under the new regime) — exposed so the summary screen and the
   * ITR's Section 16 lines can show what was really deducted rather than
   * what was entered.
   */
  professionalTaxAllowed: number;
  /**
   * Total Section 10 exemptions actually applied, HRA included — the
   * equivalent of Form 16 Part B item 2(i). Exposed so a user can reconcile
   * the app's figure against their certificate line by line.
   */
  totalSection10Exemptions: number;
  /** Salary after Section 10 exemptions but BEFORE Section 16 deductions — Form 16 item 3. */
  salaryAfterSection10: number;
  salaryTaxable: number;
  houseProperty: HousePropertyAggregateResult;
  housePropertyContribution: number;
  capitalGains: CapitalGainsResult;
  /**
   * Slab-rate other-sources income, INCLUDING `foreignSlabRateIncome` below
   * (foreign dividends/interest are ordinary "income from other sources"
   * taxed at slab rates — see `foreignIncome.ts`'s header). Folding them in
   * here rather than keeping a parallel bucket is deliberate: every
   * downstream consumer (`taxComputationMapping.ts`'s gross-total-income
   * sum, `itr2Mapper.ts`'s Schedule OS / PartB-TI "IncFromOS" lines) wants
   * the combined figure, which is also what the real ITR's Schedule OS
   * expects — foreign dividends are reported there AND, separately, in
   * Schedule FSI.
   */
  otherSourcesIncome: number;
  /** The foreign-source portion of `otherSourcesIncome` above — exposed separately for display/audit and for Schedule FSI, NOT to be added again anywhere. */
  foreignSlabRateIncome: number;
  /** The raw foreign-source rows as supplied (empty when the caller omitted them) — carried through so `computeTaxFull.ts` can compute the FTC without re-plumbing the input. */
  foreignSourceIncomes: ForeignSourceIncomeInput[];
  /** Section 115BB winnings (floored at 0) — see `FullIncomeInput.lotteryOrGameWinningsIncome`. NOT included in `slabTaxableIncome`; taxed separately in `computeTaxFull.ts`. */
  lotteryOrGameWinningsIncome: number;
  deductions: ChapterVIAResult;
  /** Slab-rate taxable income before Section 288A rounding. */
  slabTaxableIncomeBeforeRounding: number;
  /** Slab-rate taxable income, rounded to the nearest ₹10 (Section 288A) — feed this into `computeTaxFromTaxableIncome`. */
  slabTaxableIncome: number;
  /** slabTaxableIncome + capitalGains.totalSpecialRateTaxableIncome + lotteryOrGameWinningsIncome — "total income" for Section 87A rebate threshold and surcharge-band purposes. */
  totalIncome: number;
}

export function computeFullTaxableIncome(input: FullIncomeInput, regime: Regime, age: number): FullTaxableIncomeResult {
  const ageCategory = getAgeCategory(age);

  const hra = input.hra ? getHraExemptionForRegime(input.hra, regime) : null;
  const exemptHra = hra?.exemptHra ?? 0;

  // Mirrors the order a real Form 16 Part B computes in, which is also the
  // statutory order:
  //   1(d) gross salary
  // - 2(i) TOTAL section 10 exemptions (HRA + retirement heads + LTA/others)
  // = 3.   salary received from employer
  // - 4.   section 16 deductions (standard deduction + professional tax)
  // = 6.   income chargeable under the head "Salaries"
  //
  // Before this existed, only HRA was ever subtracted, so every other
  // section 10 exemption on the certificate was silently ignored and the
  // taxpayer over-taxed by that amount. Caught against a genuine AY 2026-27
  // certificate carrying ₹3,51,000 of leave encashment exemption — roughly
  // ₹1,09,512 of phantom tax at the 30% slab. See PROGRESS.md's Phase 12
  // section.
  const otherSection10 = Math.max(0, input.otherSection10Exemptions ?? 0);
  const oldRegimeOnlySection10 =
    regime === "old" ? Math.max(0, input.oldRegimeOnlySection10Exemptions ?? 0) : 0;
  const totalSection10Exemptions = exemptHra + otherSection10 + oldRegimeOnlySection10;
  const salaryAfterSection10 = Math.max(0, input.grossSalaryIncludingHra - totalSection10Exemptions);

  const standardDeduction = input.isSalaried
    ? regime === "new"
      ? NEW_REGIME_STANDARD_DEDUCTION
      : OLD_REGIME_STANDARD_DEDUCTION
    : 0;
  // Section 16(iii). New regime withdraws it along with 16(ii); only the
  // standard deduction survives there.
  const professionalTax = regime === "old" ? Math.max(0, input.professionalTax ?? 0) : 0;
  const totalSection16Deductions = standardDeduction + professionalTax;
  const salaryTaxable = Math.max(0, salaryAfterSection10 - totalSection16Deductions);

  const houseProperty = aggregateHousePropertyIncome(input.houseProperties, regime);
  const housePropertyContribution = housePropertyContributionToGrossTotalIncome(houseProperty);

  const capitalGains = computeCapitalGains(input.capitalGainTransactions);

  // Validated BEFORE anything is summed, so a mis-classified foreign row
  // fails loudly at the top of the computation rather than producing a
  // plausible-looking wrong figure (see `foreignIncome.ts`).
  const foreignSourceIncomes = input.foreignSourceIncomes ?? [];
  assertForeignSourceIncomesAreWellFormed(foreignSourceIncomes);
  const foreignSlabRateIncome = sumForeignSlabRateIncome(foreignSourceIncomes);

  const otherSourcesIncome = Math.max(0, input.otherSourcesIncome) + foreignSlabRateIncome;
  const lotteryOrGameWinningsIncome = Math.max(0, input.lotteryOrGameWinningsIncome ?? 0);

  const deductionsInput = input.deductions ?? ZERO_DEDUCTIONS;
  const deductions = computeChapterVIA({ ...deductionsInput, regime, age: ageCategory });

  const slabTaxableIncomeBeforeRounding = Math.max(
    0,
    salaryTaxable +
      housePropertyContribution +
      otherSourcesIncome +
      capitalGains.stcgOtherSlabRateIncome -
      deductions.totalDeduction,
  );
  const slabTaxableIncome = roundToNearestTen(slabTaxableIncomeBeforeRounding);

  const totalIncome = slabTaxableIncome + capitalGains.totalSpecialRateTaxableIncome + lotteryOrGameWinningsIncome;

  return {
    ageCategory,
    hra,
    standardDeduction,
    professionalTaxAllowed: professionalTax,
    totalSection10Exemptions,
    salaryAfterSection10,
    salaryTaxable,
    houseProperty,
    housePropertyContribution,
    capitalGains,
    otherSourcesIncome,
    foreignSlabRateIncome,
    foreignSourceIncomes,
    lotteryOrGameWinningsIncome,
    deductions,
    slabTaxableIncomeBeforeRounding,
    slabTaxableIncome,
    totalIncome,
  };
}
