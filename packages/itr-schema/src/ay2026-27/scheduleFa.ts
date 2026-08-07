/**
 * Schedule FA (foreign assets), Schedule FSI (foreign-source income) and
 * Schedule TR (tax relief) builders for the ITR-2 mapper — Phase 11.
 *
 * ============================================================================
 * WHO HAS TO FILE SCHEDULE FA
 * ============================================================================
 * ONLY Resident and Ordinarily Resident (ROR) individuals. The Income Tax
 * Department's own "Step-by-Step Guide to Fill FSI, TR, and FA Schedule in
 * ITR" (incometax.gov.in/iec/foportal/sites/default/files/2026-03/,
 * fetched 2026-08-01) states it verbatim: "Schedule FA need not be completed
 * if the taxpayer is classified as 'not ordinarily resident' or a
 * 'non-resident'." Corroborated by nbaoffice.com's AY 2026-27 guide and
 * vested.blog's AY 2026-27 walkthrough. Enforced here: `buildScheduleFa`
 * returns `undefined` for a non-ROR filer even if asset rows were supplied.
 *
 * ============================================================================
 * THE REPORTING PERIOD IS A CALENDAR YEAR, NOT THE FINANCIAL YEAR
 * ============================================================================
 * Assets "held at any time during the relevant calendar year ending on
 * December 31st" (same departmental guide). For AY 2026-27 that is
 * **1 January 2025 to 31 December 2025** — NOT 1 April 2025 to 31 March 2026.
 * The guide's own worked example fixes the offset beyond doubt: "For
 * Assessment Year 2025-26, the calendar year ending on December 31st
 * comprises the period from January 1, 2024, to December 31, 2024." The
 * wording changed from "accounting period" to "calendar year" with CBDT
 * Notification No. 21/2022 dated 30-03-2022 (the AY 2022-23 ITR forms) and
 * has been calendar-year ever since. This module does not compute the period
 * (see `apps/web/lib/foreignAssetPeriod.ts`); it exists so the caller's
 * calendar-year figures land in the right fields.
 *
 * There is NO de-minimis threshold for the DISCLOSURE. (The ₹20,00,000
 * aggregate figure that circulates relates to the Black Money Act penalty
 * exemption for non-immovable assets, not to whether the schedule must be
 * filled.)
 *
 * ============================================================================
 * WHICH TABLE — THE PART PEOPLE ACTUALLY GET WRONG
 * ============================================================================
 * The ten sub-tables, with the real ITR-2 JSON schema array each maps to
 * (read out of the vendored `schema/itr2-schema.json` itself — that file is
 * ground truth for structure; the semantics below are from the departmental
 * guide):
 *
 *   A1 `DetailsForiegnBank`              Foreign DEPOSITORY accounts — plain
 *                                        foreign bank savings/current/FD
 *                                        accounts. (The misspelling is the
 *                                        government's own; reproduced
 *                                        verbatim because that is the key the
 *                                        schema validates.)
 *   A2 `DtlsForeignCustodialAcc`         Foreign CUSTODIAL accounts —
 *                                        brokerage/securities-custody
 *                                        accounts, reported at ACCOUNT level
 *                                        (peak/closing balance including idle
 *                                        cash, and the gross amount credited
 *                                        classified as interest/dividend/sale
 *                                        proceeds/other/none).
 *   A3 `DtlsForeignEquityDebtInterest`   Foreign EQUITY and DEBT interest —
 *                                        the securities themselves, at
 *                                        SECURITY level (initial/peak/closing
 *                                        value, dividends, sale proceeds).
 *   A4 `DtlsForeignCashValueInsurance`   Cash-value insurance/annuity.
 *   B  `DetailsFinancialInterest`        Financial interest in a foreign
 *                                        entity.
 *   C  `DetailsImmovableProperty`        Immovable property abroad.
 *   D  `DetailsOthAssets`                Other capital assets abroad.
 *   E  `DetailsOfAccntsHvngSigningAuth`  Accounts with signing authority not
 *                                        already reported in A1-D.
 *   F  `DetailsOfTrustOutIndiaTrustee`   Foreign trusts.
 *   G  `DetailsOfOthSourcesIncOutsideIndia` Other foreign-source income.
 *
 * **RSUs/ESOPs need TWO rows, and that is correct, not duplication.** The
 * vested shares go in **A3** (foreign equity interest in the employer's
 * parent company); the brokerage account that holds them — E*TRADE, Fidelity,
 * Schwab, Morgan Stanley — goes in **A2** (foreign custodial account).
 * vested.blog's AY 2026-27 guide puts it plainly: "A2 captures the
 * account-level flows, not the security-level holdings. The actual stocks and
 * ETFs inside the brokerage account are reported separately in A3."
 * Corroborated by nbaoffice.com and taxfull.com's dedicated
 * "Schedule FA ITR 2 Table A2 (Custodial Account) and A3 (Foreign Equity)"
 * discussion. A plain foreign BANK account is A1, not A2 — the A1/A2 split is
 * depository-vs-custodial, not personal-vs-investment.
 *
 * ============================================================================
 * PEAK VALUE
 * ============================================================================
 * The HIGHEST value the asset reached on ANY single date in the calendar
 * year, converted at that date's SBI telegraphic transfer buying rate — for a
 * shareholding, (highest price during the year x shares held on that date).
 * Measured across the whole year, NOT only up to a sale: a position sold in
 * June still reports its peak and a zero closing balance. This module takes
 * the figure as given; computing it is the user's job and the UI states the
 * rule.
 *
 * ============================================================================
 * SCHEDULES FSI AND TR
 * ============================================================================
 * Both are built entirely from `computation.foreignTaxCredit.perSource` (the
 * tax engine's own Rule 128 output) rather than from a second parallel input
 * list, so the relief figures in the generated JSON can never disagree with
 * the tax the engine actually computed. FSI is grouped by (country, TIN) with
 * a per-head breakdown; TR consolidates the same data one row per (country,
 * TIN, relief section), exactly as the departmental guide describes
 * ("Schedule TR ... consolidates the detailed information furnished in
 * Schedule FSI").
 *
 * **FORM 67**: none of this is claimable without filing Form 67 separately on
 * the e-filing portal, which this app cannot do. See
 * `packages/tax-engine/src/ay2026-27/foreignIncome.ts`'s header for the
 * deadline rule, and the `/foreign-assets` and `/filing` pages for the
 * user-facing warning.
 */
