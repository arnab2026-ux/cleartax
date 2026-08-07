/**
 * The mapping layer from this app's Prisma row shapes to
 * `packages/tax-engine`'s actual input types (`FullIncomeInput` and its
 * nested pieces). Phase 4 deliberately left this unbuilt (see
 * PROGRESS.md's Phase 4 "Not done / deferred" #5) — this is that layer.
 *
 * Design: every function here takes a plain, Prisma-Client-independent "row"
 * shape (money fields already converted from `Prisma.Decimal` to `number` —
 * see `decimalToNumber` below) rather than the generated Prisma model types
 * directly. This keeps the mapping logic itself trivially unit-testable
 * (construct a plain object literal, no mock Prisma client needed) and
 * keeps the Decimal-to-number conversion as one narrow, explicit boundary
 * rather than scattered `Number(...)` calls throughout the codebase.
 *
 * Several mapping decisions here are genuine judgment calls (the schema
 * documents *shape* equivalence field-by-field, but the tax engine itself
 * has no concept of "map this Prisma row to my input" — that logic has to
 * live somewhere), spelled out inline where they matter most.
 */
import {
  getAgeCategory,
  type AgeCategory,
  type CapitalGainTransactionInput,
  type ChapterVIAInput,
  type ForeignSourceIncomeInput,
  type FullIncomeInput,
  type HousePropertyInput,
} from "@cleartax/tax-engine";
import type { Prisma } from "../../generated/prisma/client";
import type {
  CapitalAssetType as PrismaCapitalAssetType,
  DeductionSection as PrismaDeductionSection,
  ForeignIncomeHead as PrismaForeignIncomeHead,
  ForeignTaxReliefSection as PrismaForeignTaxReliefSection,
  HousePropertyType as PrismaHousePropertyType,
  OtherSourceType as PrismaOtherSourceType,
} from "../../generated/prisma/enums";
import { monthsBetween } from "../dateMath";
import {
  CAPITAL_ASSET_TYPE_TO_ENGINE,
  FOREIGN_INCOME_HEAD_TO_ENGINE,
  FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE,
  HOUSE_PROPERTY_TYPE_TO_ENGINE,
} from "./enumMaps";

export type DeductionsInput = Omit<ChapterVIAInput, "regime" | "age">;

/**
 * `Prisma.Decimal` (decimal.js under the hood) stringifies to an exact
 * decimal representation, and `Number()` on it round-trips correctly for
 * every value this app's `@db.Decimal(14, 2)` columns can hold (well within
 * `Number`'s safe-integer range even at the schema's max of
 * ~₹10,000 crore) — see `schema.prisma`'s own note on `Decimal` precision.
 * Also accepts a plain `number` so callers building fixtures/tests don't
 * need a real `Prisma.Decimal` instance.
 */
export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

// ---------------------------------------------------------------------------
// Row shapes (Prisma-independent — money fields already plain numbers)
// ---------------------------------------------------------------------------

export interface SalaryIncomeRow {
  grossSalary: number;
  basicSalary: number;
  hraReceived: number;
  rentPaid: number;
  isMetroCity: boolean;
}

export interface HousePropertyRow {
  propertyType: PrismaHousePropertyType;
  annualLetableValue: number;
  municipalTaxesPaid: number;
  homeLoanInterest: number;
}

export interface CapitalGainAssetRow {
  assetType: PrismaCapitalAssetType;
  acquisitionDate: Date;
  saleDate: Date;
  acquisitionCost: number;
  saleValue: number;
  expenses: number;
  acquiredBeforeRegimeChange: boolean;
  indexedGainAmount: number | null;
}

export interface OtherSourceIncomeRow {
  sourceType: PrismaOtherSourceType;
  amount: number;
}

/** Phase 11 — one `ForeignSourceIncome` row (Schedules FSI/TR + the Rule 128 foreign tax credit). */
export interface ForeignSourceIncomeRow {
  countryCode: string;
  countryName: string;
  taxIdentificationNumber: string;
  head: PrismaForeignIncomeHead;
  incomeAmount: number;
  foreignTaxPaid: number;
  /** Null when no treaty rate caps the source country's taxing right — see `schema.prisma`. */
  dtaaRateCapPercent: number | null;
  reliefSection: PrismaForeignTaxReliefSection;
  alreadyIncludedInIndianIncome: boolean;
}

