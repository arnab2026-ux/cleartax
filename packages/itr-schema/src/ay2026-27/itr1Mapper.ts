/**
 * Maps `ItrExportInput` to the real ITR-1 (Sahaj) JSON structure for AY
 * 2026-27, validated against the vendored government schema
 * (`schema/itr1-schema.json`) before being returned — see `validate.ts`.
 *
 * Only usable when `isEligibleForItr1(input).eligible` is true — this
 * mapper does NOT re-derive eligibility silently; it throws
 * `ItrMappingError` up front if called on ineligible input, per the Phase 6
 * brief's explicit instruction to implement ITR-1's real eligibility
 * restrictions rather than assuming every input can go into ITR-1.
 *
 * SCOPE LIMITATIONS (see PROGRESS.md's Phase 6 section for the full list
 * and confidence assessment):
 *  - Schedule 112A (scrip-wise LTCG-equity sale consideration/cost detail)
 *    is NOT populated — this app's data model only ever carries a
 *    pre-derived net gain per transaction (`CapitalGainTransactionInput.
 *    gainAmount`), never the separate sale-value/acquisition-cost figures a
 *    real Schedule 112A wants per scrip. The gross LTCG-112A gain still
 *    flows into `GrossTotIncomeIncLTCG112A` (so the aggregate income figure
 *    is correct), just not the itemized schedule.
 *  - Every Chapter VI-A section `packages/tax-engine` doesn't implement
 *    (80CCC, 80DD, 80E, 80EE/80EEA/80EEB, 80G/80GG/80GGA/80GGC, 80U, 80CCH)
 *    is reported as 0 — matches the engine's own documented scope boundary
 *    (see `deductions.ts`'s file header), not a mapping-layer omission.
 *  - Section 89 salary-arrears relief, advance-tax/self-assessment-tax
 *    payment tracking, and interest under Sections 234A/B/C are all
 *    reported as 0 — none of these are tracked anywhere in this app's data
 *    model.
 */
import itr1Schema from "./schema/itr1-schema.json";
import type { JsonSchemaDefinitions } from "../jsonSchemaTypes";
import { buildRequiredSkeleton, compact, deepMergeOverlay, roundNumbersDeep } from "../schemaSkeleton";
import { assertValidItr1 } from "../validate";
import { ItrMappingError, type ItrExportInput, type MappedItrResult } from "../types";
import { isEligibleForItr1 } from "./eligibility";
import {
  COUNTRY_CODE_INDIA,
  ITR_FILING_DUE_DATE,
  RETURN_FILE_SECTION,
  SCHEMA_ASSESSMENT_YEAR,
  SCHEMA_FORM_VERSION,
  SOFTWARE_VENDOR_CODE,
  splitName,
  stateNameToCode,
  toIsoDateString,
} from "./constants";

const ITR1_DEFINITIONS = itr1Schema.definitions as unknown as JsonSchemaDefinitions;

