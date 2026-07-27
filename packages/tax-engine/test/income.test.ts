import { describe, expect, it } from "vitest";
import { computeTaxableIncomePhase1 } from "../src/ay2026-27/income.js";
import { NEW_REGIME_STANDARD_DEDUCTION, OLD_REGIME_STANDARD_DEDUCTION } from "../src/ay2026-27/slabs.js";

describe("computeTaxableIncomePhase1", () => {
  it("standard deduction differs by regime: 75,000 (new) vs 50,000 (old)", () => {
    expect(NEW_REGIME_STANDARD_DEDUCTION).toBe(75_000);
    expect(OLD_REGIME_STANDARD_DEDUCTION).toBe(50_000);
  });

  it("salaried, new regime: gross salary less 75,000 standard deduction", () => {
    const result = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 1_000_000,
      otherSourcesIncome: 0,
    });
    expect(result.standardDeduction).toBe(75_000);
    expect(result.salaryIncomeAfterStandardDeduction).toBe(925_000);
    expect(result.taxableIncome).toBe(925_000);
  });

  it("salaried, old regime: gross salary less 50,000 standard deduction", () => {
    const result = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 1_000_000,
      otherSourcesIncome: 0,
    });
    expect(result.standardDeduction).toBe(50_000);
    expect(result.salaryIncomeAfterStandardDeduction).toBe(950_000);
  });

  it("not salaried: no standard deduction applies regardless of regime", () => {
    const result = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: false,
      grossSalary: 0,
      otherSourcesIncome: 800_000,
    });
    expect(result.standardDeduction).toBe(0);
    expect(result.taxableIncome).toBe(800_000);
  });

  it("standard deduction cannot push salary income below zero", () => {
    const result = computeTaxableIncomePhase1({
      regime: "old",
      isSalaried: true,
      grossSalary: 30_000,
      otherSourcesIncome: 0,
    });
    expect(result.salaryIncomeAfterStandardDeduction).toBe(0);
    expect(result.taxableIncome).toBe(0);
  });

  it("combines salary and other-sources income", () => {
    const result = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 1_200_000,
      otherSourcesIncome: 50_000,
    });
    expect(result.grossTotalIncome).toBe(1_200_000 - 75_000 + 50_000);
  });

  it("negative other-sources income is clamped to zero, not allowed to reduce taxable income", () => {
    const result = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: true,
      grossSalary: 1_000_000,
      otherSourcesIncome: -5_000,
    });
    expect(result.otherSourcesIncome).toBe(0);
  });

  it("Section 288A rounding: taxable income rounds to nearest 10", () => {
    const roundsDown = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: false,
      grossSalary: 0,
      otherSourcesIncome: 800_004,
    });
    expect(roundsDown.taxableIncome).toBe(800_000);

    const roundsUp = computeTaxableIncomePhase1({
      regime: "new",
      isSalaried: false,
      grossSalary: 0,
      otherSourcesIncome: 800_005,
    });
    expect(roundsUp.taxableIncome).toBe(800_010);
  });
});
