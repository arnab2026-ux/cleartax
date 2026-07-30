/**
 * The internal, Prisma-independent input type this package's mappers
 * consume — designed the same way `apps/web/lib/mapping/toTaxEngineInput.ts`
 * designed its row-shape interfaces: plain data in, no Prisma/Next.js
 * dependency, so this package stays framework-agnostic and unit-testable
 * like `packages/tax-engine` and `packages/pdf-form16` are. The
 * Prisma-touching glue that builds an `ItrExportInput` from real database
 * rows lives in `apps/web/lib/mapping/toItrSchemaInput.ts` (mirroring how
 * `apps/web/lib/loadFullIncomeInput.ts` is the DB-touching wrapper around
 * `toTaxEngineInput.ts`'s pure functions).
 *
 * DESIGN NOTE — why this leans on `@cleartax/tax-engine`'s own types rather
 * than re-deriving raw row shapes: `TaxComputation.inputSnapshotJson`
 * (added in Phase 4, "specifically so Phase 6 has a reproducible source to
 * build from" per that model's doc comment) freezes the EXACT
 * `FullIncomeInput` + `regime` + `age` that produced a given tax
 * computation. This package's mappers work from that frozen input (re-run
 * through `computeFullTaxLiability` to regenerate the full
 * `FullTaxLiabilityResult`, not reconstructed from the flattened
 * `TaxComputation` columns, which lost structure — see
 * `apps/web/lib/mapping/toItrSchemaInput.ts`) rather than duplicating a
 * second parallel set of "row" input types. This also means the "Usr..."
 * (taxpayer-claimed, pre-cap) Chapter VI-A figures the real ITR JSON
 * schema wants (see `UsrDeductUndChapVIAType` in the vendored schema) and
 * the "Deduct..." (department-computed, capped) figures both fall out
 * naturally: `fullIncomeInput.deductions` is the raw claimed input,
 * `computation.income.deductions` is the capped/allowed result.
 *
 * A few fields the real ITR-1/ITR-2 JSON schema requires have NO source of
 * truth anywhere in this app's existing data model at all (see
 * `apps/web/lib/mapping/toItrSchemaInput.ts` and PROGRESS.md's Phase 6
 * section for the full list and how each gap is handled) — those are
 * modeled here as required fields on `ItrTaxpayerProfileInput` /
 * `ItrExportInput` rather than silently defaulted inside this package, so a
 * caller that doesn't have real data for them gets a compile error, not a
 * fabricated value baked into a filing artifact.
 */
import type {
  AgeCategory,
  CapitalAssetType,
  FullIncomeInput,
  FullTaxLiabilityResult,
  Regime,
} from "@cleartax/tax-engine";

export interface ItrAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  /** Free-text state/UT name (e.g. "Maharashtra") — mapped to the government's own 2-digit StateCode via `ay2026-27/constants.ts`'s `STATE_NAME_TO_CODE` (sourced directly from the vendored schema's own `StateCode` enum description, see that file). */
  state: string;
  pincode: string;
}

/**
 * Everything the real ITR JSON schema's `PersonalInfo`/`Verification`
 * blocks need from the taxpayer. Several fields here have NO column on
 * `TaxpayerProfile` today (see file header) — `email`, `mobileNumber`, and
 * `fatherName` are required here specifically so the absence is a loud,
 * typed gap for the caller (`apps/web/lib/mapping/toItrSchemaInput.ts`) to
 * handle explicitly, not a silent 0/"" baked in by this package.
 */
export interface ItrTaxpayerProfileInput {
  /** Full legal name as on PAN — split heuristically into First/Middle/Surname by the mappers (see `ay2026-27/constants.ts`'s `splitName`; a documented judgment call, real ITR filers often need to correct this split by hand). */
  fullName: string;
  /** Required by the real schema's `Verification.Declaration` block (self-declaration naming the filer's father) — not collected anywhere in this app's wizard today; the `/filing` page's own small form (see apps/web wiring) is the first place this is actually captured. */
  fatherName: string;
  pan: string;
  dateOfBirth: Date;
  /** Not on `TaxpayerProfile` — sourced from the authenticated session's login email in `apps/web` (a reasonable proxy for a single-tenant personal-use app; see `toItrSchemaInput.ts`), or supplied directly via `/filing`'s form. */
  email: string;
  /** Not on `TaxpayerProfile` at all — no source anywhere in this app; must be supplied by the caller (the `/filing` page's own small form). */
  mobileNumber: string;
  /** ISD-style country code the schema uses for `CountryCodeMobile` (e.g. "91" for India) — defaults applied by the mapper if omitted. */
  countryCodeMobile?: string;
  address: ItrAddress;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
}

