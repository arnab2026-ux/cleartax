import { describe, expect, it } from "vitest";
import { capitalGainAssetSchema } from "../../lib/validation/capitalGain";

const valid = {
  assetType: "LISTED_EQUITY_OR_EQUITY_MF" as const,
  acquisitionDate: "2020-01-01",
  saleDate: "2024-06-01",
  acquisitionCost: 200_000,
  saleValue: 350_000,
  expenses: 500,
  acquiredBeforeRegimeChange: false,
};

describe("capitalGainAssetSchema", () => {
  it("accepts a valid transaction", () => {
    expect(capitalGainAssetSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a sale date before the acquisition date", () => {
    const result = capitalGainAssetSchema.safeParse({ ...valid, acquisitionDate: "2024-06-01", saleDate: "2020-01-01" });
    expect(result.success).toBe(false);
  });

  it("accepts a sale date equal to the acquisition date (same-day, edge case)", () => {
    const result = capitalGainAssetSchema.safeParse({ ...valid, acquisitionDate: "2024-06-01", saleDate: "2024-06-01" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid assetType", () => {
    expect(capitalGainAssetSchema.safeParse({ ...valid, assetType: "CRYPTO" }).success).toBe(false);
  });

  it("rejects an unparsable date", () => {
    expect(capitalGainAssetSchema.safeParse({ ...valid, acquisitionDate: "not-a-date" }).success).toBe(false);
  });

  it("accepts a zero acquisitionCost (e.g. gifted/inherited asset)", () => {
    expect(capitalGainAssetSchema.safeParse({ ...valid, acquisitionCost: 0 }).success).toBe(true);
  });

  it("accepts a missing indexedGainAmount (undefined, not required)", () => {
    const result = capitalGainAssetSchema.safeParse({ ...valid, indexedGainAmount: undefined });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.indexedGainAmount).toBeUndefined();
  });

  it("rejects an empty-string indexedGainAmount (the form should omit the field entirely, not send \"\")", () => {
    // indexedGainAmount is a plain z.number().optional() (see shared.ts's
    // `money()` comment on why this app doesn't use z.coerce) — the
    // CapitalGainForm only includes this field in its payload when the
    // grandfathering option is actually being claimed.
    const result = capitalGainAssetSchema.safeParse({ ...valid, indexedGainAmount: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a numeric indexedGainAmount for a grandfathered property", () => {
    const result = capitalGainAssetSchema.safeParse({
      ...valid,
      assetType: "IMMOVABLE_PROPERTY",
      acquiredBeforeRegimeChange: true,
      indexedGainAmount: 300_000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.indexedGainAmount).toBe(300_000);
  });

  it("rejects a negative saleValue", () => {
    expect(capitalGainAssetSchema.safeParse({ ...valid, saleValue: -1 }).success).toBe(false);
  });
});
