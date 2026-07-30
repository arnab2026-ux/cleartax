import { describe, expect, it } from "vitest";
import { ItrValidationError, assertValidItr1, assertValidItr2 } from "../src/validate.js";
import { mapToItr1 } from "../src/ay2026-27/itr1Mapper.js";
import { mapToItr2 } from "../src/ay2026-27/itr2Mapper.js";
import { buildCapitalGainsInput, buildLotteryIncomeInput, buildSimpleSalaryOnlyInput } from "./fixtures.js";

describe("assertValidItr1 / assertValidItr2 — the real vendored government schema", () => {
  it("does not throw on a real mapper's valid output", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput());
    expect(() => assertValidItr1(payload)).not.toThrow();
  });

  it("does not throw on a real ITR-2 mapper's valid output", () => {
    const { payload } = mapToItr2(buildCapitalGainsInput());
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("throws ItrValidationError, listing specific errors, when a required field is deliberately deleted", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput());
    const broken = JSON.parse(JSON.stringify(payload));
    delete broken.ITR.ITR1.PersonalInfo.PAN;

    let caught: unknown;
    try {
      assertValidItr1(broken);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ItrValidationError);
    const error = caught as ItrValidationError;
    expect(error.errors.length).toBeGreaterThan(0);
    expect(error.errors.some((e) => e.message?.includes("PAN"))).toBe(true);
    expect(error.message).toContain("PAN");
  });

  it("throws ItrValidationError when a field is given the wrong type (string where the schema requires an integer)", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.ITR.ITR1.ITR1_IncomeDeductions.GrossSalary = "not-a-number";

    expect(() => assertValidItr1(broken)).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError when an enum field is given a value outside the government's own enum list", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.ITR.ITR1.PersonalInfo.Address.StateCode = "ZZ";

    expect(() => assertValidItr1(broken)).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError when a PAN doesn't match the required pattern", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.ITR.ITR1.PersonalInfo.PAN = "not-a-pan";

    expect(() => assertValidItr1(broken)).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError on a completely empty ITR1 payload", () => {
    expect(() => assertValidItr1({ ITR: { ITR1: {} } })).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError on a completely empty ITR2 payload", () => {
    expect(() => assertValidItr2({ ITR: { ITR2: {} } })).toThrow(ItrValidationError);
  });

  // The tests above deliberately break ITR1 output only — added during the
  // Phase 6 adversarial review to confirm the same rigor applies to the
  // much larger ITR-2 schema (390KB vs. ITR-1's 145KB, and the form most
  // taxpayers with any capital gains/lottery income will actually use per
  // itr2Mapper.ts's own file header), and to confirm ajv actually enforces
  // `additionalProperties: false` rather than silently ignoring unknown
  // fields (neither vendored schema would reject a typo'd/extra field
  // otherwise, which could mask a real mapper bug).
  it("throws ItrValidationError when a required ITR2 top-level schedule is deleted", () => {
    const { payload } = mapToItr2(buildCapitalGainsInput());
    const broken = JSON.parse(JSON.stringify(payload));
    delete broken.ITR.ITR2.PartB_TTI;
    expect(() => assertValidItr2(broken)).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError when an unexpected extra field is added (additionalProperties: false is actually enforced)", () => {
    const { payload } = mapToItr2(buildCapitalGainsInput());
    const broken = JSON.parse(JSON.stringify(payload));
    broken.ITR.ITR2.PartA_GEN1.PersonalInfo.TOTALLY_MADE_UP_FIELD = "hi";
    expect(() => assertValidItr2(broken)).toThrow(ItrValidationError);
  });

  it("throws ItrValidationError when a nested required sibling field is deleted (confirms $ref resolution reaches nested definitions, not just the top level)", () => {
    const { payload } = mapToItr2(buildLotteryIncomeInput());
    const broken = JSON.parse(JSON.stringify(payload));
    delete broken.ITR.ITR2.ScheduleSI.TotSplRateIncTax;
    expect(() => assertValidItr2(broken)).toThrow(ItrValidationError);
  });
});
