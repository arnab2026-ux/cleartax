import { describe, expect, it } from "vitest";
import { ITR_SCHEMA_REGISTRY, getItrMappersForAssessmentYear, mapToItrJson } from "../src/registry.js";
import { assertValidItr1, assertValidItr2 } from "../src/validate.js";
import { buildCapitalGainsInput, buildSimpleSalaryOnlyInput } from "./fixtures.js";

describe("ITR_SCHEMA_REGISTRY / getItrMappersForAssessmentYear", () => {
  it("has an entry for 2026-27", () => {
    expect(ITR_SCHEMA_REGISTRY["2026-27"]).toBeDefined();
  });

  it("returns the 2026-27 mappers for a valid lookup", () => {
    const mappers = getItrMappersForAssessmentYear("2026-27");
    expect(typeof mappers.isEligibleForItr1).toBe("function");
    expect(typeof mappers.mapToItr1).toBe("function");
    expect(typeof mappers.mapToItr2).toBe("function");
  });

  it("throws a clear error for an unregistered assessment year, listing the registered years", () => {
    expect(() => getItrMappersForAssessmentYear("2027-28")).toThrow(/2027-28/);
    expect(() => getItrMappersForAssessmentYear("2027-28")).toThrow(/2026-27/);
  });
});

describe("mapToItrJson", () => {
  it("picks ITR-1 when the input is ITR-1-eligible", () => {
    const result = mapToItrJson(buildSimpleSalaryOnlyInput());
    expect(result.itrType).toBe("ITR1");
    expect(() => assertValidItr1(result.payload)).not.toThrow();
  });

  it("picks ITR-2 when the input is not ITR-1-eligible (e.g. has capital gains)", () => {
    const result = mapToItrJson(buildCapitalGainsInput());
    expect(result.itrType).toBe("ITR2");
    expect(() => assertValidItr2(result.payload)).not.toThrow();
  });

  it("throws for an input whose assessmentYear isn't registered", () => {
    const input = buildSimpleSalaryOnlyInput();
    expect(() => mapToItrJson({ ...input, assessmentYear: "1999-00" })).toThrow(/1999-00/);
  });
});
