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
import type {
  ItrExportInput,
  ItrForeignAssetInput,
  ItrOtherSourceIncomeInput,
  ItrResidentialStatus,
  ItrTaxpayerProfileInput,
} from "../src/types";

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
  foreignAssets?: ItrForeignAssetInput[];
  residentialStatus?: ItrResidentialStatus;
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
    ...(params.foreignAssets ? { foreignAssets: params.foreignAssets } : {}),
    ...(params.residentialStatus ? { residentialStatus: params.residentialStatus } : {}),
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

// ---------------------------------------------------------------------------
// Phase 11 — foreign assets (Schedule FA) and foreign income (FSI/TR)
// ---------------------------------------------------------------------------

/** Table A2: the brokerage account holding the vested RSU shares. Calendar-year 2025 figures. */
export const RSU_BROKERAGE_ACCOUNT: ItrForeignAssetInput = {
  table: "A2",
  countryCode: "2", // UNITED STATES OF AMERICA (ISD code, per the schema's own enum)
  countryName: "UNITED STATES OF AMERICA",
  entityName: "Morgan Stanley Smith Barney LLC",
  entityAddress: "1585 Broadway, New York, NY",
  zipCode: "10036",
  accountNumber: "1234567890",
  ownership: "OWNER",
  acquisitionDate: new Date(Date.UTC(2022, 3, 12)),
  initialValue: 0,
  peakValue: 3_400_000,
  closingValue: 2_950_000,
  incomeAccrued: 48_000,
  incomeNature: "DIVIDEND",
  grossProceeds: 0,
  incomeTaxableInIndia: 0,
};

/** Table A3: the vested RSU shares themselves. */
export const RSU_SHARES: ItrForeignAssetInput = {
  table: "A3",
  countryCode: "2",
  countryName: "UNITED STATES OF AMERICA",
  entityName: "Acme Global Inc.",
  entityAddress: "1 Acme Way, Sunnyvale, CA",
  zipCode: "94085",
  natureOfEntity: "Company",
  ownership: "OWNER",
  acquisitionDate: new Date(Date.UTC(2023, 1, 15)), // the VEST date
  initialValue: 1_800_000,
  peakValue: 3_300_000,
  closingValue: 2_900_000,
  incomeAccrued: 48_000, // dividends received during calendar 2025
  incomeNature: "DIVIDEND",
  grossProceeds: 620_000,
  incomeTaxableInIndia: 0,
};

/**
 * The canonical foreign-asset profile this phase was built for: a salaried
 * ROR filer with US RSUs — the shares in Schedule FA table A3, the brokerage
 * account holding them in A2, a US dividend withheld at the 25% India-US DTAA
 * rate, and an RSU sale reported as a `unlistedShares` capital gain (foreign
 * shares are "unlisted" for Indian holding-period purposes) which is flagged
 * `alreadyIncludedInIndianIncome` so it is never counted twice.
 */
export function buildForeignRsuInput(regime: Regime = "new"): ItrExportInput {
  const dividendInr = 48_000;
  return buildItrExportInput({
    fullIncomeInput: {
      ...EMPTY_FULL_INCOME_INPUT,
      grossSalaryIncludingHra: 2_400_000, // includes the RSU vesting perquisite, per Form 16
      capitalGainTransactions: [{ assetType: "unlistedShares", gainAmount: 260_000, holdingPeriodMonths: 30 }],
      foreignSourceIncomes: [
        {
          countryCode: "2",
          countryName: "UNITED STATES OF AMERICA",
          taxIdentificationNumber: "123-45-6789",
          head: "otherSources",
          incomeInr: dividendInr,
          foreignTaxPaidInr: dividendInr * 0.25,
          dtaaRateCapPercent: 25,
          reliefSection: "90",
          alreadyIncludedInIndianIncome: false,
        },
        {
          countryCode: "2",
          countryName: "UNITED STATES OF AMERICA",
          taxIdentificationNumber: "123-45-6789",
          head: "capitalGains",
          incomeInr: 260_000,
          foreignTaxPaidInr: 0, // the US does not tax an Indian resident's gain on the stock itself
          reliefSection: "90",
          alreadyIncludedInIndianIncome: true,
        },
      ],
    },
    regime,
    age: 32,
    tdsCredit: 350_000,
    foreignAssets: [RSU_BROKERAGE_ACCOUNT, RSU_SHARES],
    residentialStatus: "ROR",
  });
}
