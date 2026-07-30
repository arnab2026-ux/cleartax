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
  deductions?: DeductionsInput;
}

export interface FullTaxableIncomeResult {
  ageCategory: AgeCategory;
  hra: HraExemptionResult | null;
  standardDeduction: number;
  salaryTaxable: number;
  houseProperty: HousePropertyAggregateResult;
  housePropertyContribution: number;
  capitalGains: CapitalGainsResult;
  otherSourcesIncome: number;
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
  const salaryAfterHra = Math.max(0, input.grossSalaryIncludingHra - exemptHra);

  const standardDeduction = input.isSalaried
    ? regime === "new"
      ? NEW_REGIME_STANDARD_DEDUCTION
      : OLD_REGIME_STANDARD_DEDUCTION
    : 0;
  const salaryTaxable = Math.max(0, salaryAfterHra - standardDeduction);

  const houseProperty = aggregateHousePropertyIncome(input.houseProperties, regime);
  const housePropertyContribution = housePropertyContributionToGrossTotalIncome(houseProperty);

  const capitalGains = computeCapitalGains(input.capitalGainTransactions);

  const otherSourcesIncome = Math.max(0, input.otherSourcesIncome);
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
    salaryTaxable,
    houseProperty,
    housePropertyContribution,
    capitalGains,
    otherSourcesIncome,
    lotteryOrGameWinningsIncome,
    deductions,
    slabTaxableIncomeBeforeRounding,
    slabTaxableIncome,
    totalIncome,
  };
}