import type { ForeignTaxCreditPerSource, ForeignTaxCreditResult } from "@cleartax/tax-engine";
import { ItrMappingError, type ItrForeignAssetInput, type ItrResidentialStatus } from "../types";
import { toIsoDateString } from "./constants";

/** `FilingStatus.ResidentialStatus` enum values in the real schema: "RES - Resident; NRI - Non Resident; NOR - Resident but not Ordinarily resident". */
const RESIDENTIAL_STATUS_TO_SCHEMA: Record<ItrResidentialStatus, "RES" | "NOR" | "NRI"> = {
  ROR: "RES",
  RNOR: "NOR",
  NR: "NRI",
};

export function residentialStatusToSchemaCode(status: ItrResidentialStatus): "RES" | "NOR" | "NRI" {
  return RESIDENTIAL_STATUS_TO_SCHEMA[status];
}

/** Only ROR individuals must file Schedule FA — see this file's header for the departmental source. */
export function mustFileScheduleFa(status: ItrResidentialStatus): boolean {
  return status === "ROR";
}

/** `DtlsForeignCustodialAcc.NatureOfAmount`: "I - Interest; D - Dividend; S - Proceeds from sale or redemption of financial assets; O - Other income; N - No Amount paid/credited". */
const INCOME_NATURE_TO_CODE = {
  INTEREST: "I",
  DIVIDEND: "D",
  SALE_PROCEEDS: "S",
  OTHER: "O",
  NONE: "N",
} as const;

/** Human-readable nature-of-income text for the free-text `NatureOfInc` fields on tables B/C/D/G (which are strings, not the A2 enum). */
const INCOME_NATURE_TO_TEXT = {
  INTEREST: "Interest",
  DIVIDEND: "Dividend",
  SALE_PROCEEDS: "Sale proceeds",
  OTHER: "Other income",
  NONE: "No income",
} as const;

/**
 * Fails loudly on a missing required field instead of substituting a
 * placeholder. `schemaSkeleton.ts` deliberately fills unmodeled required
 * fields with placeholders, but Schedule FA is data the user genuinely
 * supplied — a fabricated entity name or country on a foreign-asset
 * disclosure is precisely what the Black Money Act penalises, so it must
 * never be invented.
 */
