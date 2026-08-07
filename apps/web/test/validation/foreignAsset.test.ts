import { describe, expect, it } from "vitest";
import { foreignAssetSchema, foreignSourceIncomeSchema } from "../../lib/validation/foreignAsset";

const validAsset = {
  assetType: "A3_FOREIGN_EQUITY_DEBT_INTEREST",
  countryCode: "2", // UNITED STATES OF AMERICA — an ISD code, not an ISO code
  description: "Acme Corp RSUs",
  entityName: "Acme Global Inc.",
  entityAddress: "1 Acme Way, Sunnyvale, CA",
  zipCode: "94085",
  natureOfEntity: "Company",
  accountNumber: undefined,
  ownership: "OWNER",
  acquisitionDate: "2023-02-15",
  initialValue: 1_800_000,
  peakValue: 3_300_000,
  closingValue: 2_900_000,
  incomeAccrued: 48_000,
  incomeNature: "DIVIDEND",
  grossProceeds: 620_000,
  incomeTaxableInIndia: 0,
};

const validIncome = {
  countryCode: "2",
  taxIdentificationNumber: "123-45-6789",
  head: "OTHER_SOURCES",
  description: "Acme Corp dividends",
  incomeAmount: 100_000,
  foreignTaxPaid: 25_000,
  dtaaRateCapPercent: 25,
  dtaaArticle: "Article 10(2)(b)",
  reliefSection: "SECTION_90",
  alreadyIncludedInIndianIncome: false,
  form67Filed: false,
};

describe("foreignAssetSchema", () => {
  it("accepts a valid A3 RSU row", () => {
    expect(foreignAssetSchema.safeParse(validAsset).success).toBe(true);
  });

  it("validates the country against the REAL government codebook, not a regex", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, countryCode: "44" }).success).toBe(true); // UK
    expect(foreignAssetSchema.safeParse({ ...validAsset, countryCode: "US" }).success).toBe(false); // ISO code, not ISD
    // NOTE "9999" IS in the government's enum (an "other/unspecified" code),
    // so a plausible-looking invented code has to be chosen carefully here.
    expect(foreignAssetSchema.safeParse({ ...validAsset, countryCode: "99999" }).success).toBe(false);
    expect(foreignAssetSchema.safeParse({ ...validAsset, countryCode: "" }).success).toBe(false);
  });

  it("rejects India — Schedule FA is for FOREIGN assets, and the schema's own enum excludes 91", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, countryCode: "91" }).success).toBe(false);
  });

  it("rejects a closing value above the peak (the peak includes 31 December by definition)", () => {
    const result = foreignAssetSchema.safeParse({ ...validAsset, peakValue: 100, closingValue: 200 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/Peak value cannot be less/);
  });

  it("accepts a peak exactly equal to the closing value (an asset that only ever rose)", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, peakValue: 200_000, closingValue: 200_000 }).success).toBe(true);
  });

  it("accepts a zero closing value — a position fully sold before 31 December is still reportable", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, closingValue: 0, grossProceeds: 3_100_000 }).success).toBe(true);
  });

  it("enforces the real schema's 8-character ZipCode limit at the form, not at ITR-generation time", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, zipCode: "123456789" }).success).toBe(false);
    expect(foreignAssetSchema.safeParse({ ...validAsset, zipCode: "94085" }).success).toBe(true);
  });

  it("rejects negative values and malformed dates", () => {
    expect(foreignAssetSchema.safeParse({ ...validAsset, peakValue: -1 }).success).toBe(false);
    expect(foreignAssetSchema.safeParse({ ...validAsset, acquisitionDate: "not-a-date" }).success).toBe(false);
  });

  it("accepts every Schedule FA sub-table", () => {
    for (const assetType of [
      "A1_FOREIGN_DEPOSITORY_ACCOUNT",
      "A2_FOREIGN_CUSTODIAL_ACCOUNT",
      "A3_FOREIGN_EQUITY_DEBT_INTEREST",
      "A4_FOREIGN_CASH_VALUE_INSURANCE",
      "B_FINANCIAL_INTEREST_IN_ENTITY",
      "C_IMMOVABLE_PROPERTY",
      "D_OTHER_CAPITAL_ASSET",
      "E_SIGNING_AUTHORITY_ACCOUNT",
      "F_TRUST_OUTSIDE_INDIA",
      "G_OTHER_FOREIGN_SOURCE_INCOME",
    ]) {
      expect(foreignAssetSchema.safeParse({ ...validAsset, assetType }).success).toBe(true);
    }
  });
});

describe("foreignSourceIncomeSchema", () => {
  it("accepts a valid US dividend row", () => {
    expect(foreignSourceIncomeSchema.safeParse(validIncome).success).toBe(true);
  });

  it("requires a tax identification number (Schedules FSI and TR both demand it)", () => {
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, taxIdentificationNumber: "" }).success).toBe(false);
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, taxIdentificationNumber: "   " }).success).toBe(false);
  });

  it("allows an omitted treaty rate (Section 91 unilateral relief)", () => {
    const result = foreignSourceIncomeSchema.safeParse({
      ...validIncome,
      dtaaRateCapPercent: undefined,
      reliefSection: "SECTION_91",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dtaaRateCapPercent).toBeUndefined();
  });

  it("rejects a treaty rate outside 0-100", () => {
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, dtaaRateCapPercent: -1 }).success).toBe(false);
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, dtaaRateCapPercent: 101 }).success).toBe(false);
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, dtaaRateCapPercent: 100 }).success).toBe(true);
    expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, dtaaRateCapPercent: 0 }).success).toBe(true);
  });

  // The double-count guard. This mirrors the tax engine's own
  // `assertForeignSourceIncomesAreWellFormed`, caught at the form edge so the
  // user gets a readable message instead of a 500.
  describe("double-count guard", () => {
    it.each(["SALARY", "CAPITAL_GAINS", "HOUSE_PROPERTY"])(
      "rejects %s-head income that is NOT flagged as already counted",
      (head) => {
        const result = foreignSourceIncomeSchema.safeParse({ ...validIncome, head, alreadyIncludedInIndianIncome: false });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0]?.message).toMatch(/taxed twice/);
      },
    );

    it.each(["SALARY", "CAPITAL_GAINS", "HOUSE_PROPERTY"])("accepts %s-head income flagged as already counted", (head) => {
      expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, head, alreadyIncludedInIndianIncome: true }).success).toBe(true);
    });

    it("accepts other-sources income either way (a dividend may or may not already be recorded)", () => {
      expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, alreadyIncludedInIndianIncome: false }).success).toBe(true);
      expect(foreignSourceIncomeSchema.safeParse({ ...validIncome, alreadyIncludedInIndianIncome: true }).success).toBe(true);
    });
  });
});
