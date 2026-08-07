/**
 * The mapping layer from this app's Prisma row shapes to
 * `@cleartax/itr-schema`'s `ItrExportInput` — same design as
 * `toTaxEngineInput.ts` (Phase 5): every function here takes a plain,
 * Prisma-Client-independent "row" shape (money fields already converted
 * from `Prisma.Decimal` to `number`), not the generated Prisma model types
 * directly, so this file stays trivially unit-testable (construct a plain
 * object literal, no mock database needed). The actual Prisma-touching
 * glue (fetching a `TaxpayerProfile`/`TaxComputation`/`OtherSourceIncome[]`
 * and re-running `computeFullTaxLiability` from `TaxComputation`'s frozen
 * `inputSnapshotJson`) lives one layer up, in `lib/loadItrExportInput.ts` —
 * mirroring exactly how `lib/loadFullIncomeInput.ts` sits above
 * `toTaxEngineInput.ts`.
 */
import type { AgeCategory, FullIncomeInput, FullTaxLiabilityResult, Regime } from "@cleartax/tax-engine";
import type { ItrExportInput, ItrForeignAssetInput, ItrOtherSourceType, ItrTaxpayerProfileInput } from "@cleartax/itr-schema";
import type {
  ForeignAssetOwnership as PrismaForeignAssetOwnership,
  ForeignAssetType as PrismaForeignAssetType,
  ForeignIncomeNature as PrismaForeignIncomeNature,
  OtherSourceType as PrismaOtherSourceType,
  ResidentialStatus as PrismaResidentialStatus,
} from "../../generated/prisma/enums";
import {
  FOREIGN_ASSET_OWNERSHIP_TO_ITR,
  FOREIGN_ASSET_TYPE_TO_ITR,
  FOREIGN_INCOME_NATURE_TO_ITR,
  OTHER_SOURCE_TYPE_TO_ITR,
  RESIDENTIAL_STATUS_TO_ITR,
} from "./enumMaps";

/**
 * Plain row shape for `TaxpayerProfile`. Every field the real ITR JSON
 * schema requires but this app's data model only recently gained
 * (`email`/`mobileNumber`/`fatherName` — see `schema.prisma`'s doc
 * comment) is modeled here as nullable, matching the actual (nullable)
 * database columns — `checkItrProfileCompleteness` is what turns "some of
 * these are null" into a clear, user-facing list of what's missing, rather
 * than `buildItrExportInput` failing with a confusing type error deep
 * inside `@cleartax/itr-schema`.
 */
export interface TaxpayerProfileRowForItr {
  fullName: string;
  pan: string;
  dateOfBirth: Date;
  fatherName: string | null;
  email: string | null;
  mobileNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  /** Phase 11. Non-optional in the database (it has a default), so non-optional here too. */
  residentialStatus: PrismaResidentialStatus;
}

export interface OtherSourceIncomeRowForItr {
  sourceType: PrismaOtherSourceType;
  amount: number;
}

/** Phase 11 — one `ForeignAsset` row, money fields already `Decimal`-to-`number` converted. */
export interface ForeignAssetRowForItr {
  assetType: PrismaForeignAssetType;
  countryCode: string;
  countryName: string;
  entityName: string | null;
  entityAddress: string | null;
  zipCode: string | null;
  natureOfEntity: string | null;
  accountNumber: string | null;
  ownership: PrismaForeignAssetOwnership;
  acquisitionDate: Date | null;
  initialValue: number;
  peakValue: number;
  closingValue: number;
  incomeAccrued: number;
  incomeNature: PrismaForeignIncomeNature;
  grossProceeds: number;
  incomeTaxableInIndia: number;
}

/**
 * Nulls become `undefined` rather than `""`. That distinction is load-bearing:
 * `@cleartax/itr-schema`'s `buildScheduleFa` throws `ItrMappingError` on a
 * missing required disclosure field, and an empty string would sail past a
 * mere presence check while producing a schema-invalid (or worse,
 * schema-VALID but meaningless) foreign-asset disclosure. Let it fail loudly.
 */
export function toItrForeignAssetInput(row: ForeignAssetRowForItr): ItrForeignAssetInput {
  return {
    table: FOREIGN_ASSET_TYPE_TO_ITR[row.assetType],
    countryCode: row.countryCode,
    countryName: row.countryName,
    entityName: row.entityName ?? undefined,
    entityAddress: row.entityAddress ?? undefined,
    zipCode: row.zipCode ?? undefined,
    natureOfEntity: row.natureOfEntity ?? undefined,
    accountNumber: row.accountNumber ?? undefined,
    ownership: FOREIGN_ASSET_OWNERSHIP_TO_ITR[row.ownership],
    acquisitionDate: row.acquisitionDate ?? undefined,
    initialValue: row.initialValue,
    peakValue: row.peakValue,
    closingValue: row.closingValue,
    incomeAccrued: row.incomeAccrued,
    incomeNature: FOREIGN_INCOME_NATURE_TO_ITR[row.incomeNature],
    grossProceeds: row.grossProceeds,
    incomeTaxableInIndia: row.incomeTaxableInIndia,
  };
}