export type ItrOtherSourceType =
  | "SAVINGS_INTEREST"
  | "FIXED_DEPOSIT_INTEREST"
  | "RECURRING_DEPOSIT_INTEREST"
  | "DIVIDEND"
  | "FAMILY_PENSION"
  | "LOTTERY_OR_GAME_WINNINGS"
  | "GIFT"
  | "OTHER";

/**
 * Row-level other-source-income detail. Needed ALONGSIDE
 * `fullIncomeInput`/`computation` (not derivable from either) because
 * `packages/tax-engine`'s `FullIncomeInput.otherSourcesIncome` is a single
 * pre-summed number (per `toTaxEngineInput.ts`'s `sumOtherSourcesIncome`) —
 * the engine has no concept of income *category*, but ITR-1 eligibility
 * (`eligibility.ts`) and Schedule OS's line items both need to know
 * specifically whether any of that total is `LOTTERY_OR_GAME_WINNINGS`
 * (Section 115BB special-rate income, which disqualifies ITR-1 and needs
 * its own schedule line — not modeled by `packages/tax-engine` at all, see
 * `eligibility.ts`).
 */
export interface ItrOtherSourceIncomeInput {
  sourceType: ItrOtherSourceType;
  amount: number;
}

/** Parallel-indexed with `fullIncomeInput.houseProperties` (same array order) — carries the address fields the real schema requires per property but `packages/tax-engine`'s `HousePropertyInput` doesn't track at all (see `houseProperty.ts`: it only models rent/taxes/interest, never an address). A documented judgment call, same shape as the `TaxComputation.inputSnapshotJson` reproducibility pattern elsewhere in this app: fragile if the arrays ever get out of sync, but there's no other join key available. */
export interface ItrHousePropertyDetailInput {
  address?: ItrAddress;
}

export interface ItrSalaryEmployerInput {
  employerName: string;
}

/**
 * The full input `itr1Mapper.ts`/`itr2Mapper.ts`/`eligibility.ts` consume.
 * `fullIncomeInput` + `regime` + `age` should be exactly the triple that
 * produced `computation` (i.e. `computation === computeFullTaxLiability(
 * fullIncomeInput, regime, age)`) — the mapper functions do NOT
 * re-validate this invariant (that would require re-running the tax engine
 * inside this package, which has its own `@cleartax/tax-engine` dependency
 * already, but re-deriving is the caller's job, matching
 * `TaxComputation.inputSnapshotJson`'s existing "frozen reproducible input"
 * design).
 */
export interface ItrExportInput {
  /** e.g. "2026-27" — must match a key in `registry.ts`'s `ITR_SCHEMA_REGISTRY`. */
  assessmentYear: string;
  profile: ItrTaxpayerProfileInput;
  regime: Regime;
  age: AgeCategory;
  fullIncomeInput: FullIncomeInput;
  computation: FullTaxLiabilityResult;
  /** Sum of TDS already deducted (salary + other-sources) — same figure `TaxComputation.tdsCredit` stores. */
  tdsCredit: number;
  /** Advance tax paid, if any — not tracked anywhere in this app's data model today (no `AdvanceTax` field on any Prisma model); defaults to 0 when omitted. Flagged as a real gap: a taxpayer who actually paid advance tax would need to hand-edit the generated JSON before uploading it. */
  advanceTaxPaid?: number;
  /** Self-assessment tax paid, if any — same "not tracked" caveat as `advanceTaxPaid`. */
  selfAssessmentTaxPaid?: number;
  /** Cosmetic only (Schedule S employer line items) — defaults to a single generic entry if omitted. */
  salaryEmployers?: ItrSalaryEmployerInput[];
  /** Parallel-indexed with `fullIncomeInput.houseProperties` — see `ItrHousePropertyDetailInput`'s doc comment. */
  houseProperties?: ItrHousePropertyDetailInput[];
  /** Required (not optional) — see `ItrOtherSourceIncomeInput`'s doc comment on why the engine's aggregate figure alone isn't enough for correct ITR-1 eligibility / Schedule OS reporting. */
  otherSourceIncomes: ItrOtherSourceIncomeInput[];
  /** ReturnFileSec code — defaults to 11 ("139(1) — on or before due date") if omitted. See `ay2026-27/constants.ts`'s `RETURN_FILE_SECTION` for the other codes the real schema recognizes. */
  filingSection?: number;
}

export type { CapitalAssetType };

export interface MappedItrResult {
  itrType: "ITR1" | "ITR2";
  schemaVersion: string;
  /** The full `{ ITR: { ITR1: {...} } }` (or `ITR2`) payload — already validated against the real vendored government schema (see `validate.ts`) before this is returned; never returned unvalidated. */
  payload: Record<string, unknown>;
}

export class ItrMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItrMappingError";
  }
}
