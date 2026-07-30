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

  it("does not overstate grossTotalIncome when the pre-Chapter-VI-A slab total is negative (e.g. a large self-occupied home-loan-interest loss set-off) — adversarial review regression test", () => {
    // Modest salary + the old regime's ₹2,00,000/year self-occupied
    // home-loan-interest loss set-off + LTCG-equity, with zero Chapter VI-A
    // deductions claimed. fullIncome.ts's computeFullTaxableIncome floors
    // slabTaxableIncomeBeforeRounding at 0 (Math.max(0, ...)) internally,
    // which previously caused computeGrossTotalIncome's
    // add-the-deductions-back reconstruction to silently absorb whatever the
    // floor clamp discarded, overstating grossTotalIncome — see this
    // function's doc comment for the concrete before/after numbers.
    const negativePreFloorIncome: FullIncomeInput = {
      isSalaried: true,
      grossSalaryIncludingHra: 175_000, // -50,000 (old-regime standard deduction) = 125,000 salaryTaxable
      houseProperties: [{ type: "selfOccupied", homeLoanInterestPaid: 200_000 }],
      capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 300_000, holdingPeriodMonths: 20 }],
      otherSourcesIncome: 0,
    };
    const result = computeFullTaxLiability(negativePreFloorIncome, "old", 30);

    // Sanity-check the scenario actually exercises the floor (otherwise this
    // test wouldn't be testing what it claims to).
    expect(result.income.salaryTaxable + result.income.housePropertyContribution).toBeLessThan(0);
    expect(result.income.slabTaxableIncomeBeforeRounding).toBe(0);

    const gross = computeGrossTotalIncome(result);
    const expectedGross =
      result.income.salaryTaxable +
      result.income.housePropertyContribution +
      result.income.otherSourcesIncome +
      result.income.capitalGains.stcgOtherSlabRateIncome +
      result.income.capitalGains.totalSpecialRateTaxableIncome;
    expect(gross).toBe(expectedGross);

    // The old (reverse-derivation) implementation would have returned
    // slabTaxableIncomeBeforeRounding(0) + totalDeduction(0) +
    // totalSpecialRateTaxableIncome, silently dropping the negative
    // housePropertyContribution entirely.
    const oldBuggyGross =
      result.income.slabTaxableIncomeBeforeRounding +
      result.income.deductions.totalDeduction +
      result.income.capitalGains.totalSpecialRateTaxableIncome;
    expect(gross).toBeLessThan(oldBuggyGross);
  });
});
