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
import type { CapitalAssetType as EngineCapitalAssetType, Regime } from "@cleartax/tax-engine";
import type { ItrOtherSourceType } from "@cleartax/itr-schema";
import {
  CapitalAssetType as PrismaCapitalAssetType,
  HousePropertyType as PrismaHousePropertyType,
  OtherSourceType as PrismaOtherSourceType,
  TaxRegime as PrismaTaxRegime,
} from "../../generated/prisma/enums";

export const CAPITAL_ASSET_TYPE_TO_ENGINE: Record<PrismaCapitalAssetType, EngineCapitalAssetType> = {
  LISTED_EQUITY_OR_EQUITY_MF: "listedEquityOrEquityMF",
  UNLISTED_SHARES: "unlistedShares",
  DEBT_MUTUAL_FUND: "debtMutualFund",
  IMMOVABLE_PROPERTY: "immovableProperty",
  GOLD: "gold",
  OTHER_ASSET: "otherAsset",
};

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