/** `metaJson` is a Prisma `JsonValue` at runtime — narrowed defensively, never trusted blindly (see `parseDeductionMeta`). */
export interface DeductionRow {
  section: PrismaDeductionSection;
  amount: number;
  metaJson: unknown;
}

// ---------------------------------------------------------------------------
// Salary + HRA
// ---------------------------------------------------------------------------

/**
 * Sums `SalaryIncome` rows across employers for the AY (job-switch
 * scenario — see `schema.prisma`'s `SalaryIncome` doc comment) into the
 * single `grossSalaryIncludingHra` + `HraExemptionInput` the engine expects.
 *
 * Two judgment calls, both documented here since neither is spelled out by
 * the schema itself:
 *  1. `grossSalary` is taken at face value as
 *     `FullIncomeInput.grossSalaryIncludingHra` (matching the schema doc
 *     comment's "matches ... exactly"), NOT further reduced by
 *     `exemptLta`/`exemptOther`/`professionalTax`. The tax engine's Phase 2
 *     scope only implements the HRA exemption (`hra.ts`) — it has no input
 *     path for LTA exemption, other Section 10 exemptions, or the Section
 *     16(iii) professional-tax deduction at all. Rather than silently
 *     inventing an ad hoc subtraction the engine was never designed to
 *     receive, this mapping layer leaves those columns as display/audit-only
 *     (matching how they're already documented in `schema.prisma`) and
 *     flags the gap here and in PROGRESS.md. This is a conservative
 *     simplification (overstates taxable salary, therefore tax — consistent
 *     with this codebase's existing bias elsewhere, e.g. Phase 2's
 *     capital-loss set-off simplification) rather than a silent
 *     understatement.
 *  2. `isMetro` is OR'd across rows (true if ANY employer's `SalaryIncome`
 *     row is flagged metro) since `HraExemptionInput` takes a single
 *     boolean for what's actually a per-employer/per-period fact — a real
 *     simplification for a mid-year city-changing job switch, flagged here
 *     rather than silently assumed away.
 */
export function buildHraInput(salaryIncomes: SalaryIncomeRow[]): FullIncomeInput["hra"] {
  if (salaryIncomes.length === 0) return undefined;
  return {
    basicSalary: salaryIncomes.reduce((sum, s) => sum + s.basicSalary, 0),
    hraReceived: salaryIncomes.reduce((sum, s) => sum + s.hraReceived, 0),
    rentPaid: salaryIncomes.reduce((sum, s) => sum + s.rentPaid, 0),
    isMetro: salaryIncomes.some((s) => s.isMetroCity),
  };
}

export function sumGrossSalary(salaryIncomes: SalaryIncomeRow[]): number {
  return salaryIncomes.reduce((sum, s) => sum + s.grossSalary, 0);
}

export function sumBasicSalary(salaryIncomes: SalaryIncomeRow[]): number {
  return salaryIncomes.reduce((sum, s) => sum + s.basicSalary, 0);
}

// ---------------------------------------------------------------------------
// House property
// ---------------------------------------------------------------------------

export function toHousePropertyInput(row: HousePropertyRow): HousePropertyInput {
  const engineType = HOUSE_PROPERTY_TYPE_TO_ENGINE[row.propertyType];
  if (engineType === "selfOccupied") {
    return { type: "selfOccupied", homeLoanInterestPaid: row.homeLoanInterest };
  }
  return {
    type: "letOut",
    annualRentReceived: row.annualLetableValue,
    municipalTaxesPaid: row.municipalTaxesPaid,
    homeLoanInterestPaid: row.homeLoanInterest,
  };
}

// ---------------------------------------------------------------------------
// Capital gains
// ---------------------------------------------------------------------------

/**
 * `CapitalGainAsset` stores raw transaction facts (dates, cost, sale value,
 * expenses); `capitalGains.ts` wants a pre-derived `gainAmount` +
 * `holdingPeriodMonths` — exactly the derivation `schema.prisma`'s
 * `CapitalGainAsset` doc comment calls out as "a Phase 5/6 mapping-layer
 * concern". `gainAmount` can legitimately be negative (a loss); the engine
 * itself floors per-bucket totals at 0 where appropriate, so this function
 * doesn't clamp it.
 */
