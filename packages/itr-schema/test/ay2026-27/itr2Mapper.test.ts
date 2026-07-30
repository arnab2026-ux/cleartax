import { describe, expect, it } from "vitest";
import { mapToItr2 } from "../../src/ay2026-27/itr2Mapper.js";
import { assertValidItr2 } from "../../src/validate.js";
import { buildCapitalGainsInput, buildItrExportInput, buildSimpleSalaryOnlyInput, EMPTY_FULL_INCOME_INPUT } from "../fixtures.js";

const FIXED_GENERATION_DATE = new Date(Date.UTC(2026, 6, 30));

describe("mapToItr2", () => {
  it("produces a payload that validates against the real vendored ITR-2 government schema, for a capital-gains profile", () => {
    const { payload, itrType } = mapToItr2(buildCapitalGainsInput(), FIXED_GENERATION_DATE);
    expect(itrType).toBe("ITR2");
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("also validates for a simple salary-only profile (ITR-2 can represent everything ITR-1 can)", () => {
    const { payload } = mapToItr2(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("validates for a profile with three house properties (beyond even the AY 2026-27 ITR-1 limit of two)", () => {
    const houseProperty = { type: "letOut" as const, annualRentReceived: 240_000, municipalTaxesPaid: 12_000, homeLoanInterestPaid: 50_000 };
    const input = buildItrExportInput({
      fullIncomeInput: {
        ...EMPTY_FULL_INCOME_INPUT,
        grossSalaryIncludingHra: 2_000_000,
        houseProperties: [houseProperty, houseProperty, houseProperty],
      },
      regime: "old",
      age: 40,
    });
    const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("reports the real engine-computed special-rate capital gains tax", () => {
    const input = buildCapitalGainsInput("new");
    const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
    const itr2 = (payload as any).ITR.ITR2;
    expect(itr2["PartB-TI"].IncChargeTaxSplRate111A112).toBe(input.computation.income.capitalGains.totalSpecialRateTaxableIncome);
    expect(input.computation.income.capitalGains.totalSpecialRateTaxableIncome).toBeGreaterThan(0);
    expect(itr2.PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI.TaxAtSpecialRates).toBe(input.computation.capitalGainsTaxBeforeSurcharge);
    expect(input.computation.capitalGainsTaxBeforeSurcharge).toBeGreaterThan(0);
  });

  it("omits ScheduleS/ScheduleHP/ScheduleCGFor23/ScheduleOS when the taxpayer has no such income, while still validating", () => {
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, isSalaried: false, grossSalaryIncludingHra: 0, otherSourcesIncome: 0 },
      regime: "new",
      age: 30,
    });
    const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
    const itr2 = (payload as any).ITR.ITR2;
    expect(itr2.ScheduleS).toBeUndefined();
    expect(itr2.ScheduleHP).toBeUndefined();
    expect(itr2.ScheduleCGFor23).toBeUndefined();
    expect(itr2.ScheduleOS).toBeUndefined();
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("sets ResidentialStatus to RES and Status to I for every taxpayer (this app's resident-individual-only scope)", () => {
    const { payload } = mapToItr2(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    const itr2 = (payload as any).ITR.ITR2;
    expect(itr2.PartA_GEN1.PersonalInfo.Status).toBe("I");
    expect(itr2.PartA_GEN1.FilingStatus.ResidentialStatus).toBe("RES");
  });

  it("does NOT apply ITR-1 eligibility restrictions — a profile that would fail isEligibleForItr1 still maps cleanly", () => {
    const input = buildCapitalGainsInput(); // has STCG, which disqualifies ITR-1
    expect(() => mapToItr2(input, FIXED_GENERATION_DATE)).not.toThrow();
  });
});
