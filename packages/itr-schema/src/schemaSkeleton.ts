/**
 * Generic minimal-valid-instance builder for the vendored ITR-1/ITR-2 JSON
 * Schema draft-04 documents (`ay2026-27/schema/*.json` — fetched directly
 * from incometax.gov.in's e-Filing portal on 2026-07-30, see PROGRESS.md for
 * the full sourcing note and `validate.ts` for how they're actually
 * compiled/checked with `ajv-draft-04`).
 *
 * WHY THIS EXISTS: the real government schemas are enormous (ITR-1 ~145KB,
 * ITR-2 ~380KB) and encode dozens of schedules this app's tax engine has no
 * data for at all — foreign assets (ScheduleFA), ESOP deferral, AMT,
 * donee-wise 80G/80GGA/80GGC breakdowns, TDS-challan-level detail, and more.
 * `packages/tax-engine`'s Phase 1/2 scope boundary and this app's Prisma
 * schema simply don't carry that information (by design — see PROGRESS.md's
 * "Not modeled" sections for Phases 1-2). Hand-authoring a bespoke object
 * literal that satisfies every required sub-field of every such schedule
 * would be a huge, error-prone undertaking with no real behavioral payoff
 * (every one of those figures would be a fabricated 0 regardless of how
 * carefully the literal is typed out).
 *
 * Instead, this module mechanically walks a schema's REQUIRED fields only
 * (every object in these schemas sets `additionalProperties: false`, so
 * adding anything not in `properties` would itself be a validation error —
 * there is no benefit to including optional fields in a "minimal valid"
 * skeleton) and fills each one with a type/pattern/enum-appropriate
 * placeholder. The `itr1Mapper.ts`/`itr2Mapper.ts` functions then overlay
 * real, engine-computed data on top of this skeleton at the specific paths
 * this app DOES model (personal info, salary, house property, capital
 * gains, deductions, tax computation, verification, bank details) — the
 * overlay step, not this file, is where actual case-specific correctness
 * lives. This file's only job is "never leave a required field missing or
 * wrongly typed for the parts nobody supplied real data for."
 *
 * PATTERN SAFETY: every `pattern` keyword reachable from either schema's
 * fully-required-recursive subtree was catalogued by hand before writing
 * this function (confirmed via a one-off script walking both schemas'
 * `required` trees end-to-end — see PROGRESS.md's Phase 6 section for the
 * exact list found). `PATTERN_PLACEHOLDERS` below covers exactly that set.
 * An unrecognized pattern throws `SchemaSkeletonError` immediately rather
 * than guessing a value that might not actually satisfy the real schema —
 * this means a future assessment year's schema change that adds a new
 * required pattern-constrained field fails LOUDLY at generation time
 * instead of silently emitting a JSON payload the government portal would
 * reject. Same principle for required arrays: a one-off audit (see
 * PROGRESS.md) confirmed neither schema's required-recursive subtree ever
 * contains a field whose own type is `array` — so this function treats
 * encountering one as an unexpected-schema-shape error, not a case to
 * silently handle with an empty array (which could violate `minItems`).
 */
import type { JsonSchemaDefinitions, JsonSchemaNode } from "./jsonSchemaTypes";

export class SchemaSkeletonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaSkeletonError";
  }
}

/**
 * Literal placeholder values for every `pattern` found in the required-only
 * subtree of the vendored ITR-1/ITR-2 schemas. Matched by exact string
 * equality against the schema's `pattern` value (not by trying to
 * interpret/solve the regex) — deliberately brittle so an unfamiliar
 * pattern is a loud build-time failure, not a silent guess. Real values
 * (PAN, dates, names, etc.) are always overlaid on top by the mapper
 * functions where this app has the actual data; these placeholders only
 * ever surface for fields this app has no source of truth for at all.
 */