function required(value: string | undefined, field: string, table: string, index: number): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new ItrMappingError(
      `Schedule FA table ${table} row ${index + 1} is missing "${field}", which the government schema requires. ` +
        "Fill it in on the Foreign assets step before generating the ITR JSON — this package will not substitute a placeholder for real disclosure data.",
    );
  }
  return trimmed;
}

function requiredDate(value: Date | undefined, field: string, table: string, index: number): string {
  if (!value) {
    throw new ItrMappingError(
      `Schedule FA table ${table} row ${index + 1} is missing "${field}", which the government schema requires. ` +
        "Fill it in on the Foreign assets step before generating the ITR JSON.",
    );
  }
  return toIsoDateString(value);
}

/**
 * Tables A1-A4 and E use the ownership enum `OWNER | BENEFICIAL_OWNER |
 * BENIFICIARY`, but tables B, C and D use a DIFFERENT one for the same
 * concept — `DIRECT | BENEFICIAL_OWNER | BENIFICIARY`, with "DIRECT" where
 * the others say "OWNER". Found by `assertValidItr2` while developing this
 * module (the validator doing exactly its job); this is the government
 * schema's own inconsistency, reproduced rather than normalised away.
 * Table B's `NatureOfInt` ("nature of interest — direct/beneficial owner/
 * beneficiary") is that same enum, NOT the free text its name suggests.
 */
const OWNERSHIP_TO_BCD_ENUM = {
  OWNER: "DIRECT",
  BENEFICIAL_OWNER: "BENEFICIAL_OWNER",
  BENIFICIARY: "BENIFICIARY",
} as const;

/**
 * Tables B-G all carry an "in which ITR schedule was this income offered to
 * tax" pair (`IncTaxSch` + `IncTaxSchNo` on B/C/D, where BOTH are required;
 * `IncOfferedSch` + `IncOfferedSchNo` on E/F/G, where both are optional and
 * are therefore omitted when nothing is chargeable).
 *
 * The schedule code comes from the schema's own enum: "SA - Salary; HP -
 * House Property; CG - Capital Gains; OS - Other Sources; EI - Exempt
 * Income; NI - No Income during the year". This app only ever routes foreign
 * income to OS (dividends/interest), CG (proceeds from a sold foreign asset)
 * or HP (foreign rent) — and reports "NI" honestly when nothing at all was
 * chargeable in India, rather than naming a schedule that carries no such
 * income.
 */
function incomeOfferedSchedule(asset: ItrForeignAssetInput, fallback: "OS" | "HP" = "OS"): string {
  if (asset.incomeTaxableInIndia <= 0) return "NI";
  return asset.incomeNature === "SALE_PROCEEDS" ? "CG" : fallback;
}

/**
 * `IncTaxSchNo`/`IncOfferedSchNo` is a STRING in the real schema (max 50
 * chars), not an integer — the item/serial number within the named schedule.
 * This app has no schedule-item-number concept at all, so "1" is reported: a
 * documented judgment call, flagged here rather than silently guessed.
 */
const INCOME_OFFERED_ITEM_NUMBER = "1";

/**
 * Builds the `ScheduleFA` object, or `undefined` when there is nothing to
 * report (no assets, or a non-ROR filer who is exempt from this schedule
 * entirely). Only the sub-tables that actually have rows are emitted — the
 * real schema makes every array optional, and an empty array would be a
 * meaningless (and, for `additionalProperties: false` schemas, needlessly
 * noisy) addition.
 */
