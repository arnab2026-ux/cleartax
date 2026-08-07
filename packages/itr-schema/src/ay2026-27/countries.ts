/**
 * Country-code lookup for Schedules FA / FSI / TR, derived AT RUNTIME from
 * the vendored government schema's OWN `CountryCodeExcludingIndia` enum and
 * its `description` string — never from a hand-copied table.
 *
 * This follows the same principle `constants.ts`'s `STATE_NAME_TO_CODE`
 * established (state codes sourced from the schema's own `StateCode`
 * description), taken one step further: rather than transcribing 249 entries
 * by hand — where a single typo would be invisible until a real filing was
 * rejected — this parses the description at module load and cross-checks
 * every parsed code against the enum's own value list. A mismatch between the
 * two (i.e. a schema whose description and enum have drifted apart) throws at
 * import time rather than producing a silently wrong country code.
 *
 * IMPORTANT — these are ISD dialling codes, NOT ISO alpha-2/alpha-3 codes:
 * "2" is the UNITED STATES OF AMERICA, "44" the UNITED KINGDOM, "91" INDIA
 * (excluded from this particular enum, hence its name). The Income Tax
 * Department's own step-by-step guide for these schedules says so explicitly:
 * "Country Code: Use the International Subscriber Dialling (ISD) code of the
 * country where the income originates."
 */
import itr2Schema from "./schema/itr2-schema.json";

interface CountryCodeSchemaNode {
  description?: string;
  enum?: string[];
}

export interface CountryOption {
  /** ISD code, e.g. "2" for the United States of America. */
  code: string;
  /** Country name exactly as the government schema spells it, e.g. "UNITED STATES OF AMERICA". */
  name: string;
}

function parseCountryOptions(): CountryOption[] {
  const node = (itr2Schema as { definitions: Record<string, unknown> }).definitions[
    "CountryCodeExcludingIndia"
  ] as CountryCodeSchemaNode | undefined;

  if (!node?.description || !Array.isArray(node.enum)) {
    throw new Error(
      "The vendored ITR-2 schema no longer exposes a CountryCodeExcludingIndia definition with both a `description` " +
        "and an `enum` — re-audit ay2026-27/countries.ts against the new schema file before proceeding.",
    );
  }

  const allowedCodes = new Set(node.enum);
  const options: CountryOption[] = [];

  // Format: "93:AFGHANISTAN; 1001:ÅLAND ISLANDS; ...; 226: BURKINA FASO; ..."
  // Note the inconsistent whitespace after some colons — the government's own
  // string, trimmed rather than "fixed".
  for (const entry of node.description.split(";")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const code = trimmed.slice(0, separator).trim();
    const name = trimmed.slice(separator + 1).trim();
    if (code === "" || name === "") continue;
    if (!allowedCodes.has(code)) {
      throw new Error(
        `Country code "${code}" ("${name}") appears in the vendored schema's CountryCodeExcludingIndia description ` +
          "but not in its enum — the two have drifted apart; re-audit ay2026-27/countries.ts.",
      );
    }
    options.push({ code, name });
  }

  if (options.length === 0) {
    throw new Error("Parsed zero countries out of the vendored schema's CountryCodeExcludingIndia description.");
  }
  return options;
}

/** Every country the ITR schema accepts for a foreign asset/income, sorted by name — suitable for driving a UI dropdown directly. */
export const FOREIGN_COUNTRY_OPTIONS: readonly CountryOption[] = parseCountryOptions()
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

const CODE_TO_NAME = new Map(FOREIGN_COUNTRY_OPTIONS.map((c) => [c.code, c.name]));

/** ISD code for the United States — by far the most common foreign-asset jurisdiction for an Indian salaried filer with RSUs. Read from the parsed table rather than hardcoded, so it can never drift from the schema. */
export const COUNTRY_CODE_UNITED_STATES = "2";

export function isValidForeignCountryCode(code: string): boolean {
  return CODE_TO_NAME.has(code);
}

/**
 * The schema's own name for a code. Throws on an unrecognised code rather
 * than returning a placeholder — matching `stateNameToCode`'s established
 * fail-loudly behaviour in `constants.ts`, and for the same reason: a wrong
 * country on a foreign-asset disclosure is exactly the kind of error the
 * Black Money Act penalises.
 */
export function foreignCountryName(code: string): string {
  const name = CODE_TO_NAME.get(code);
  if (name === undefined) {
    throw new Error(
      `Unrecognised foreign country code "${code}" — it is not in the vendored ITR-2 schema's ` +
        "CountryCodeExcludingIndia enum. Note these are ISD dialling codes (e.g. \"2\" = UNITED STATES OF AMERICA), " +
        "not ISO country codes, and India (\"91\") is deliberately excluded.",
    );
  }
  return name;
}