export interface ItrProfileCompletenessResult {
  complete: boolean;
  /** Human-readable labels of missing fields, suitable for showing directly to the taxpayer (e.g. in a "complete these before generating your ITR JSON" message). */
  missingFields: string[];
}

/**
 * Checks whether a `TaxpayerProfile` row has everything the real ITR JSON
 * schema requires. Every field checked here is nullable on the Prisma
 * model — this function is the single place that turns "some are null"
 * into an actionable, human-readable list, so callers (the `/filing` page,
 * its Server Action) never need to duplicate this field-by-field check.
 */
export function checkItrProfileCompleteness(profile: TaxpayerProfileRowForItr): ItrProfileCompletenessResult {
  const missingFields: string[] = [];
  if (!profile.fatherName) missingFields.push("Father's name");
  if (!profile.email) missingFields.push("Email address");
  if (!profile.mobileNumber) missingFields.push("Mobile number");
  if (!profile.addressLine1) missingFields.push("Address line 1");
  if (!profile.city) missingFields.push("City");
  if (!profile.state) missingFields.push("State");
  if (!profile.pincode) missingFields.push("Pincode");
  return { complete: missingFields.length === 0, missingFields };
}

function toItrTaxpayerProfileInput(profile: TaxpayerProfileRowForItr): ItrTaxpayerProfileInput {
  const completeness = checkItrProfileCompleteness(profile);
  if (!completeness.complete) {
    throw new Error(
      `Cannot build ITR JSON input — the taxpayer profile is missing: ${completeness.missingFields.join(", ")}. ` +
        "Call checkItrProfileCompleteness first and prompt the user to fill these in (see /filing's own small form) before calling buildItrExportInput.",
    );
  }
  return {
    fullName: profile.fullName,
    fatherName: profile.fatherName as string,
    pan: profile.pan,
    dateOfBirth: profile.dateOfBirth,
    email: profile.email as string,
    mobileNumber: profile.mobileNumber as string,
    address: {
      addressLine1: profile.addressLine1 as string,
      addressLine2: profile.addressLine2 ?? undefined,
      city: profile.city as string,
      state: profile.state as string,
      pincode: profile.pincode as string,
    },
    bankAccountNumber: profile.bankAccountNumber ?? undefined,
    bankIfsc: profile.bankIfsc ?? undefined,
    bankName: profile.bankName ?? undefined,
  };
}

export interface BuildItrExportInputParams {
  assessmentYear: string;
  profile: TaxpayerProfileRowForItr;
  regime: Regime;
  age: AgeCategory;
  fullIncomeInput: FullIncomeInput;
  computation: FullTaxLiabilityResult;
  tdsCredit: number;
  otherSourceIncomes: OtherSourceIncomeRowForItr[];
  /** Phase 11 — optional so existing callers/fixtures keep compiling; defaults to no foreign assets. */
  foreignAssets?: ForeignAssetRowForItr[];
}

/**
 * Assembles the full `ItrExportInput` `@cleartax/itr-schema`'s mappers
 * expect. Throws (does not silently proceed) if the profile is missing any
 * field the real government schema requires — see
 * `toItrTaxpayerProfileInput`. Callers should check
 * `checkItrProfileCompleteness` themselves first if they want to show a
 * friendlier "please complete your profile" message instead of a thrown
 * error reaching the UI.
 */
export function buildItrExportInput(params: BuildItrExportInputParams): ItrExportInput {
  return {
    assessmentYear: params.assessmentYear,
    profile: toItrTaxpayerProfileInput(params.profile),
    regime: params.regime,
    age: params.age,
    fullIncomeInput: params.fullIncomeInput,
    computation: params.computation,
    tdsCredit: params.tdsCredit,
    otherSourceIncomes: params.otherSourceIncomes.map((r) => ({
      sourceType: mapOtherSourceType(r.sourceType),
      amount: r.amount,
    })),
    // Phase 11. Foreign INCOME is not passed here — it already rides along
    // inside `fullIncomeInput.foreignSourceIncomes` and
    // `computation.foreignTaxCredit`, which is what Schedules FSI/TR are
    // built from. Only the ASSET rows (Schedule FA) need a separate channel,
    // because the tax engine has no concept of an asset that produces no
    // income.
    residentialStatus: RESIDENTIAL_STATUS_TO_ITR[params.profile.residentialStatus],
    foreignAssets: (params.foreignAssets ?? []).map(toItrForeignAssetInput),
  };
}

function mapOtherSourceType(sourceType: PrismaOtherSourceType): ItrOtherSourceType {
  return OTHER_SOURCE_TYPE_TO_ITR[sourceType];
}
