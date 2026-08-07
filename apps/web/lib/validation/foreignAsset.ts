import { z } from "zod";
import { isValidForeignCountryCode } from "@cleartax/itr-schema";
import { money, optionalText } from "./shared";

/**
 * Schedule FA sub-tables, ordered to put the two an RSU/ESOP holder actually
 * needs at the top (A2 for the brokerage account, A3 for the shares) — see
 * `packages/itr-schema/src/ay2026-27/scheduleFa.ts` for which is which and
 * why both are required rather than one or the other.
 */
export const FOREIGN_ASSET_TYPES = [
  "A3_FOREIGN_EQUITY_DEBT_INTEREST",
  "A2_FOREIGN_CUSTODIAL_ACCOUNT",
  "A1_FOREIGN_DEPOSITORY_ACCOUNT",
  "A4_FOREIGN_CASH_VALUE_INSURANCE",
  "B_FINANCIAL_INTEREST_IN_ENTITY",
  "C_IMMOVABLE_PROPERTY",
  "D_OTHER_CAPITAL_ASSET",
  "E_SIGNING_AUTHORITY_ACCOUNT",
  "F_TRUST_OUTSIDE_INDIA",
  "G_OTHER_FOREIGN_SOURCE_INCOME",
] as const;

export const FOREIGN_ASSET_OWNERSHIPS = ["OWNER", "BENEFICIAL_OWNER", "BENIFICIARY"] as const;

export const FOREIGN_INCOME_NATURES = ["NONE", "DIVIDEND", "INTEREST", "SALE_PROCEEDS", "OTHER"] as const;

const dateString = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a valid date`);

/**
 * Country code is validated against the REAL government enum
 * (`CountryCodeExcludingIndia`, parsed out of the vendored schema — see
 * `packages/itr-schema/src/ay2026-27/countries.ts`) rather than a regex.
 * A code the schema doesn't recognise would fail ajv validation much later,
 * at ITR-generation time, with a far less useful message.
 */
const countryCode = z
  .string()
  .trim()
  .min(1, "Select a country")
  .refine((value) => isValidForeignCountryCode(value), "Select a country from the list (India is not a valid choice for a FOREIGN asset)");

export const foreignAssetSchema = z
  .object({
    assetType: z.enum(FOREIGN_ASSET_TYPES),
    countryCode,
    description: optionalText(200, "Label"),
    entityName: optionalText(125, "Name"),
    entityAddress: optionalText(200, "Address"),
    // The real schema caps ZipCode at 8 characters — enforced here so the
    // failure surfaces in the form rather than at ITR-generation time.
    zipCode: optionalText(8, "ZIP / postal code"),
    natureOfEntity: optionalText(34, "Nature"),
    accountNumber: optionalText(34, "Account number"),
    ownership: z.enum(FOREIGN_ASSET_OWNERSHIPS),
    acquisitionDate: dateString("Date"),
    initialValue: money("Initial value"),
    peakValue: money("Peak value"),
    closingValue: money("Closing value"),
    incomeAccrued: money("Income accrued"),
    incomeNature: z.enum(FOREIGN_INCOME_NATURES),
    grossProceeds: money("Gross sale proceeds"),
    incomeTaxableInIndia: money("Income chargeable to tax in India"),
  })
  // The closing value can legitimately exceed the peak only if the peak was
  // mis-entered: the peak is by definition the highest value at ANY point in
  // the calendar year, which includes 31 December. Caught here because the
  // government schema itself has no such cross-field constraint, so nothing
  // downstream would ever notice.
  .refine((data) => data.peakValue >= data.closingValue, {
    message: "Peak value cannot be less than the closing value — the peak is the highest value at any point in the year, which includes 31 December",
    path: ["peakValue"],
  });

export type ForeignAssetFormValues = z.infer<typeof foreignAssetSchema>;

export const FOREIGN_INCOME_HEADS = ["OTHER_SOURCES", "CAPITAL_GAINS", "SALARY", "HOUSE_PROPERTY"] as const;

export const FOREIGN_TAX_RELIEF_SECTIONS = ["SECTION_90", "SECTION_90A", "SECTION_91"] as const;

export const foreignSourceIncomeSchema = z
  .object({
    countryCode,
    taxIdentificationNumber: z.string().trim().min(1, "Enter your tax identification number in that country (or your passport number if none was allotted)").max(75),
    head: z.enum(FOREIGN_INCOME_HEADS),
    description: optionalText(300, "Description"),
    incomeAmount: money("Gross foreign income"),
    foreignTaxPaid: money("Foreign tax paid"),
    dtaaRateCapPercent: z
      .number({ error: "Treaty rate must be a number" })
      .min(0, "Treaty rate cannot be negative")
      .max(100, "Treaty rate cannot exceed 100%")
      .optional(),
    dtaaArticle: optionalText(100, "DTAA article"),
    reliefSection: z.enum(FOREIGN_TAX_RELIEF_SECTIONS),
    alreadyIncludedInIndianIncome: z.boolean(),
    form67Filed: z.boolean(),
  })
  /**
   * The double-count guard, enforced at the edge so the user gets a readable
   * message instead of the tax engine's `ForeignIncomeInputError` surfacing
   * as a 500. Only other-sources income (foreign dividends/interest) can be
   * ADDED to Indian income here — foreign salary belongs in gross salary
   * (an RSU vesting perquisite is already in Form 16), foreign capital gains
   * belong in the Capital gains section, and foreign rent belongs in House
   * property. Mirrors `assertForeignSourceIncomesAreWellFormed`.
   */
  .refine((data) => data.alreadyIncludedInIndianIncome || data.head === "OTHER_SOURCES", {
    message:
      "Only foreign dividends/interest can be added as new income here. Salary, capital gains and house-property income must be entered in their own sections first, then recorded here with \"already included\" ticked — otherwise it would be taxed twice.",
    path: ["alreadyIncludedInIndianIncome"],
  });

export type ForeignSourceIncomeFormValues = z.infer<typeof foreignSourceIncomeSchema>;
