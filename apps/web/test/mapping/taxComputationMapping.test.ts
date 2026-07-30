import { computeFullTaxLiability, type FullIncomeInput } from "@cleartax/tax-engine";
import { describe, expect, it } from "vitest";
import { computeGrossTotalIncome, mapFullTaxLiabilityToTaxComputation } from "../../lib/mapping/taxComputationMapping";

describe("mapFullTaxLiabilityToTaxComputation", () => {
  const income: FullIncomeInput = {
    isSalaried: true,
    grossSalaryIncludingHra: 1_800_000,
    hra: { basicSalary: 900_000, hraReceived: 360_000, rentPaid: 300_000, isMetro: true },
    houseProperties: [],
    capitalGainTransactions: [
      { assetType: "listedEquityOrEquityMF", gainAmount: 200_000, holdingPeriodMonths: 20 },
    ],
    otherSourcesIncome: 50_000,
    deductions: {
      section80C: 150_000,
      section80D: { selfAndFamilyPremium: 20_000, selfOrFamilyHasSenior: false, parentsPremium: 0, parentsHaveSenior: false, preventiveHealthCheckup: 0 },
      section80CCD1B: 50_000,
      section80CCD2: { employerContribution: 0, salary: 900_000, employmentType: "other" },
      interestIncomeForTtaOrTtb: 8_000,
    },
  };

  it("maps every documented column correctly for the old regime", () => {
    const result = computeFullTaxLiability(income, "old", 45);
    const mapped = mapFullTaxLiabilityToTaxComputation(result, 150_000);

    expect(mapped.taxBeforeRebate).toBe(result.slabTaxBeforeRebate);
    expect(mapped.capitalGainsTax).toBe(result.capitalGainsTaxBeforeSurcharge);
    expect(mapped.rebate).toBe(result.rebate.rebateApplied);
    expect(mapped.taxAfterRebate).toBe(result.slabTaxAfterRebate);
    expect(mapped.surcharge).toBe(result.slabSurcharge.surchargeAfterRelief + result.capitalGainsSurcharge);
    expect(mapped.marginalRelief).toBe(result.rebate.marginalReliefApplied + result.slabSurcharge.marginalReliefApplied);
    expect(mapped.cess).toBe(result.cess.cess);
    expect(mapped.totalTaxLiability).toBe(result.totalTaxLiabilityRounded);
    expect(mapped.taxableIncome).toBe(result.income.totalIncome);
    expect(mapped.totalDeductions).toBe(result.income.deductions.totalDeduction);
    expect(mapped.tdsCredit).toBe(150_000);
    expect(mapped.netPayableOrRefund).toBe(result.totalTaxLiabilityRounded - 150_000);
  });

  it("produces the same result for the new regime (different numbers, same shape)", () => {
    const result = computeFullTaxLiability(income, "new", 45);
    const mapped = mapFullTaxLiabilityToTaxComputation(result, 150_000);
    expect(mapped.totalTaxLiability).toBe(result.totalTaxLiabilityRounded);
    // New regime forces HRA/Chapter VI-A to 0, so deductions should reflect that.
    expect(mapped.totalDeductions).toBe(0);
  });

  it("computeGrossTotalIncome reconciles with totalDeductions to (approximately) the pre-rounding taxable income", () => {
    const result = computeFullTaxLiability(income, "old", 45);
    const gross = computeGrossTotalIncome(result);
    const reconstructedSlabIncome = gross - result.income.deductions.totalDeduction - result.income.capitalGains.totalSpecialRateTaxableIncome;
    expect(reconstructedSlabIncome).toBeCloseTo(result.income.slabTaxableIncomeBeforeRounding, 6);
  });

  it("produces a negative netPayableOrRefund (a refund) when TDS exceeds the final liability", () => {
    const result = computeFullTaxLiability(income, "old", 45);
    const mapped = mapFullTaxLiabilityToTaxComputation(result, result.totalTaxLiabilityRounded + 10_000);
    expect(mapped.netPayableOrRefund).toBeLessThan(0);
  });
});