const PATTERN_PLACEHOLDERS: Record<string, string> = {
  "[S][W][0-9]{8}": "SW00000001", // CreationInfo software-vendor code — this app is not a registered ERI/software vendor (Phase 7's documented boundary: no real ERI integration), so this is a clearly-a-placeholder value, not a real registered SW code.
  "-|.{44}": "-", // CreationInfo.Digest — "-" means "no digital signature", which is correct: this app doesn't sign the JSON.
  "ITR-1": "ITR-1",
  "ITR-2": "ITR-2",
  "2026": "2026", // Form.AssessmentYear — literal for AY 2026-27 per this vendored schema version.
  "Ver1.0": "Ver1.0", // Form.SchemaVer / Form.FormVer, per this vendored schema's own version string.
  "([12]\\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))": "2026-01-01", // generic ISO-date fallback; every real date field (DOB, JSONCreationDate) is always overlaid by the mapper with a real value — this fallback should never actually surface in mapper output.
  "[A-Z]{5}[0-9]{4}[A-Z]": "AAAAA0000A", // generic PAN fallback; always overlaid with the real taxpayer PAN.
  "[A-Z]{3}[P][A-Z][0-9]{4}[A-Z]": "AAAPA0000A", // ITR-2 Verification's "must be an Individual's PAN" (4th char 'P') fallback; always overlaid with the real taxpayer PAN — if the real PAN's 4th character isn't 'P', ajv validation correctly fails loudly (this app's scope is resident individuals only, so a non-'P' PAN indicates a data problem worth surfacing, not silently working around).
  "([\\.a-zA-Z0-9_\\-])+@([a-zA-Z0-9_\\-])+(([a-zA-Z0-9_\\-])*\\.([a-zA-Z0-9_\\-])+)+": "placeholder@example.invalid", // generic email fallback; always overlaid with the real taxpayer email.
  "Y|N": "N",
  "2026-07-31": "2026-07-31", // FilingStatus.ItrFilingDueDate — literal per this vendored schema version (AY 2026-27's individual non-audit due date).
};

function resolveRef(ref: string): string {
  const name = ref.split("/").pop();
  if (!name) throw new SchemaSkeletonError(`Malformed $ref: ${ref}`);
  return name;
}

function resolve(defs: JsonSchemaDefinitions, node: JsonSchemaNode): JsonSchemaNode {
  if (!node.$ref) return node;
  const name = resolveRef(node.$ref);
  const target = defs[name];
  if (!target) throw new SchemaSkeletonError(`Unresolvable $ref: ${node.$ref}`);
  return target;
}

function nodeType(node: JsonSchemaNode): string | undefined {
  if (Array.isArray(node.type)) return node.type[0];
  return node.type;
}

function buildLeaf(node: JsonSchemaNode, path: string): unknown {
  if (node.enum && node.enum.length > 0) return node.enum[0];

  // Several string leaves in the real schemas carry an explicit `default`
  // (e.g. `CreationInfo.SWVersionNo`'s `"default": "1.0"`) — using it
  // directly is both schema-valid by construction and, unlike a generic
  // placeholder, matches what the government's OWN offline utility would
  // itself pre-fill for the same field.
  if (node.default !== undefined) return node.default;

  const type = nodeType(node);
  if (type === "integer" || type === "number") return 0;

  if (node.pattern !== undefined) {
    const placeholder = PATTERN_PLACEHOLDERS[node.pattern];
    if (placeholder === undefined) {
      throw new SchemaSkeletonError(
        `No placeholder registered for pattern ${JSON.stringify(node.pattern)} at required field "${path}". ` +
          "Add an entry to PATTERN_PLACEHOLDERS in schemaSkeleton.ts (see file header) rather than guessing.",
      );
    }
    return placeholder;
  }

  if (type === "string" || type === undefined) {
    // A number of string leaves in the real schemas carry an explicit
    // `minLength` (typically 1) as a SEPARATE constraint from the
    // `nonEmptyString` pattern reference (which — see that definition's
    // own regex — actually permits "" despite its name). An empty string
    // would satisfy the pattern but fail `minLength`, so this pads out to
    // the minimum length with a placeholder character rather than assuming
    // "" is always safe.
    const minLength = typeof node.minLength === "number" ? node.minLength : 0;
    return minLength > 0 ? "X".repeat(minLength) : "";
  }

  throw new SchemaSkeletonError(`Unhandled leaf schema shape at required field "${path}": ${JSON.stringify(node)}`);
}

