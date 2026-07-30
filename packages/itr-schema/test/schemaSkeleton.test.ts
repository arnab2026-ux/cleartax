import { describe, expect, it } from "vitest";
import { SchemaSkeletonError, buildRequiredSkeleton, compact, deepMergeOverlay } from "../src/schemaSkeleton.js";
import type { JsonSchemaDefinitions } from "../src/jsonSchemaTypes.js";
import itr1Schema from "../src/ay2026-27/schema/itr1-schema.json";
import itr2Schema from "../src/ay2026-27/schema/itr2-schema.json";
import Ajv04 from "ajv-draft-04";

const itr1Defs = itr1Schema.definitions as unknown as JsonSchemaDefinitions;
const itr2Defs = itr2Schema.definitions as unknown as JsonSchemaDefinitions;

describe("buildRequiredSkeleton", () => {
  it("builds a skeleton for ITR1 that satisfies every required field, validated by ajv-draft-04 against the real vendored schema", () => {
    const skeleton = buildRequiredSkeleton(itr1Defs, { $ref: "#/definitions/ITR1" });
    const ajv = new Ajv04({ strict: false, allErrors: true });
    const validate = ajv.compile(itr1Schema);
    const valid = validate({ ITR: { ITR1: skeleton } });
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("builds a skeleton for ITR2 that satisfies every required field, validated by ajv-draft-04 against the real vendored schema", () => {
    const skeleton = buildRequiredSkeleton(itr2Defs, { $ref: "#/definitions/ITR2" });
    const ajv = new Ajv04({ strict: false, allErrors: true });
    const validate = ajv.compile(itr2Schema);
    const valid = validate({ ITR: { ITR2: skeleton } });
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("fills enum leaves with the enum's first value", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Status: { type: "string", enum: ["I", "H"] } },
        required: ["Status"],
      },
    };
    const skeleton = buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" });
    expect(skeleton).toEqual({ Status: "I" });
  });

  it("fills integer leaves with 0", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Amount: { type: "integer", minimum: 0 } },
        required: ["Amount"],
      },
    };
    expect(buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" })).toEqual({ Amount: 0 });
  });

  it("recurses through nested $ref'd required objects", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Nested: { $ref: "#/definitions/Nested" } },
        required: ["Nested"],
      },
      Nested: {
        type: "object",
        properties: { Value: { type: "integer" } },
        required: ["Value"],
      },
    };
    expect(buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" })).toEqual({ Nested: { Value: 0 } });
  });

  it("omits non-required fields entirely", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Required: { type: "integer" }, Optional: { type: "integer" } },
        required: ["Required"],
      },
    };
    const skeleton = buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" }) as Record<string, unknown>;
    expect(skeleton).toEqual({ Required: 0 });
    expect("Optional" in skeleton).toBe(false);
  });

  it("throws SchemaSkeletonError on an unrecognized required pattern rather than guessing a value", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Weird: { type: "string", pattern: "^SOME-NEVER-SEEN-PATTERN$" } },
        required: ["Weird"],
      },
    };
    expect(() => buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" })).toThrow(SchemaSkeletonError);
  });

  it("throws SchemaSkeletonError if a required field is itself an array (an invariant this codebase verified by hand doesn't occur in the real schemas)", () => {
    const defs: JsonSchemaDefinitions = {
      Root: {
        type: "object",
        properties: { Items: { type: "array", items: { type: "integer" } } },
        required: ["Items"],
      },
    };
    expect(() => buildRequiredSkeleton(defs, { $ref: "#/definitions/Root" })).toThrow(SchemaSkeletonError);
  });

  it("throws SchemaSkeletonError on an unresolvable $ref", () => {
    const defs: JsonSchemaDefinitions = {};
    expect(() => buildRequiredSkeleton(defs, { $ref: "#/definitions/Missing" })).toThrow(SchemaSkeletonError);
  });
});

describe("compact", () => {
  it("removes undefined-valued keys from plain objects", () => {
    expect(compact({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("recurses into nested objects and arrays", () => {
    expect(compact({ a: { b: undefined, c: 2 }, d: [{ e: undefined, f: 1 }] })).toEqual({ a: { c: 2 }, d: [{ f: 1 }] });
  });

  it("leaves defined primitives, zero, and false untouched", () => {
    expect(compact({ a: 0, b: false, c: "" })).toEqual({ a: 0, b: false, c: "" });
  });
});

describe("deepMergeOverlay", () => {
  it("overlay values win over base values on conflicting keys", () => {
    expect(deepMergeOverlay({ a: 1, b: 2 }, { b: 99 })).toEqual({ a: 1, b: 99 });
  });

  it("recursively merges nested plain objects instead of replacing them wholesale", () => {
    const base = { outer: { a: 1, b: 2 } };
    const overlay = { outer: { b: 99 } };
    expect(deepMergeOverlay(base, overlay)).toEqual({ outer: { a: 1, b: 99 } });
  });

  it("replaces arrays wholesale rather than merging element-wise", () => {
    const base = { list: [1, 2, 3] };
    const overlay = { list: [9] };
    expect(deepMergeOverlay(base, overlay)).toEqual({ list: [9] });
  });

  it("adds new keys from the overlay that weren't in the base", () => {
    expect(deepMergeOverlay({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
});
