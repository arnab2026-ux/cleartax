import { describe, expect, it } from "vitest";
import { mapToItr1 } from "../../src/ay2026-27/itr1Mapper.js";
import { assertValidItr1 } from "../../src/validate.js";
import { ItrMappingError } from "../../src/types.js";
import { buildCapitalGainsInput, buildItrExportInput, buildSimpleSalaryOnlyInput, EMPTY_FULL_INCOME_INPUT } from "../fixtures.js";

const FIXED_GENERATION_DATE = new Date(Date.UTC(2026, 6, 30));

describe("mapToItr1", () => {
  it("produces a payload that validates against the real vendored ITR-1 government schema", () => {
    const { payload, itrType, schemaVersion } = mapToItr1(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    expect(itrType).toBe("ITR1");
    expect(schemaVersion).toBe("Ver1.0");
    expect(() => assertValidItr1(payload)).not.toThrow();
  });

  it("throws ItrMappingError (not an ajv error) when the input isn't ITR-1-eligible", () => {
    expect(() => mapToItr1(buildCapitalGainsInput())).toThrow(ItrMappingError);
  });

  it("carries the real PAN, name, and DOB through to PersonalInfo/Verification", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.PersonalInfo.PAN).toBe("ABCPM1234F");
    expect(itr1.PersonalInfo.DOB).toBe("1990-06-15");
    expect(itr1.PersonalInfo.AssesseeName.SurNameOrOrgName).toBe("Mehta");
    expect(itr1.PersonalInfo.AssesseeName.FirstName).toBe("Arjun");
    expect(itr1.Verification.Declaration.AssesseeVerPAN).toBe("ABCPM1234F");
    expect(itr1.Verification.Declaration.FatherName).toBe("Ramesh Mehta");
  });

  it("maps the correct StateCode for the taxpayer's state", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.PersonalInfo.Address.StateCode).toBe("19"); // Maharashtra, per the schema's own StateCode description
  });

  it("sets OptOutNewTaxRegime to Y for the old regime and N for the new regime", () => {
    const oldRegime = mapToItr1(buildSimpleSalaryOnlyInput("old"), FIXED_GENERATION_DATE);
    const newRegime = mapToItr1(buildSimpleSalaryOnlyInput("new"), FIXED_GENERATION_DATE);
    expect((oldRegime.payload as any).ITR.ITR1.FilingStatus.OptOutNewTaxRegime).toBe("Y");
    expect((newRegime.payload as any).ITR.ITR1.FilingStatus.OptOutNewTaxRegime).toBe("N");
  });

  it("reports the real, engine-computed tax figures (not zeroes) for a nontrivial salary", () => {
    // Above the new regime's ₹12,00,000 full-rebate threshold (unlike
    // `buildSimpleSalaryOnlyInput`'s default ₹12L gross / ~₹11.25L taxable,
    // which is deliberately IN the zero-tax rebate zone and used elsewhere
    // to test that scenario) — this specific test needs genuinely nonzero
    // tax to assert against.
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 2_000_000 },
      regime: "new",
      age: 30,
    });
    const { payload } = mapToItr1(input, FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.ITR1_IncomeDeductions.TotalIncome).toBe(input.computation.income.totalIncome);
    expect(itr1.ITR1_TaxComputation.GrossTaxLiability).toBe(input.computation.totalTaxLiabilityRounded);
    expect(input.computation.totalTaxLiabilityRounded).toBeGreaterThan(0);
  });

  it("reflects TDS credit and computes a refund when TDS exceeds tax payable", () => {
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 900_000 },
      regime: "new",
      age: 30,
      tdsCredit: 10_000_000, // deliberately huge, to force a refund scenario
    });
    const { payload } = mapToItr1(input, FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.Refund.RefundDue).toBeGreaterThan(0);
    expect(itr1.TaxPaid.BalTaxPayable).toBe(0);
  });

  it("populates bank account details when present on the profile", () => {
    const { payload } = mapToItr1(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.Refund.BankAccountDtls.AddtnlBankDetails).toHaveLength(1);
    expect(itr1.Refund.BankAccountDtls.AddtnlBankDetails[0].IFSCCode).toBe("HDFC0001234");
  });

  it("omits bank account details (schema-valid empty object) when the profile has none", () => {
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 900_000 },
      regime: "new",
      age: 30,
      profile: {
        fullName: "Solo Filer",
        fatherName: "Filer Senior",
        pan: "ABCPS1234F",
        dateOfBirth: new Date(Date.UTC(1995, 0, 1)),
        email: "solo@example.invalid",
        mobileNumber: "9000000000",
        address: { addressLine1: "1 Main St", city: "Delhi", state: "Delhi", pincode: "110001" },
      },
    });
    const { payload } = mapToItr1(input, FIXED_GENERATION_DATE);
    const itr1 = (payload as any).ITR.ITR1;
    expect(itr1.Refund.BankAccountDtls).toEqual({});
    expect(() => assertValidItr1(payload)).not.toThrow();
  });

  it("throws ItrMappingError for an unrecognized state name rather than silently defaulting", () => {
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 900_000 },
      regime: "new",
      age: 30,
      profile: {
        fullName: "Bad State Filer",
        fatherName: "Father",
        pan: "ABCPB1234F",
        dateOfBirth: new Date(Date.UTC(1995, 0, 1)),
        email: "bad@example.invalid",
        mobileNumber: "9000000001",
        address: { addressLine1: "1 Main St", city: "Nowhere", state: "Narnia", pincode: "110001" },
      },
    });
    expect(() => mapToItr1(input, FIXED_GENERATION_DATE)).toThrow(/Unrecognized Indian state/);
  });
});