export function toCapitalGainTransactionInput(row: CapitalGainAssetRow): CapitalGainTransactionInput {
  return {
    assetType: CAPITAL_ASSET_TYPE_TO_ENGINE[row.assetType],
    gainAmount: row.saleValue - row.acquisitionCost - row.expenses,
    holdingPeriodMonths: monthsBetween(row.acquisitionDate, row.saleDate),
    acquiredBeforeRegimeChange: row.acquiredBeforeRegimeChange,
    indexedGainAmount: row.indexedGainAmount ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Other-sources income + Section 80TTA/80TTB interest base
// ---------------------------------------------------------------------------

/**
 * Sums every `OtherSourceIncome` row EXCEPT `LOTTERY_OR_GAME_WINNINGS`.
 *
 * Bug fix (Phase 6 adversarial review, 2026-07-30): this used to sum EVERY
 * row unconditionally, including lottery/game-show/race-horse winnings —
 * which fed straight into `FullIncomeInput.otherSourcesIncome` and got
 * taxed at ordinary SLAB rates by the engine. Section 115BB requires such
 * winnings to be taxed at a flat 30% with no basic exemption, no Chapter
 * VI-A deductions, and no Section 87A rebate — `packages/tax-engine` now
 * has a dedicated `lotteryOrGameWinningsIncome` input for exactly this (see
 * `computeTaxFull.ts`'s file header), so lottery rows must be excluded here
 * and routed there instead (see `sumLotteryOrGameWinningsIncome` below and
 * `buildFullIncomeInput`).
 */
export function sumOtherSourcesIncome(rows: OtherSourceIncomeRow[]): number {
  return rows.filter((r) => r.sourceType !== "LOTTERY_OR_GAME_WINNINGS").reduce((sum, r) => sum + r.amount, 0);
}

/** Section 115BB winnings only — see `sumOtherSourcesIncome`'s doc comment on why this is split out. */
export function sumLotteryOrGameWinningsIncome(rows: OtherSourceIncomeRow[]): number {
  return rows.filter((r) => r.sourceType === "LOTTERY_OR_GAME_WINNINGS").reduce((sum, r) => sum + r.amount, 0);
}

const TTB_ELIGIBLE_INTEREST_TYPES: readonly PrismaOtherSourceType[] = [
  "SAVINGS_INTEREST",
  "FIXED_DEPOSIT_INTEREST",
  "RECURRING_DEPOSIT_INTEREST",
];

/**
 * `ChapterVIAInput.interestIncomeForTtaOrTtb` is a single number the engine
 * itself routes to 80TTA (below 60) or 80TTB (60+) based on age — see
 * `deductions.ts`'s `computeSection80TtaOrTtb`. What that number should
 * actually *contain* depends on which section applies, since 80TTA only
 * covers savings-account interest while 80TTB covers all bank/post-office
 * interest (savings + FD + RD): below 60, sum only `SAVINGS_INTEREST` rows;
 * 60+, sum all three interest types. This is exactly why
 * `schema.prisma`'s `OtherSourceType` doc comment splits `SAVINGS_INTEREST`
 * out from the other interest types in the first place.
 */
export function interestIncomeForTtaOrTtb(rows: OtherSourceIncomeRow[], ageCategory: AgeCategory): number {
  const isSenior = ageCategory === "senior" || ageCategory === "superSenior";
  const eligibleTypes = isSenior ? TTB_ELIGIBLE_INTEREST_TYPES : (["SAVINGS_INTEREST"] as const);
  return rows.filter((r) => (eligibleTypes as readonly PrismaOtherSourceType[]).includes(r.sourceType)).reduce((sum, r) => sum + r.amount, 0);
}

// ---------------------------------------------------------------------------
// Foreign-source income (Phase 11)
// ---------------------------------------------------------------------------

/**
 * Maps a `ForeignSourceIncome` row to the engine's
 * `ForeignSourceIncomeInput`. Two notes on fidelity here, both deliberate:
 *
 *  1. `dtaaRateCapPercent` uses `?? undefined`, NOT `?? 0`. Null means "no
 *     treaty rate caps this" (Section 91 unilateral relief, or income the
 *     treaty doesn't rate-limit); zero would mean "the treaty caps the source
 *     country's tax at 0%", which would wipe out the entire credit. Getting
 *     these two confused silently costs the taxpayer real money, so the
 *     distinction is preserved rather than flattened.
 *  2. `alreadyIncludedInIndianIncome` is passed through untouched. It is the
 *     flag that stops an RSU vesting perquisite (already inside Form 16 gross
 *     salary) or an RSU sale (already a `CapitalGainAsset` row) from being
 *     taxed a second time. The engine THROWS if a non-other-sources head
 *     arrives with this false, so a mis-entered row fails loudly rather than
 *     being quietly taxed at slab rates.
 */
export function toForeignSourceIncomeInput(row: ForeignSourceIncomeRow): ForeignSourceIncomeInput {
  return {
    countryCode: row.countryCode,
    countryName: row.countryName,
    taxIdentificationNumber: row.taxIdentificationNumber,
    head: FOREIGN_INCOME_HEAD_TO_ENGINE[row.head],
    incomeInr: row.incomeAmount,
    foreignTaxPaidInr: row.foreignTaxPaid,
    dtaaRateCapPercent: row.dtaaRateCapPercent ?? undefined,
    reliefSection: FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE[row.reliefSection],
    alreadyIncludedInIndianIncome: row.alreadyIncludedInIndianIncome,
  };
}

// ---------------------------------------------------------------------------
// Chapter VI-A deductions
// ---------------------------------------------------------------------------

interface Section80DMeta {
  bucket: "selfFamily" | "parents" | "preventiveCheckup";
  isSenior?: boolean;
}

interface Section80CCD2Meta {
  employmentType: "government" | "other";
}

/** Defensive JSON narrowing — `metaJson` is a Prisma `JsonValue` at runtime, never trusted to already have the right shape (could be null, or written by a future migration/bug with a different shape). */
function parseSection80DMeta(metaJson: unknown): Section80DMeta | null {
  if (typeof metaJson !== "object" || metaJson === null) return null;
  const obj = metaJson as Record<string, unknown>;
  if (obj["bucket"] !== "selfFamily" && obj["bucket"] !== "parents" && obj["bucket"] !== "preventiveCheckup") return null;
  return {
    bucket: obj["bucket"],
    isSenior: typeof obj["isSenior"] === "boolean" ? obj["isSenior"] : false,
  };
}

function parseSection80CCD2Meta(metaJson: unknown): Section80CCD2Meta {
  if (typeof metaJson === "object" && metaJson !== null) {
    const obj = metaJson as Record<string, unknown>;
    if (obj["employmentType"] === "government" || obj["employmentType"] === "other") {
      return { employmentType: obj["employmentType"] };
    }
  }
  return { employmentType: "other" };
}

/**
 * Reconstructs `Section80DInput` (three sub-amounts + two independent
 * senior-citizen flags) from however many `SECTION_80D` `Deduction` rows
 * exist, using each row's `metaJson.bucket`. Rows with unrecognized/missing
 * `metaJson` are ignored entirely (fail safe: an un-attributable amount
 * contributes 0 rather than being guessed into the wrong bucket) — this is
 * deliberately conservative, matching this codebase's established bias
 * toward never *overstating* a deduction the engine would otherwise correctly
 * cap.
 */
export function reconstructSection80D(rows: DeductionRow[]): ChapterVIAInput["section80D"] {
  let selfAndFamilyPremium = 0;
  let selfOrFamilyHasSenior = false;
  let parentsPremium = 0;
  let parentsHaveSenior = false;
  let preventiveHealthCheckup = 0;

  for (const row of rows.filter((r) => r.section === "SECTION_80D")) {
    const meta = parseSection80DMeta(row.metaJson);
    if (!meta) continue;
    if (meta.bucket === "selfFamily") {
      selfAndFamilyPremium += row.amount;
      selfOrFamilyHasSenior = selfOrFamilyHasSenior || Boolean(meta.isSenior);
    } else if (meta.bucket === "parents") {
      parentsPremium += row.amount;
      parentsHaveSenior = parentsHaveSenior || Boolean(meta.isSenior);
    } else {
      preventiveHealthCheckup += row.amount;
    }
  }

  return { selfAndFamilyPremium, selfOrFamilyHasSenior, parentsPremium, parentsHaveSenior, preventiveHealthCheckup };
}

/**
 * Reconstructs `Section80CCD2Input`. `salary` is the base the percentage
 * cap applies to — `packages/tax-engine`'s own convention elsewhere (`hra.ts`)
 * uses `basicSalary` as "salary" for percentage-of-salary formulas, so this
 * mapping layer follows the same convention here rather than using the
 * fuller `grossSalary` figure (consistent, and conservative — a smaller
 * base means a smaller computed cap, never a larger one than intended).
 * `employmentType` comes from the (single expected) `SECTION_80CCD_2` row's
 * `metaJson`; if more than one such row exists, contributions are summed
 * and the first row's employment type wins (an edge case — normally there's
 * at most one employer's NPS contribution per AY).
 */
export function reconstructSection80CCD2(rows: DeductionRow[], basicSalaryTotal: number): ChapterVIAInput["section80CCD2"] {
  const ccd2Rows = rows.filter((r) => r.section === "SECTION_80CCD_2");
  const employerContribution = ccd2Rows.reduce((sum, r) => sum + r.amount, 0);
  const employmentType = ccd2Rows.length > 0 ? parseSection80CCD2Meta(ccd2Rows[0].metaJson).employmentType : "other";
  return { employerContribution, salary: basicSalaryTotal, employmentType };
}

export function sumSectionAmount(rows: DeductionRow[], section: PrismaDeductionSection): number {
  return rows.filter((r) => r.section === section).reduce((sum, r) => sum + r.amount, 0);
}

export function buildDeductionsInput(
  deductionRows: DeductionRow[],
  otherSourceRows: OtherSourceIncomeRow[],
  basicSalaryTotal: number,
  ageCategory: AgeCategory,
): DeductionsInput {
  return {
    section80C: sumSectionAmount(deductionRows, "SECTION_80C"),
    section80D: reconstructSection80D(deductionRows),
    section80CCD1B: sumSectionAmount(deductionRows, "SECTION_80CCD_1B"),
    section80CCD2: reconstructSection80CCD2(deductionRows, basicSalaryTotal),
    interestIncomeForTtaOrTtb: interestIncomeForTtaOrTtb(otherSourceRows, ageCategory),
  };
}

// ---------------------------------------------------------------------------
// Top-level assembly
// ---------------------------------------------------------------------------

export interface BuildFullIncomeInputParams {
  salaryIncomes: SalaryIncomeRow[];
  houseProperties: HousePropertyRow[];
  capitalGainAssets: CapitalGainAssetRow[];
  otherSourceIncomes: OtherSourceIncomeRow[];
  deductions: DeductionRow[];
  /** Phase 11 — optional so every pre-existing caller and test fixture keeps working unchanged. */
  foreignSourceIncomes?: ForeignSourceIncomeRow[];
  /** Age in completed years (as of the relevant FY end — see `lib/dateMath.ts`'s `computeAgeForAssessmentYear`). */
  age: number;
}

/** The single entry point the wizard's regime-comparison/summary pages should use — assembles every income head + deduction into the exact `FullIncomeInput` shape `compareRegimes`/`computeFullTaxLiability` expect. */
export function buildFullIncomeInput(params: BuildFullIncomeInputParams): FullIncomeInput {
  const ageCategory = getAgeCategory(params.age);
  const basicSalaryTotal = sumBasicSalary(params.salaryIncomes);

  return {
    isSalaried: params.salaryIncomes.length > 0,
    grossSalaryIncludingHra: sumGrossSalary(params.salaryIncomes),
    hra: buildHraInput(params.salaryIncomes),
    houseProperties: params.houseProperties.map(toHousePropertyInput),
    capitalGainTransactions: params.capitalGainAssets.map(toCapitalGainTransactionInput),
    otherSourcesIncome: sumOtherSourcesIncome(params.otherSourceIncomes),
    lotteryOrGameWinningsIncome: sumLotteryOrGameWinningsIncome(params.otherSourceIncomes),
    foreignSourceIncomes: (params.foreignSourceIncomes ?? []).map(toForeignSourceIncomeInput),
    deductions: buildDeductionsInput(params.deductions, params.otherSourceIncomes, basicSalaryTotal, ageCategory),
  };
}