export function buildScheduleFa(
  assets: readonly ItrForeignAssetInput[],
  residentialStatus: ItrResidentialStatus,
): Record<string, unknown> | undefined {
  if (!mustFileScheduleFa(residentialStatus)) return undefined;
  if (assets.length === 0) return undefined;

  const byTable = <T>(table: ItrForeignAssetInput["table"], build: (asset: ItrForeignAssetInput, index: number) => T): T[] | undefined => {
    const rows = assets.filter((a) => a.table === table).map(build);
    return rows.length > 0 ? rows : undefined;
  };

  const schedule: Record<string, unknown> = {
    // Table A1 — foreign depository (bank) accounts.
    DetailsForiegnBank: byTable("A1", (a, i) => ({
      CountryName: required(a.countryName, "country name", "A1", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "A1", i),
      Bankname: required(a.entityName, "bank name", "A1", i),
      AddressOfBank: required(a.entityAddress, "bank address", "A1", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "A1", i),
      ForeignAccountNumber: required(a.accountNumber, "account number", "A1", i),
      OwnerStatus: a.ownership,
      AccOpenDate: requiredDate(a.acquisitionDate, "account opening date", "A1", i),
      PeakBalanceDuringYear: a.peakValue,
      ClosingBalance: a.closingValue,
      IntrstAccured: a.incomeAccrued,
    })),

    // Table A2 — foreign custodial (brokerage) accounts. The RSU holder's
    // E*TRADE/Fidelity/Schwab account goes here, at ACCOUNT level.
    DtlsForeignCustodialAcc: byTable("A2", (a, i) => ({
      CountryName: required(a.countryName, "country name", "A2", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "A2", i),
      FinancialInstName: required(a.entityName, "financial institution name", "A2", i),
      FinancialInstAddress: required(a.entityAddress, "financial institution address", "A2", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "A2", i),
      AccountNumber: required(a.accountNumber, "account number", "A2", i),
      Status: a.ownership,
      AccOpenDate: requiredDate(a.acquisitionDate, "account opening date", "A2", i),
      PeakBalanceDuringPeriod: a.peakValue,
      ClosingBalance: a.closingValue,
      GrossAmtPaidCredited: a.incomeAccrued,
      NatureOfAmount: INCOME_NATURE_TO_CODE[a.incomeNature],
    })),

    // Table A3 — foreign equity/debt interest. The vested RSU/ESOP SHARES
    // themselves go here, at SECURITY level.
    DtlsForeignEquityDebtInterest: byTable("A3", (a, i) => ({
      CountryName: required(a.countryName, "country name", "A3", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "A3", i),
      NameOfEntity: required(a.entityName, "name of the entity", "A3", i),
      AddressOfEntity: required(a.entityAddress, "address of the entity", "A3", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "A3", i),
      NatureOfEntity: required(a.natureOfEntity, "nature of the entity", "A3", i),
      // For RSUs this is the VEST date — the date the interest in the shares
      // was actually acquired (grant confers no interest).
      InterestAcquiringDate: requiredDate(a.acquisitionDate, "date the interest was acquired", "A3", i),
      InitialValOfInvstmnt: a.initialValue,
      PeakBalanceDuringPeriod: a.peakValue,
      ClosingBalance: a.closingValue,
      TotGrossAmtPaidCredited: a.incomeAccrued,
      TotGrossProceeds: a.grossProceeds,
    })),

    DtlsForeignCashValueInsurance: byTable("A4", (a, i) => ({
      CountryName: required(a.countryName, "country name", "A4", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "A4", i),
      FinancialInstName: required(a.entityName, "financial institution name", "A4", i),
      FinancialInstAddress: required(a.entityAddress, "financial institution address", "A4", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "A4", i),
      ContractDate: requiredDate(a.acquisitionDate, "contract date", "A4", i),
      CashValOrSurrenderVal: a.initialValue,
      TotGrossAmtPaidCredited: a.incomeAccrued,
    })),

    DetailsFinancialInterest: byTable("B", (a, i) => ({
      CountryName: required(a.countryName, "country name", "B", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "B", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "B", i),
      NatureOfEntity: a.natureOfEntity?.trim() || undefined,
      NameOfEntity: required(a.entityName, "name of the entity", "B", i),
      AddressOfEntity: required(a.entityAddress, "address of the entity", "B", i),
      // NOT free text — see OWNERSHIP_TO_BCD_ENUM.
      NatureOfInt: OWNERSHIP_TO_BCD_ENUM[a.ownership],
      DateHeld: requiredDate(a.acquisitionDate, "date the interest was held from", "B", i),
      TotalInvestment: a.initialValue,
      IncFromInt: a.incomeAccrued,
      NatureOfInc: INCOME_NATURE_TO_TEXT[a.incomeNature],
      IncTaxAmt: a.incomeTaxableInIndia,
      // Required by the schema even when no income is chargeable in India —
      // see `incomeOfferedSchedule`'s doc comment.
      IncTaxSch: incomeOfferedSchedule(a),
      IncTaxSchNo: INCOME_OFFERED_ITEM_NUMBER,
    })),

    DetailsImmovableProperty: byTable("C", (a, i) => ({
      CountryName: required(a.countryName, "country name", "C", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "C", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "C", i),
      AddressOfProperty: a.entityAddress?.trim() || undefined,
      Ownership: OWNERSHIP_TO_BCD_ENUM[a.ownership],
      DateOfAcq: requiredDate(a.acquisitionDate, "date of acquisition", "C", i),
      TotalInvestment: a.initialValue,
      IncDrvProperty: a.incomeAccrued,
      NatureOfInc: INCOME_NATURE_TO_TEXT[a.incomeNature],
      IncTaxAmt: a.incomeTaxableInIndia,
      // Foreign rent is house-property income, so "HP" is the right fallback
      // here (unlike tables B/D, where "OS" is).
      IncTaxSch: incomeOfferedSchedule(a, "HP"),
      IncTaxSchNo: INCOME_OFFERED_ITEM_NUMBER,
    })),

    DetailsOthAssets: byTable("D", (a, i) => ({
      CountryName: required(a.countryName, "country name", "D", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "D", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "D", i),
      NatureOfAsset: required(a.natureOfEntity, "nature of the asset", "D", i),
      Ownership: OWNERSHIP_TO_BCD_ENUM[a.ownership],
      DateOfAcq: requiredDate(a.acquisitionDate, "date of acquisition", "D", i),
      TotalInvestment: a.initialValue,
      IncDrvAsset: a.incomeAccrued,
      NatureOfInc: INCOME_NATURE_TO_TEXT[a.incomeNature],
      IncTaxAmt: a.incomeTaxableInIndia,
      IncTaxSch: incomeOfferedSchedule(a),
      IncTaxSchNo: INCOME_OFFERED_ITEM_NUMBER,
    })),

    DetailsOfAccntsHvngSigningAuth: byTable("E", (a, i) => ({
      NameOfInstitution: required(a.entityName, "name of the institution", "E", i),
      AddressOfInstitution: required(a.entityAddress, "address of the institution", "E", i),
      CountryName: required(a.countryName, "country name", "E", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "E", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "E", i),
      // The schema asks for the name in which the account is held; for a
      // signing-authority account this app has no separate field, so the
      // institution's own account-holder label is reused.
      NameMentionedInAccnt: required(a.natureOfEntity ?? a.entityName, "name mentioned in the account", "E", i),
      InstitutionAccountNumber: required(a.accountNumber, "account number", "E", i),
      PeakBalanceOrInvestment: a.peakValue,
      IncAccuredTaxFlag: a.incomeTaxableInIndia > 0 ? "Y" : "N",
      ...(a.incomeAccrued > 0 ? { IncAccuredInAcc: a.incomeAccrued } : {}),
      ...(a.incomeTaxableInIndia > 0 ? { IncOfferedAmt: a.incomeTaxableInIndia, IncOfferedSch: incomeOfferedSchedule(a), IncOfferedSchNo: INCOME_OFFERED_ITEM_NUMBER } : {}),
    })),

    DetailsOfTrustOutIndiaTrustee: byTable("F", (a, i) => ({
      CountryName: required(a.countryName, "country name", "F", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "F", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "F", i),
      NameOfTrust: required(a.entityName, "name of the trust", "F", i),
      AddressOfTrust: required(a.entityAddress, "address of the trust", "F", i),
      // The schema requires trustee/settlor/beneficiary names and addresses.
      // This app models a single free-text "nature/role" field rather than
      // three name+address pairs, so the same supplied value is reported for
      // each — a documented limitation (see PROGRESS.md); a Table F filer
      // should hand-edit the generated JSON.
      NameOfOtherTrustees: required(a.natureOfEntity, "trustee/settlor/beneficiary details", "F", i),
      AddressOfOtherTrustees: required(a.entityAddress, "address of the trust", "F", i),
      NameOfSettlor: required(a.natureOfEntity, "trustee/settlor/beneficiary details", "F", i),
      AddressOfSettlor: required(a.entityAddress, "address of the trust", "F", i),
      NameOfBeneficiaries: required(a.natureOfEntity, "trustee/settlor/beneficiary details", "F", i),
      AddressOfBeneficiaries: required(a.entityAddress, "address of the trust", "F", i),
      DateHeld: requiredDate(a.acquisitionDate, "date the interest was held from", "F", i),
      IncDrvTaxFlag: a.incomeTaxableInIndia > 0 ? "Y" : "N",
      ...(a.incomeAccrued > 0 ? { IncDrvFromTrust: a.incomeAccrued } : {}),
      ...(a.incomeTaxableInIndia > 0 ? { IncOfferedAmt: a.incomeTaxableInIndia, IncOfferedSch: incomeOfferedSchedule(a), IncOfferedSchNo: INCOME_OFFERED_ITEM_NUMBER } : {}),
    })),

    DetailsOfOthSourcesIncOutsideIndia: byTable("G", (a, i) => ({
      CountryName: required(a.countryName, "country name", "G", i),
      CountryCodeExcludingIndia: required(a.countryCode, "country code", "G", i),
      ZipCode: required(a.zipCode, "ZIP/postal code", "G", i),
      NameOfPerson: required(a.entityName, "name of the person from whom the income was derived", "G", i),
      AddressOfPerson: required(a.entityAddress, "address of that person", "G", i),
      ...(a.incomeAccrued > 0 ? { IncDerived: a.incomeAccrued } : {}),
      NatureOfInc: INCOME_NATURE_TO_TEXT[a.incomeNature],
      IncDrvTaxFlag: a.incomeTaxableInIndia > 0 ? "Y" : "N",
      ...(a.incomeTaxableInIndia > 0 ? { IncOfferedAmt: a.incomeTaxableInIndia, IncOfferedSch: incomeOfferedSchedule(a), IncOfferedSchNo: INCOME_OFFERED_ITEM_NUMBER } : {}),
    })),
  };

  for (const key of Object.keys(schedule)) {
    if (schedule[key] === undefined) delete schedule[key];
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Schedule FSI
// ---------------------------------------------------------------------------

/** Maps `ForeignIncomeHead` to the `ScheduleFSIDtls` property carrying that head's figures. */
const HEAD_TO_FSI_KEY = {
  salary: "IncFromSal",
  houseProperty: "IncFromHP",
  capitalGains: "IncCapGain",
  otherSources: "IncOthSrc",
} as const;

const ZERO_FSI_INC = { IncFrmOutsideInd: 0, TaxPaidOutsideInd: 0, TaxPayableinInd: 0, TaxReliefinInd: 0 };

function groupKey(source: ForeignTaxCreditPerSource): string {
  return `${source.countryCode} ${source.taxIdentificationNumber}`;
}

/**
 * Builds `ScheduleFSI`, or `undefined` when there is no foreign-source
 * income. One `ScheduleFSIDtls` row per (country, TIN) pair, with the four
 * income heads broken out and a country-wise total — the exact shape the real
 * schema requires (every one of the four head objects and `TotalCountryWise`
 * is a REQUIRED property, so heads with no income are emitted as all-zero
 * rather than omitted).
 *
 * Column meanings, per the departmental guide: (b) income from outside India,
 * (c) tax paid outside India, (d) tax payable on that income under the
 * Income-tax Act, (e) tax relief available — with (e) = min((c), (d)), which
 * is exactly `ForeignTaxCreditPerSource.creditAllowed` from the engine's Rule
 * 128 computation.
 */
export function buildScheduleFsi(ftc: ForeignTaxCreditResult): Record<string, unknown> | undefined {
  if (ftc.perSource.length === 0) return undefined;

  const groups = new Map<string, ForeignTaxCreditPerSource[]>();
  for (const source of ftc.perSource) {
    const key = groupKey(source);
    const existing = groups.get(key);
    if (existing) existing.push(source);
    else groups.set(key, [source]);
  }

  const rows = [...groups.values()].map((sources) => {
    const first = sources[0] as ForeignTaxCreditPerSource;
    const row: Record<string, unknown> = {
      CountryName: first.countryName,
      CountryCodeExcludingIndia: first.countryCode,
      TaxIdentificationNo: first.taxIdentificationNumber,
      IncFromSal: { ...ZERO_FSI_INC },
      IncFromHP: { ...ZERO_FSI_INC },
      IncCapGain: { ...ZERO_FSI_INC },
      IncOthSrc: { ...ZERO_FSI_INC },
    };

    let totalIncome = 0;
    let totalTaxPaid = 0;
    let totalTaxPayable = 0;
    let totalRelief = 0;

    for (const source of sources) {
      const key = HEAD_TO_FSI_KEY[source.head];
      const bucket = row[key] as Record<string, unknown> & typeof ZERO_FSI_INC;
      bucket.IncFrmOutsideInd += source.foreignIncome;
      // Column (c) reports the tax paid outside India that is actually
      // available for relief — i.e. after the treaty-rate proviso to Rule
      // 128(5)(i) has discarded any excess. Reporting the raw withheld figure
      // would make column (e) look arbitrarily lower than min((c),(d)) and
      // invite a mismatch notice.
      bucket.TaxPaidOutsideInd += source.eligibleForeignTax;
      bucket.TaxPayableinInd += source.indianTaxOnThisIncome;
      bucket.TaxReliefinInd += source.creditAllowed;
      if (source.reliefSection !== "91") {
        // `DTAAReliefUs90or90A` is a free-text (max 16 chars) treaty
        // reference. This app tracks the DTAA article as free text but the
        // real schema has no field for it, so the section itself is
        // reported.
        bucket["DTAAReliefUs90or90A"] = source.reliefSection === "90A" ? "90A" : "90";
      }

      totalIncome += source.foreignIncome;
      totalTaxPaid += source.eligibleForeignTax;
      totalTaxPayable += source.indianTaxOnThisIncome;
      totalRelief += source.creditAllowed;
    }

    row["TotalCountryWise"] = {
      IncFrmOutsideInd: totalIncome,
      TaxPaidOutsideInd: totalTaxPaid,
      TaxPayableinInd: totalTaxPayable,
      TaxReliefinInd: totalRelief,
    };
    return row;
  });

  return { ScheduleFSIDtls: rows };
}

// ---------------------------------------------------------------------------
// Schedule TR
// ---------------------------------------------------------------------------

const RELIEF_SECTION_TO_SCHEMA = { "90": "90", "90A": "90A", "91": "91" } as const;

/**
 * Builds `ScheduleTR1`. Unlike Schedules FA/FSI this is emitted even with no
 * foreign income (as an all-zero block) only when the caller asks for it —
 * `itr2Mapper.ts` omits it entirely in that case, matching how every other
 * optional schedule there behaves.
 *
 * One `ScheduleTR` row per (country, TIN, relief section). The four totals are
 * required by the schema; `TaxReliefOutsideIndiaDTAA` /
 * `...NotDTAA` split relief claimed under Sections 90/90A from relief claimed
 * under Section 91, which is exactly the split the engine's
 * `creditUnderSection90` / `creditUnderSection91` already computed (and which
 * it apportions so the two always sum to the total, even when the overall
 * "credit cannot exceed the Indian tax payable" cap shaved the figure).
 */
export function buildScheduleTr1(ftc: ForeignTaxCreditResult): Record<string, unknown> | undefined {
  if (ftc.perSource.length === 0) return undefined;

  const groups = new Map<string, ForeignTaxCreditPerSource[]>();
  for (const source of ftc.perSource) {
    const key = `${groupKey(source)} ${source.reliefSection}`;
    const existing = groups.get(key);
    if (existing) existing.push(source);
    else groups.set(key, [source]);
  }

  const rows = [...groups.values()].map((sources) => {
    const first = sources[0] as ForeignTaxCreditPerSource;
    return {
      CountryName: first.countryName,
      CountryCodeExcludingIndia: first.countryCode,
      TaxIdentificationNo: first.taxIdentificationNumber,
      TaxPaidOutsideIndia: sources.reduce((sum, s) => sum + s.eligibleForeignTax, 0),
      TaxReliefOutsideIndia: sources.reduce((sum, s) => sum + s.creditAllowed, 0),
      ReliefClaimedUsSection: RELIEF_SECTION_TO_SCHEMA[first.reliefSection],
    };
  });

  return {
    ScheduleTR: rows,
    TotalTaxPaidOutsideIndia: ftc.perSource.reduce((sum, s) => sum + s.eligibleForeignTax, 0),
    TotalTaxReliefOutsideIndia: ftc.totalCredit,
    TaxReliefOutsideIndiaDTAA: ftc.creditUnderSection90,
    TaxReliefOutsideIndiaNotDTAA: ftc.creditUnderSection91,
    // "Whether any tax paid outside India, on which tax relief was allowed in
    // India, has been refunded/credited by the foreign tax authority" — this
    // app has no field for a foreign refund, and the honest answer for a
    // first-time claim is "no".
    TaxPaidOutsideIndFlg: "NO",
  };
}
