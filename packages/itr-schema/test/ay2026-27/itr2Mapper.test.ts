import { describe, expect, it } from "vitest";
import { mapToItr2 } from "../../src/ay2026-27/itr2Mapper.js";
import { assertValidItr2 } from "../../src/validate.js";
import {
  BASE_PROFILE,
  buildCapitalGainsInput,
  buildItrExportInput,
  buildLotteryIncomeInput,
  buildSimpleSalaryOnlyInput,
  EMPTY_FULL_INCOME_INPUT,
} from "../fixtures.js";

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

  // Bug fix (Phase 6 adversarial review, Priority 3 skeleton-fabrication
  // audit): BankAccountDtls.BankDtlsFlag is required by the real schema and
  // carries the schema's OWN default of "Y" — this mapper never used to set
  // it explicitly, so a taxpayer with no bank details on file (a very
  // ordinary case) would get a JSON that falsely claims "Y" (bank details
  // provided) because deepMergeOverlay(skeleton, {}) leaves the skeleton's
  // default value untouched. See itr2Mapper.ts's `bankAccountDtls`.
  describe("Refund.BankAccountDtls.BankDtlsFlag (skeleton-default fabrication bug)", () => {
    it("is 'N' — not the schema's default 'Y' — when the taxpayer has no bank details on file", () => {
      const noBankProfile = { ...BASE_PROFILE, bankAccountNumber: undefined, bankIfsc: undefined, bankName: undefined };
      const input = buildItrExportInput({
        fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 1_500_000 },
        regime: "new",
        age: 30,
        profile: noBankProfile,
      });
      const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
      const itr2 = (payload as any).ITR.ITR2;
      expect(itr2.PartB_TTI.Refund.BankAccountDtls.BankDtlsFlag).toBe("N");
      expect(itr2.PartB_TTI.Refund.BankAccountDtls.AddtnlBankDetails).toBeUndefined();
      expect(() => assertValidItr2(payload)).not.toThrow();
    });

    it("is 'Y' when the taxpayer HAS bank details on file", () => {
      const { payload } = mapToItr2(buildSimpleSalaryOnlyInput(), FIXED_GENERATION_DATE); // BASE_PROFILE has bank details
      const itr2 = (payload as any).ITR.ITR2;
      expect(itr2.PartB_TTI.Refund.BankAccountDtls.BankDtlsFlag).toBe("Y");
      expect(itr2.PartB_TTI.Refund.BankAccountDtls.AddtnlBankDetails).toHaveLength(1);
    });
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

  // Phase 6 adversarial review: Section 115BB (lottery/game-winnings) fix.
  // Before this fix, `packages/tax-engine` folded lottery income into
  // ordinary slab-rate "other sources income" (taxed at the taxpayer's
  // slab, not the correct flat 30%), AND this mapper assigned a bare number
  // to `ScheduleOS.IncFrmLottery` even though the real schema requires a
  // `DateRangeType` object there — a second, independent bug that no
  // existing test caught (every fixture used an empty `otherSourceIncomes`
  // list, so the field was never populated against the real schema).
  describe("Section 115BB (lottery/game-winnings income)", () => {
    it("validates against the real vendored ITR-2 schema with real lottery income present (previously would have failed: IncFrmLottery's shape mismatch)", () => {
      const input = buildLotteryIncomeInput();
      const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
      expect(() => assertValidItr2(payload)).not.toThrow();
    });

    it("reports the flat-30% Section 115BB tax as special-rate tax, not folded into ordinary slab tax", () => {
      const input = buildLotteryIncomeInput();
      const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
      const itr2 = (payload as any).ITR.ITR2;

      // 30% of 1,000,000 lottery income = 300,000, matching the engine's own figure.
      expect(input.computation.lotteryTaxBeforeSurcharge).toBeCloseTo(300_000, 2);
      expect(itr2.PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI.TaxAtSpecialRates).toBeCloseTo(300_000, 0);
      // The lottery income itself shows up as special-rate income, not slab income.
      expect(itr2["PartB-TI"].IncFromOS.IncChargblSplRate).toBe(1_000_000);
      expect(itr2["PartB-TI"].IncFromOS.OtherSrcThanOwnRaceHorse).toBe(0); // no OTHER other-sources income in this fixture
      // ScheduleSI's total special-rate tax includes the 115BB tax.
      expect(itr2.ScheduleSI.TotSplRateIncTax).toBeCloseTo(300_000, 0);
    });

    it("IncFrmLottery is a DateRangeType object (not a bare number) carrying the real amount", () => {
      const input = buildLotteryIncomeInput();
      const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
      const itr2 = (payload as any).ITR.ITR2;
      expect(itr2.ScheduleOS.IncFrmLottery).toEqual({
        DateRange: {
          Upto15Of6: 0,
          Upto15Of9: 0,
          Up16Of9To15Of12: 0,
          Up16Of12To15Of3: 0,
          Up16Of3To31Of3: 1_000_000,
        },
      });
    });

    it("total tax liability is strictly higher than if the same income were taxed at ordinary slab rates (regression guard against re-introducing the fold-into-slab bug)", () => {
      const input = buildLotteryIncomeInput();
      // Total income (800,000 salary after SD + 1,000,000 lottery) puts the
      // taxpayer's SLAB income well under the new-regime 12L rebate
      // threshold on its own — if lottery were still folded into slab
      // income (the old bug), a large chunk of it could even land inside
      // the rebate and be taxed at LESS than 30%. The fix guarantees at
      // least the flat 30%+cess on the lottery portion regardless.
      expect(input.computation.totalTaxLiability).toBeGreaterThanOrEqual(300_000 * 1.04); // 30% + 4% cess, minimum
    });
  });
});
