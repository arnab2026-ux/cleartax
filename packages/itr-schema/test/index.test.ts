import { describe, expect, it } from "vitest";
import * as itrSchema from "../src/index.js";

describe("itr-schema package public exports", () => {
  it("exposes the package identifier", () => {
    expect(itrSchema.ITR_SCHEMA_PACKAGE).toBe("@cleartax/itr-schema");
  });

  it("exposes the AY 2026-27 mappers, eligibility check, and registry entry point", () => {
    expect(typeof itrSchema.mapToItr1).toBe("function");
    expect(typeof itrSchema.mapToItr2).toBe("function");
    expect(typeof itrSchema.isEligibleForItr1).toBe("function");
    expect(typeof itrSchema.mapToItrJson).toBe("function");
    expect(typeof itrSchema.getItrMappersForAssessmentYear).toBe("function");
    expect(itrSchema.ITR_SCHEMA_REGISTRY["2026-27"]).toBeDefined();
  });

  it("exposes schema validation helpers", () => {
    expect(typeof itrSchema.assertValidItr1).toBe("function");
    expect(typeof itrSchema.assertValidItr2).toBe("function");
    expect(itrSchema.ItrValidationError).toBeDefined();
  });
});
