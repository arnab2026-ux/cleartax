/**
 * Shared test fixtures for `packages/itr-schema`'s test suite. Builds real
 * `ItrExportInput` values by running actual `@cleartax/tax-engine` inputs
 * through the real `computeFullTaxLiability`/`compareRegimes` — never a
 * hand-typed fake `FullTaxLiabilityResult` — so these tests exercise the
 * genuine engine-to-ITR-JSON pipeline end to end, matching the established
 * pattern elsewhere in this repo (e.g.
 * `apps/web/test/mapping/toTaxEngineInput.test.ts`'s "end-to-end assemblies
 * fed into the REAL computeFullTaxLiability").
 */
import { computeFullTaxLiability, getAgeCategory, type AgeCategory, type FullIncomeInput, type Regime } from "@cleartax/tax-engine";
import type { ItrExportInput, ItrOtherSourceIncomeInput, ItrTaxpayerProfileInput } from "../src/types";

export const BASE_PROFILE: ItrTaxpayerProfileInput = {
  fullName: "Arjun Kumar Mehta",
  fatherName: "Ramesh Mehta",
  pan: "ABCPM1234F",
  dateOfBirth: new Date(Date.UTC(1990, 5, 15)),
  email: "arjun.mehta@example.invalid",
  mobileNumber: "9876543210",
  countryCodeMobile: "91",
  address: {
    addressLine1: "Flat 402, Sunrise Apartments",
    addressLine2: "MG Road",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
  },
  bankAccountNumber: "1234567890123",
  bankIfsc: "HDFC0001234",
  bankName: "HDFC Bank",
};

export const EMPTY_FULL_INCOME_INPUT: FullIncomeInput = {
  isSalaried: true,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

export interface BuildItrExportInputParams {
  fullIncomeInput: FullIncomeInput;
  regime: Regime;
  age: number;
  profile?: ItrTaxpayerProfileInput;
  otherSourceIncomes?: ItrOtherSourceIncomeInput[];
  tdsCredit?: number;
}

export function buildItrExportInput(params: BuildItrExportInputParams): ItrExportInput {
  const ageCategory: AgeCategory = getAgeCategory(params.age);
  const computation = computeFullTaxLiability(params.fullIncomeInput, params.regime, params.age);
  return {
    assessmentYear: "2026-27",
    profile: params.profile ?? BASE_PROFILE,
    regime: params.regime,
    age: ageCategory,
    fullIncomeInput: params.fullIncomeInput,
    computation,
    tdsCredit: params.tdsCredit ?? 0,
    otherSourceIncomes: params.otherSourceIncomes ?? [],
  };
}

/** A simple ITR-1-eligible profile: salary only, well under ₹50L, no capital gains. */
export function buildSimpleSalaryOnlyInput(regime: Regime = "new"): ItrExportInput {
  return buildItrExportInput({
    fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 1_200_000 },
    regime,
    age: 30,
    tdsCredit: 80_000,
  });
}

/** A profile with capital gains — always ITR-2 territory (any STCG disqualifies ITR-1). */
export function buildCapitalGainsInput(regime: Regime = "new"): ItrExportInput {
  return buildItrExportInput({
    fullIncomeInput: {
      ...EMPTY_FULL_INCOME_INPUT,
      grossSalaryIncludingHra: 1_500_000,
      capitalGainTransactions: [
        { assetType: "listedEquityOrEquityMF", gainAmount: 300_000, holdingPeriodMonths: 6 }, // STCG-equity — disqualifies ITR-1
        { assetType: "listedEquityOrEquityMF", gainAmount: 400_000, holdingPeriodMonths: 24 }, // LTCG-equity, above the 1.25L exemption
      ],
    },
    regime,
    age: 35,
    tdsCredit: 150_000,
  });
}

/**
 * A profile with lottery/game-winnings income (Section 115BB) — always
 * ITR-2 territory (disqualifies ITR-1, see `eligibility.ts`). Added for the
 * Phase 6 adversarial review's Section 115BB fix: `otherSourceIncomes`
 * (row-level, feeds `ScheduleOS`/eligibility) and
 * `fullIncomeInput.lotteryOrGameWinningsIncome` (feeds the actual tax
 * computation) are kept consistent, matching how `apps/web`'s
 * `toTaxEngineInput.ts`/`toItrSchemaInput.ts` derive both from the same
 * underlying `OtherSourceIncome` rows in production.
 */
export function buildLotteryIncomeInput(regime: Regime = "new"): ItrExportInput {
  const lotteryAmount = 1_000_000;
  return buildItrExportInput({
    fullIncomeInput: {
      ...EMPTY_FULL_INCOME_INPUT,
      grossSalaryIncludingHra: 800_000,
      lotteryOrGameWinningsIncome: lotteryAmount,
    },
    regime,
    age: 30,
    otherSourceIncomes: [{ sourceType: "LOTTERY_OR_GAME_WINNINGS", amount: lotteryAmount }],
    tdsCredit: 300_000, // lottery TDS is 30% at source (Section 194B) — a realistic input, not load-bearing for these tests
  });
}
