/**
 * Enum/shape mapping between `apps/web/prisma/schema.prisma`'s
 * SCREAMING_SNAKE_CASE Prisma enums and `packages/tax-engine`'s camelCase
 * string-union types. Flagged as needed-but-not-built throughout Phase 4's
 * schema doc comments — this is that mapping layer, built in Phase 5.
 *
 * Deliberately exhaustive `Record<..., ...>` maps (not `switch` statements
 * with a default) so TypeScript itself fails to compile if a new enum
 * member is ever added to `schema.prisma` without a corresponding entry
 * here — catching a silent gap at compile time rather than at runtime with
 * a wrong/missing mapping.
 */
import type {
  CapitalAssetType as EngineCapitalAssetType,
  ForeignIncomeHead as EngineForeignIncomeHead,
  ForeignTaxReliefSection as EngineForeignTaxReliefSection,
  Regime,
} from "@cleartax/tax-engine";
import type {
  ItrForeignAssetOwnership,
  ItrForeignAssetTable,
  ItrForeignIncomeNature,
  ItrOtherSourceType,
  ItrResidentialStatus,
} from "@cleartax/itr-schema";
import {
  CapitalAssetType as PrismaCapitalAssetType,
  ForeignAssetOwnership as PrismaForeignAssetOwnership,
  ForeignAssetType as PrismaForeignAssetType,
  ForeignIncomeHead as PrismaForeignIncomeHead,
  ForeignIncomeNature as PrismaForeignIncomeNature,
  ForeignTaxReliefSection as PrismaForeignTaxReliefSection,
  HousePropertyType as PrismaHousePropertyType,
  OtherSourceType as PrismaOtherSourceType,
  ResidentialStatus as PrismaResidentialStatus,
  TaxRegime as PrismaTaxRegime,
} from "../../generated/prisma/enums";

/**
 * NOTE the Phase 11 asymmetry: `FOREIGN_SHARES` and `UNLISTED_SHARES` BOTH
 * map to the engine's `unlistedShares`. That is correct, not a copy-paste
 * slip — shares of a foreign company are not listed on a recognised Indian
 * stock exchange, so Indian law taxes them exactly like unlisted shares
 * (24-month long-term threshold, Section 112's flat 12.5% LTCG, slab-rate
 * STCG). The two Prisma values exist to give the RSU/ESOP case its own
 * clearly-labelled option in the UI rather than leaving a user to guess that
 * "unlisted" covers their NASDAQ-listed employer stock — see
 * `schema.prisma`'s `CapitalAssetType` doc comment.
 *
 * This makes the map non-injective, which is why `CAPITAL_ASSET_TYPE_FROM_ENGINE`
 * below can no longer be its exact inverse.
 */
export const CAPITAL_ASSET_TYPE_TO_ENGINE: Record<PrismaCapitalAssetType, EngineCapitalAssetType> = {
  LISTED_EQUITY_OR_EQUITY_MF: "listedEquityOrEquityMF",
  UNLISTED_SHARES: "unlistedShares",
  FOREIGN_SHARES: "unlistedShares",
  DEBT_MUTUAL_FUND: "debtMutualFund",
  IMMOVABLE_PROPERTY: "immovableProperty",
  GOLD: "gold",
  OTHER_ASSET: "otherAsset",
};

/**
 * Reverse map. Because two Prisma values collapse onto `unlistedShares` (see
 * above), this direction is lossy: `unlistedShares` maps back to
 * `UNLISTED_SHARES`, the domestic case. That is the safe default — this map
 * is used only to seed a form's default selection, never to reclassify a
 * stored row (nothing in this app converts engine types back into database
 * rows), so the collapse cannot corrupt persisted data.
 */
export const CAPITAL_ASSET_TYPE_FROM_ENGINE: Record<EngineCapitalAssetType, PrismaCapitalAssetType> = {
  listedEquityOrEquityMF: "LISTED_EQUITY_OR_EQUITY_MF",
  unlistedShares: "UNLISTED_SHARES",
  debtMutualFund: "DEBT_MUTUAL_FUND",
  immovableProperty: "IMMOVABLE_PROPERTY",
  gold: "GOLD",
  otherAsset: "OTHER_ASSET",
};

export const TAX_REGIME_TO_ENGINE: Record<PrismaTaxRegime, Regime> = {
  OLD: "old",
  NEW: "new",
};

export const TAX_REGIME_FROM_ENGINE: Record<Regime, PrismaTaxRegime> = {
  old: "OLD",
  new: "NEW",
};

/** `packages/tax-engine/src/ay2026-27/houseProperty.ts`'s `HousePropertyInput` discriminant ("selfOccupied" | "letOut"). */
export const HOUSE_PROPERTY_TYPE_TO_ENGINE: Record<PrismaHousePropertyType, "selfOccupied" | "letOut"> = {
  SELF_OCCUPIED: "selfOccupied",
  LET_OUT: "letOut",
};

