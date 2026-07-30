/**
 * Minimal structural typing for the subset of JSON Schema draft-04 features
 * the vendored ITR-1/ITR-2 schemas actually use (`object`/`properties`/
 * `required`, `$ref`, `enum`, `pattern`, `type`, `items`). This is
 * deliberately NOT a full json-schema type-defs package (no such dependency
 * was added) — just enough structure for `schemaSkeleton.ts` to walk the
 * real schema files safely under `strict` TypeScript.
 */
export interface JsonSchemaNode {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  enum?: unknown[];
  pattern?: string;
  items?: JsonSchemaNode;
  allOf?: JsonSchemaNode[];
  additionalProperties?: boolean | JsonSchemaNode;
  definitions?: Record<string, JsonSchemaNode>;
  description?: string;
  [key: string]: unknown;
}

export type JsonSchemaDefinitions = Record<string, JsonSchemaNode>;