export function mapToItr1(input: ItrExportInput, generatedAt: Date = new Date()): MappedItrResult {
  const eligibility = isEligibleForItr1(input);
  if (!eligibility.eligible) {
    throw new ItrMappingError(`Input is not eligible for ITR-1:\n${eligibility.reasons.map((r) => `  - ${r}`).join("\n")}`);
  }
  if (
    input.computation.slabSurcharge.surchargeAfterRelief > 0 ||
    input.computation.capitalGainsSurcharge > 0 ||
    input.computation.lotterySurcharge > 0
  ) {
    // Structurally shouldn't happen given the ≤₹50L eligibility check above
    // (below every surcharge threshold), but guarded explicitly since
    // ITR1_TaxComputation's real schema has no surcharge field at all —
    // silently dropping a nonzero surcharge would understate tax payable.
    throw new ItrMappingError("Unexpected nonzero surcharge for an ITR-1-eligible computation — ITR-1's schema has no surcharge field.");
  }
  if (input.computation.lotteryTaxBeforeSurcharge > 0) {
    // Structurally shouldn't happen either — isEligibleForItr1 disqualifies
    // any lottery/game-winnings income (Section 115BB) from ITR-1 entirely
    // (see eligibility.ts) — but guarded explicitly for the same "never
    // silently drop a real tax figure" reason as the surcharge check above.
    // ITR1_TaxComputation has no Schedule SI / 115BB field to report it in.
    throw new ItrMappingError("Unexpected nonzero Section 115BB tax for an ITR-1-eligible computation — ITR-1 does not support lottery/game-winnings income.");
  }

  const { profile, computation, fullIncomeInput } = input;
  const name = splitName(profile.fullName);
  const cg = computation.income.capitalGains;
  const deductions = computation.income.deductions;
  const claimed = fullIncomeInput.deductions;

  const skeleton = buildRequiredSkeleton(ITR1_DEFINITIONS, { $ref: "#/definitions/ITR1" }) as Record<string, unknown>;

  const grossTotIncome = computation.income.salaryTaxable + computation.income.housePropertyContribution + computation.income.otherSourcesIncome;
  const grossTotIncomeIncLTCG112A = grossTotIncome + cg.ltcgEquityNetGain;

  const usrDeductions = {
    Section80C: claimed?.section80C ?? 0,
    Section80CCC: 0,
    Section80CCDEmployeeOrSE: 0,
    Section80CCD1B: claimed?.section80CCD1B ?? 0,
    Section80CCDEmployer: claimed?.section80CCD2.employerContribution ?? 0,
    Section80D: (claimed?.section80D.selfAndFamilyPremium ?? 0) + (claimed?.section80D.parentsPremium ?? 0) + (claimed?.section80D.preventiveHealthCheckup ?? 0),
    Section80DD: 0,
    Section80DDB: 0,
    Section80E: 0,
    Section80EE: 0,
    Section80EEA: 0,
    Section80EEB: 0,
    Section80G: 0,
    Section80GG: 0,
    Section80GGA: 0,
    Section80GGC: 0,
    Section80U: 0,
    Section80TTA: 0, // the department computes TTA/TTB itself from interest income; not a taxpayer-"claimed" figure in this app's model (see `interestIncomeForTtaOrTtb` in toTaxEngineInput.ts)
    Section80TTB: 0,
    AnyOthSec80CCH: 0,
    TotalChapVIADeductions:
      (claimed?.section80C ?? 0) +
      (claimed?.section80CCD1B ?? 0) +
      (claimed?.section80CCD2.employerContribution ?? 0) +
      (claimed?.section80D.selfAndFamilyPremium ?? 0) +
      (claimed?.section80D.parentsPremium ?? 0) +
      (claimed?.section80D.preventiveHealthCheckup ?? 0),
  };

  const allowedDeductions = {
    Section80C: deductions.section80C,
    Section80CCC: 0,
    Section80CCDEmployeeOrSE: 0,
    Section80CCD1B: deductions.section80CCD1B,
    Section80CCDEmployer: deductions.section80CCD2,
    Section80D: deductions.section80D,
    Section80DD: 0,
    Section80DDB: 0,
    Section80E: 0,
    Section80EE: 0,
    Section80EEA: 0,
    Section80EEB: 0,
    Section80G: 0,
    Section80GG: 0,
    Section80GGA: 0,
    Section80GGC: 0,
    Section80U: 0,
    Section80TTA: deductions.section80TTA,
    Section80TTB: deductions.section80TTB,
    AnyOthSec80CCH: 0,
    TotalChapVIADeductions: deductions.totalDeduction,
  };

  const totalTaxesPaid = (input.advanceTaxPaid ?? 0) + input.tdsCredit + (input.selfAssessmentTaxPaid ?? 0);
  const totTaxPlusIntrstPay = computation.totalTaxLiabilityRounded; // interest u/234A-C not modeled (always 0) — see file header
  const balTaxPayable = Math.max(0, totTaxPlusIntrstPay - totalTaxesPaid);
  const refundDue = Math.max(0, totalTaxesPaid - totTaxPlusIntrstPay);

  const overlay = {
    CreationInfo: {
      SWVersionNo: "1.0",
      SWCreatedBy: SOFTWARE_VENDOR_CODE,
      JSONCreatedBy: SOFTWARE_VENDOR_CODE,
      JSONCreationDate: toIsoDateString(generatedAt),
      IntermediaryCity: profile.address.city,
      Digest: "-",
    },
    Form_ITR1: {
      FormName: "ITR-1",
      Description: "Indian Income Tax Return Form-1 (Sahaj)",
      AssessmentYear: SCHEMA_ASSESSMENT_YEAR,
      SchemaVer: SCHEMA_FORM_VERSION,
      FormVer: SCHEMA_FORM_VERSION,
    },
    PersonalInfo: {
      AssesseeName: {
        FirstName: name.firstName,
        MiddleName: name.middleName,
        SurNameOrOrgName: name.surname,
      },
      PAN: profile.pan,
      Address: {
        ResidenceNo: profile.address.addressLine1,
        ResidenceName: profile.address.addressLine2,
        LocalityOrArea: profile.address.addressLine2 ?? profile.address.city,
        CityOrTownOrDistrict: profile.address.city,
        StateCode: stateNameToCode(profile.address.state),
        CountryCode: COUNTRY_CODE_INDIA,
        PinCode: Number(profile.address.pincode),
        CountryCodeMobile: Number(profile.countryCodeMobile ?? "91"),
        MobileNo: Number(profile.mobileNumber),
        EmailAddress: profile.email,
      },
      SecondaryAdd: "N",
      DOB: toIsoDateString(profile.dateOfBirth),
      EmployerCategory: "OTH", // not tracked by this app's data model — see PROGRESS.md
      AadhaarCardNo: undefined,
    },
    FilingStatus: {
      ReturnFileSec: input.filingSection ?? RETURN_FILE_SECTION.ON_OR_BEFORE_DUE_DATE,
      OptOutNewTaxRegime: input.regime === "old" ? "Y" : "N",
      AsseseeRepFlg: "N",
      ItrFilingDueDate: ITR_FILING_DUE_DATE,
    },
    ITR1_IncomeDeductions: {
      GrossSalary: fullIncomeInput.grossSalaryIncludingHra,
      NetSalary: fullIncomeInput.grossSalaryIncludingHra - (computation.income.hra?.exemptHra ?? 0),
      DeductionUs16: computation.income.standardDeduction,
      DeductionUs16ia: computation.income.standardDeduction,
      IncomeFromSal: computation.income.salaryTaxable,
      TotalIncomeChargeableUnHP: computation.income.housePropertyContribution,
      IncomeOthSrc: computation.income.otherSourcesIncome,
      GrossTotIncome: grossTotIncome,
      GrossTotIncomeIncLTCG112A: grossTotIncomeIncLTCG112A,
      UsrDeductUndChapVIA: usrDeductions,
      DeductUndChapVIA: allowedDeductions,
      TotalIncome: computation.income.totalIncome,
    },
    ITR1_TaxComputation: {
      TotalTaxPayable: computation.slabTaxBeforeRebate,
      Rebate87A: computation.rebate.rebateApplied,
      TaxPayableOnRebate: computation.slabTaxAfterRebate,
      EducationCess: computation.cess.cess,
      GrossTaxLiability: computation.totalTaxLiabilityRounded,
      Section89: 0,
      NetTaxLiability: computation.totalTaxLiabilityRounded,
      TotalIntrstPay: 0,
      IntrstPay: {
        IntrstPayUs234A: 0,
        IntrstPayUs234B: 0,
        IntrstPayUs234C: 0,
        LateFilingFee234F: 0,
      },
      TotTaxPlusIntrstPay: totTaxPlusIntrstPay,
    },
    TaxPaid: {
      TaxesPaid: {
        AdvanceTax: input.advanceTaxPaid ?? 0,
        TDS: input.tdsCredit,
        TCS: 0,
        SelfAssessmentTax: input.selfAssessmentTaxPaid ?? 0,
        TotalTaxesPaid: totalTaxesPaid,
      },
      BalTaxPayable: balTaxPayable,
    },
    Refund: {
      RefundDue: refundDue,
      BankAccountDtls:
        profile.bankAccountNumber && profile.bankIfsc && profile.bankName
          ? {
              AddtnlBankDetails: [
                {
                  IFSCCode: profile.bankIfsc,
                  BankName: profile.bankName,
                  BankAccountNo: profile.bankAccountNumber,
                  AccountType: "SB",
                  UseForRefund: "true",
                },
              ],
            }
          : {},
    },
    Verification: {
      Declaration: {
        AssesseeVerName: profile.fullName,
        FatherName: profile.fatherName,
        AssesseeVerPAN: profile.pan,
      },
      Capacity: "S",
      Place: profile.address.city,
    },
  };

  const itr1 = deepMergeOverlay(skeleton, roundNumbersDeep(compact(overlay)));
  const payload = { ITR: { ITR1: itr1 } };
  assertValidItr1(payload);

  return { itrType: "ITR1", schemaVersion: SCHEMA_FORM_VERSION, payload };
}