/**
 * Builds a minimal object satisfying every REQUIRED field reachable from
 * `startRef` (a `$ref`-shaped node, e.g. `{ $ref: "#/definitions/ITR1" }`),
 * recursing through nested required objects. Non-required fields are never
 * added (see file header on why). Throws `SchemaSkeletonError` on any
 * required field this function doesn't know how to fill (an unrecognized
 * pattern, or a required field whose own type is unexpectedly `array`).
 */
export function buildRequiredSkeleton(defs: JsonSchemaDefinitions, startRef: JsonSchemaNode, path = "$"): unknown {
  const node = resolve(defs, startRef);
  const type = nodeType(node);

  if (type === "array") {
    throw new SchemaSkeletonError(
      `Required field "${path}" has type "array" — this violates the invariant (verified by hand, see file header) ` +
        "that no required field in the vendored ITR schemas' required-recursive subtree is itself an array. " +
        "The vendored schema file may have changed; re-audit before proceeding.",
    );
  }

  if (type === "object" || node.properties) {
    const result: Record<string, unknown> = {};
    for (const key of node.required ?? []) {
      const propSchema = node.properties?.[key];
      if (!propSchema) {
        throw new SchemaSkeletonError(`Required field "${key}" at "${path}" has no matching "properties" entry.`);
      }
      result[key] = buildRequiredSkeleton(defs, propSchema, `${path}.${key}`);
    }
    return result;
  }

  return buildLeaf(node, path);
}

/**
 * Shallow-recursive deep merge: plain objects are merged key-by-key
 * (overlay wins on conflicts, recursing into nested plain objects); arrays
 * and primitives in `overlay` replace the corresponding `base` value
 * entirely rather than being merged element-wise (predictable, and this
 * package never needs array-level merging — every array field the mappers
 * populate is built fully-formed by the mapper itself, not assembled from a
 * skeleton default plus partial overlay).
 */
export function deepMergeOverlay<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = deepMergeOverlay(baseValue, overlayValue);
    } else {
      result[key] = overlayValue;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively rounds every plain `number` leaf in a value to the nearest
 * integer (`Math.round`), leaving strings/booleans/dates/etc. untouched.
 * Used by the mapper "overlay" builders before merging: every numeric
 * field either mapper actually populates corresponds to a whole-rupee
 * `"type": "integer"` field in the real vendored schema (confirmed by
 * inspection — the only fractional-number fields anywhere in either
 * schema are ownership-percentage fields like `AsseseeShareProperty`/
 * `PercentShareProperty`, which neither mapper populates), but
 * `@cleartax/tax-engine`'s money figures are paisa-rounded (2 decimal
 * places, via `roundPaisa`), not rupee-rounded — inserting one of those
 * directly would fail ajv's `"type": "integer"` check on a value like
 * `12345.5`. Rounding once, centrally, here is safer than remembering to
 * `Math.round()` at every individual call site.
 */
export function roundNumbersDeep<T>(value: T): T {
  if (typeof value === "number") {
    return Math.round(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => roundNumbersDeep(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      result[key] = roundNumbersDeep(v);
    }
    return result as T;
  }
  return value;
}

/**
 * Recursively strips `undefined`-valued keys from a plain object (arrays
 * and their elements are recursed into but not otherwise altered). Used by
 * the mapper "overlay" builders so an absent optional value (e.g. no
 * `addressLine2`) never ends up as a literal `{ key: undefined }` in the
 * object handed to `deepMergeOverlay`/`ajv` — a key present with value
 * `undefined` is not valid JSON and would trip up a strict-typed optional
 * field's `type` check even though the field itself isn't required.
 */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      result[key] = compact(v);
    }
    return result as T;
  }
  return value;
}