/**
 * `OtherSourceType` -> `@cleartax/itr-schema`'s `ItrOtherSourceType`
 * (Phase 6). Unlike `toTaxEngineInput.ts`'s deliberate choice NOT to map
 * `OtherSourceType` through a `Record` (it's consumed there as a literal
 * string filter — see that file's comments, confirmed correct in the Phase
 * 5 adversarial review), this mapping crosses into a genuinely different
 * package's independently-defined string-union type, even though the
 * literal string values happen to match today — exactly the case an
 * exhaustive `Record` is for: if `@cleartax/itr-schema`'s `ItrOtherSourceType`
 * or this schema's `OtherSourceType` enum ever diverge, this fails to
 * compile instead of silently passing through a value the other side
 * doesn't recognize.
 */
export const OTHER_SOURCE_TYPE_TO_ITR: Record<PrismaOtherSourceType, ItrOtherSourceType> = {
  SAVINGS_INTEREST: "SAVINGS_INTEREST",
  FIXED_DEPOSIT_INTEREST: "FIXED_DEPOSIT_INTEREST",
  RECURRING_DEPOSIT_INTEREST: "RECURRING_DEPOSIT_INTEREST",
  DIVIDEND: "DIVIDEND",
  FAMILY_PENSION: "FAMILY_PENSION",
  LOTTERY_OR_GAME_WINNINGS: "LOTTERY_OR_GAME_WINNINGS",
  GIFT: "GIFT",
  OTHER: "OTHER",
};

// ---------------------------------------------------------------------------
// Phase 11 — foreign assets and foreign income
// ---------------------------------------------------------------------------
// Same exhaustive-`Record` discipline as everything above: each of these
// crosses into an independently-defined type in `@cleartax/tax-engine` or
// `@cleartax/itr-schema`, so adding a Prisma enum member without updating the
// map here is a COMPILE error, not a silent runtime gap.

/** Prisma enum -> `@cleartax/itr-schema`'s Schedule FA sub-table letter. */
export const FOREIGN_ASSET_TYPE_TO_ITR: Record<PrismaForeignAssetType, ItrForeignAssetTable> = {
  A1_FOREIGN_DEPOSITORY_ACCOUNT: "A1",
  A2_FOREIGN_CUSTODIAL_ACCOUNT: "A2",
  A3_FOREIGN_EQUITY_DEBT_INTEREST: "A3",
  A4_FOREIGN_CASH_VALUE_INSURANCE: "A4",
  B_FINANCIAL_INTEREST_IN_ENTITY: "B",
  C_IMMOVABLE_PROPERTY: "C",
  D_OTHER_CAPITAL_ASSET: "D",
  E_SIGNING_AUTHORITY_ACCOUNT: "E",
  F_TRUST_OUTSIDE_INDIA: "F",
  G_OTHER_FOREIGN_SOURCE_INCOME: "G",
};

/** Values are identical strings today (including the government's own "BENIFICIARY" misspelling) — mapped explicitly anyway so a future divergence fails to compile. */
export const FOREIGN_ASSET_OWNERSHIP_TO_ITR: Record<PrismaForeignAssetOwnership, ItrForeignAssetOwnership> = {
  OWNER: "OWNER",
  BENEFICIAL_OWNER: "BENEFICIAL_OWNER",
  BENIFICIARY: "BENIFICIARY",
};

export const FOREIGN_INCOME_NATURE_TO_ITR: Record<PrismaForeignIncomeNature, ItrForeignIncomeNature> = {
  INTEREST: "INTEREST",
  DIVIDEND: "DIVIDEND",
  SALE_PROCEEDS: "SALE_PROCEEDS",
  OTHER: "OTHER",
  NONE: "NONE",
};

/** Prisma enum -> `packages/tax-engine`'s `ForeignIncomeHead` (Schedule FSI's four heads). */
export const FOREIGN_INCOME_HEAD_TO_ENGINE: Record<PrismaForeignIncomeHead, EngineForeignIncomeHead> = {
  SALARY: "salary",
  HOUSE_PROPERTY: "houseProperty",
  CAPITAL_GAINS: "capitalGains",
  OTHER_SOURCES: "otherSources",
};

/** Prisma enum -> `packages/tax-engine`'s `ForeignTaxReliefSection`, which mirrors the ITR schema's own `"90" | "90A" | "91"`. */
export const FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE: Record<PrismaForeignTaxReliefSection, EngineForeignTaxReliefSection> = {
  SECTION_90: "90",
  SECTION_90A: "90A",
  SECTION_91: "91",
};

/** Prisma enum -> `@cleartax/itr-schema`'s `ItrResidentialStatus` (which the mapper then turns into the schema's "RES"/"NOR"/"NRI"). */
export const RESIDENTIAL_STATUS_TO_ITR: Record<PrismaResidentialStatus, ItrResidentialStatus> = {
  ROR: "ROR",
  RNOR: "RNOR",
  NR: "NR",
};
