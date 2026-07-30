/**
 * Validates mapper output against the real, vendored government JSON
 * schemas using `ajv-draft-04`.
 *
 * WHY `ajv-draft-04` SPECIFICALLY: the vendored schemas
 * (`ay2026-27/schema/itr1-schema.json` / `itr2-schema.json`) declare
 * `"$schema": "http://json-schema.org/draft-04/schema#"` and use
 * draft-04's boolean-modifier `exclusiveMinimum`/`exclusiveMaximum` style
 * (e.g. `{"minimum": 0, "exclusiveMinimum": false}`) rather than draft-06+'s
 * numeric style. Plain `ajv` v8 (already a dependency here, used
 * transitively by other tools in this repo) ships only draft-07/2019-09/
 *2020-12 meta-schemas and — confirmed empirically while building this
 * package — throws `"exclusiveMinimum must be number"` when compiling
 * either vendored schema unmodified. Rather than hand-rewriting two large
 * government-published files (risking silently changing a constraint),
 * this package uses `ajv-draft-04`, the Ajv team's own companion package
 * for validating actual draft-04 documents, confirmed to compile and run
 * against both vendored files unmodified.
 */
import Ajv04 from "ajv-draft-04";
import type { ErrorObject } from "ajv-draft-04";
import itr1Schema from "./ay2026-27/schema/itr1-schema.json";
import itr2Schema from "./ay2026-27/schema/itr2-schema.json";

export class ItrValidationError extends Error {
  readonly errors: ErrorObject[];

  constructor(itrType: string, errors: ErrorObject[]) {
    const summary = errors
      .slice(0, 20)
      .map((e) => `  - ${e.instancePath || "(root)"} ${e.message ?? ""} ${JSON.stringify(e.params)}`)
      .join("\n");
    const more = errors.length > 20 ? `\n  ...and ${errors.length - 20} more` : "";
    super(`${itrType} JSON failed schema validation (${errors.length} error(s)):\n${summary}${more}`);
    this.name = "ItrValidationError";
    this.errors = errors;
  }
}

const ajv = new Ajv04({ strict: false, allErrors: true });
const validateItr1 = ajv.compile(itr1Schema);
const validateItr2 = ajv.compile(itr2Schema);

/**
 * Validates a full `{ ITR: { ITR1: {...} } }` (or `ITR2`) payload against
 * the real vendored government schema. Throws `ItrValidationError` (never
 * returns a "somewhat valid" result) on any structural problem — a missing
 * required field, a wrong type, an enum value not in the government's own
 * list, a string not matching a required pattern (e.g. a malformed PAN).
 * This is the package's core promise per the Phase 6 brief: "never silently
 * emit invalid JSON."
 */
export function assertValidItr1(payload: unknown): void {
  if (!validateItr1(payload)) {
    throw new ItrValidationError("ITR-1", validateItr1.errors ?? []);
  }
}

export function assertValidItr2(payload: unknown): void {
  if (!validateItr2(payload)) {
    throw new ItrValidationError("ITR-2", validateItr2.errors ?? []);
  }
}

export { itr1Schema, itr2Schema };
