/**
 * AY 2026-27 literal constants + lookup tables for the ITR-1/ITR-2 mappers.
 * Every table here is sourced directly FROM the vendored government schema
 * files themselves (`ay2026-27/schema/itr1-schema.json` /
 * `itr2-schema.json`, fetched 2026-07-30 — see PROGRESS.md), not from a
 * third-party writeup — the schema's own `description` strings on the
 * `StateCode`/`CountryCode` enum definitions spell out the exact
 * code<->name mapping, which is the most authoritative possible source for
 * this data (it's the literal document the government's own e-filing
 * portal validates against).
 */

/**
 * `Address.StateCode` enum, sourced verbatim from
 * `itr1-schema.json`'s `definitions.Address.properties.StateCode.description`:
 * "01-Andaman and Nicobar islands; 02-Andhra Pradesh; ...; 99-Foreign".
 * Keys are lowercased, trimmed state/UT names for lookup; a few common
 * alternate spellings/historical names are added as extra keys pointing at
 * the same code (documented per-alias below) — this is a judgment call,
 * same spirit as `apps/web/lib/mask.ts`/`enumMaps.ts`'s exhaustive-mapping
 * pattern, except free-text state names can't be made exhaustive by
 * TypeScript, so `stateNameToCode` throws a clear error on an unrecognized
 * name rather than silently defaulting to "99-Foreign" (which would be
 * actively wrong for a real Indian address).
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  "andaman and nicobar islands": "01",
  "andhra pradesh": "02",
  "arunachal pradesh": "03",
  assam: "04",
  bihar: "05",
  chandigarh: "06",
  "dadra nagar and haveli": "07",
  "dadra and nagar haveli": "07", // alternate word order in common use
  "dadra and nagar haveli and daman and diu": "07", // post-2020 UT merger — the vendored schema still lists these as two separate legacy codes (07/08), not updated for the merger; mapped to the pre-merger Dadra & Nagar Haveli code as the closer match, flagged here as an honest judgment call rather than silently guessing.
  "daman and diu": "08",
  delhi: "09",
  "nct of delhi": "09",
  goa: "10",
  gujarat: "11",
  haryana: "12",
  "himachal pradesh": "13",
  "jammu and kashmir": "14",
  karnataka: "15",
  kerala: "16",
  lakshadweep: "17",
  "madhya pradesh": "18",
  maharashtra: "19",
  manipur: "20",
  meghalaya: "21",
  mizoram: "22",
  nagaland: "23",
  odisha: "24",
  orissa: "24", // older spelling
  puducherry: "25",
  pondicherry: "25", // older name
  punjab: "26",
  rajasthan: "27",
  sikkim: "28",
  "tamil nadu": "29",
  tripura: "30",
  "uttar pradesh": "31",
  "west bengal": "32",
  chhattisgarh: "33",
  uttarakhand: "34",
  uttaranchal: "34", // older name
  jharkhand: "35",
  telangana: "36",
  ladakh: "37",
};

export const FOREIGN_STATE_CODE = "99";

export function stateNameToCode(stateName: string): string {
  const normalized = stateName.trim().toLowerCase();
  const code = STATE_NAME_TO_CODE[normalized];
  if (!code) {
    throw new Error(
      `Unrecognized Indian state/UT name "${stateName}" — cannot map to the government schema's StateCode enum. ` +
        "Check spelling, or add an alias to STATE_NAME_TO_CODE in ay2026-27/constants.ts if this is a valid alternate name.",
    );
  }
  return code;
}

/** `CountryCode` enum value for India, per `itr1-schema.json`'s `definitions.CountryCode.description` ("91:INDIA"). This app only supports resident-individual filers (see `packages/tax-engine`'s Phase 1 scope note), so every address this package builds uses this constant. */
export const COUNTRY_CODE_INDIA = "91";

/** Software-vendor code for `CreationInfo.SWCreatedBy`/`JSONCreatedBy` (pattern `[S][W][0-9]{8}`) — this app is not a registered ERI/software vendor with the department (a fixed project boundary, see PROGRESS.md's Phase 7 notes: no real ERI/GSP integration ever), so this is an honest placeholder, not a real registered code. A human filer using this JSON with the real offline utility would re-generate/re-sign it there anyway. */
export const SOFTWARE_VENDOR_CODE = "SW00000001";

/** Both vendored schemas' `Form_ITR{1,2}.SchemaVer`/`FormVer` literal value. */
export const SCHEMA_FORM_VERSION = "Ver1.0";

/** `Form_ITR{1,2}.AssessmentYear` literal value for AY 2026-27, per the vendored schema's own required pattern. */
export const SCHEMA_ASSESSMENT_YEAR = "2026";

/**
 * `FilingStatus.ItrFilingDueDate` — the vendored schema's `pattern` for
 * this field is the LITERAL string "2026-07-31" (not a generic date regex),
 * i.e. this specific schema version hardcodes the AY 2026-27 individual
 * (non-audit) due date as the only valid value for this field. Sourced
 * directly from the schema file itself, not assumed.
 */
export const ITR_FILING_DUE_DATE = "2026-07-31";

/**
 * `FilingStatus.ReturnFileSec` codes, per `itr1-schema.json`'s
 * `definitions.FilingStatus.properties.ReturnFileSec.description`: "11 :
 * 139(1)-On or before due date, 12 : 139(4)-After due date, 13 : 142(1), 14
 * : 148, 16 : 153C, 17 : 139(5)-Revised, 18 : 139(9), 20 :
 * 119(2)(b)-After condonation of delay". Defaults to `ON_OR_BEFORE_DUE_DATE`
 * when the caller doesn't specify — a reasonable default for this app
 * (there's no "late filing" state tracked anywhere), but a real user filing
 * after 31-Jul-2026 must override this.
 */
export const RETURN_FILE_SECTION = {
  ON_OR_BEFORE_DUE_DATE: 11,
  AFTER_DUE_DATE: 12,
  REVISED: 17,
} as const;

/** Formats a `Date` as the `YYYY-MM-DD` string every date field in the vendored schemas requires — UTC-based (matching `apps/web/lib/dateMath.ts`'s established convention of avoiding local-timezone date arithmetic, see PROGRESS.md's Phase 3 adversarial review note on `derivePanDobPassword`'s local-timezone bug for why this matters). */
export function toIsoDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Splits a single "full name" string into the
 * `AssesseeName{FirstName,MiddleName,SurNameOrOrgName}` shape the schema
 * wants. A documented judgment call, not a robust name-parsing
 * implementation: `TaxpayerProfile.fullName` is one free-text field (see
 * `apps/web/prisma/schema.prisma`), while the government schema wants
 * first/middle/surname split out, with only `SurNameOrOrgName` required.
 * This uses the simplest defensible convention (last word = surname, first
 * word = first name, everything in between = middle name) — real Indian
 * names frequently don't decompose this cleanly (single-word names,
 * initials-only names, names where the "family name" comes first), so a
 * real filer should treat this split as a starting point to verify, not a
 * guaranteed-correct parse. Flagged prominently in PROGRESS.md.
 */
export function splitName(fullName: string): { firstName?: string; middleName?: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Cannot split an empty name into First/Middle/Surname.");
  }
  if (parts.length === 1) {
    return { surname: parts[0] as string };
  }
  const surname = parts[parts.length - 1] as string;
  const firstName = parts[0] as string;
  const middleParts = parts.slice(1, -1);
  return {
    firstName,
    middleName: middleParts.length > 0 ? middleParts.join(" ") : undefined,
    surname,
  };
}
