import { z } from "zod";
import { money, optionalMoney, optionalText } from "./shared";

export const CAPITAL_ASSET_TYPES = [
  "LISTED_EQUITY_OR_EQUITY_MF",
  "UNLISTED_SHARES",
  // Phase 11. Computes identically to UNLISTED_SHARES (foreign shares are not
  // listed on a recognised Indian exchange, so they take the 24-month
  // long-term threshold and Section 112's 12.5% rate) — it exists as its own
  // option purely so an RSU holder isn't left guessing. See schema.prisma.
  "FOREIGN_SHARES",
  "DEBT_MUTUAL_FUND",
  "IMMOVABLE_PROPERTY",
  "GOLD",
  "OTHER_ASSET",
] as const;

const dateString = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a valid date`);

export const capitalGainAssetSchema = z
  .object({
    assetType: z.enum(CAPITAL_ASSET_TYPES),
    description: optionalText(300, "Description"),
    acquisitionDate: dateString("Acquisition date"),
    saleDate: dateString("Sale date"),
    // acquisitionCost/expenses can legitimately be 0 (e.g. gifted/inherited
    // assets), so these stay non-negative rather than strictly positive.
    acquisitionCost: money("Acquisition cost"),
    saleValue: money("Sale value"),
    expenses: money("Expenses"),
    acquiredBeforeRegimeChange: z.boolean(),
    // Optional: only meaningful for a pre-23-Jul-2024 immovable property
    // claiming the Section 112 grandfathering comparison — see
    // packages/tax-engine/src/ay2026-27/capitalGains.ts.
    indexedGainAmount: optionalMoney("Indexed gain"),
  })
  .refine((data) => new Date(data.saleDate).getTime() >= new Date(data.acquisitionDate).getTime(), {
    message: "Sale date cannot be before the acquisition date",
    path: ["saleDate"],
  });

export type CapitalGainAssetFormValues = z.infer<typeof capitalGainAssetSchema>;
