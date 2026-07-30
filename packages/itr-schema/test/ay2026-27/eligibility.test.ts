import { describe, expect, it } from "vitest";
import { ITR1_TOTAL_INCOME_LIMIT, isEligibleForItr1 } from "../../src/ay2026-27/eligibility.js";
import { buildItrExportInput, EMPTY_FULL_INCOME_INPUT } from "../fixtures.js";

describe("isEligibleForItr1 — AY 2026-27 rules (sourced 2026-07-30, see file header)", () => {
  it("is eligible: simple salary-only profile, well under the limit", () => {
    const input = buildItrExportInput({
      fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 1_000_000 },
      regime: "new",
      age: 30,
    });
    const result = isEligibleForItr1(input);
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  describe("total income ₹50,00,000 boundary", () => {
    it("is eligible exactly at the ₹50,00,000 limit", () => {
      // New regime: gross salary chosen so total income lands exactly at the limit after standard deduction.
      const input = buildItrExportInput({
        fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: ITR1_TOTAL_INCOME_LIMIT + 75_000 },
        regime: "new",
        age: 30,
      });
      expect(input.computation.income.totalIncome).toBe(ITR1_TOTAL_INCOME_LIMIT);
      expect(isEligibleForItr1(input).eligible).toBe(true);
    });

    it("is ineligible ₹10 above the ₹50,00,000 limit (smallest increment that survives Section 288A's nearest-₹10 rounding)", () => {
      const input = buildItrExportInput({
        fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: ITR1_TOTAL_INCOME_LIMIT + 75_010 },
        regime: "new",
        age: 30,
      });
      expect(input.computation.income.totalIncome).toBe(ITR1_TOTAL_INCOME_LIMIT + 10);
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("50,00,000"))).toBe(true);
    });
  });

  describe("house property count boundary", () => {
    const houseProperty = { type: "selfOccupied" as const, homeLoanInterestPaid: 0 };

    it("is eligible with exactly two house properties (the AY 2026-27 limit)", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          houseProperties: [houseProperty, houseProperty],
        },
        regime: "new",
        age: 30,
      });
      expect(isEligibleForItr1(input).eligible).toBe(true);
    });

    it("is ineligible with three house properties", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          houseProperties: [houseProperty, houseProperty, houseProperty],
        },
        regime: "new",
        age: 30,
      });
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("house properties"))).toBe(true);
    });
  });

  describe("capital gains", () => {
    it("is ineligible with any short-term equity capital gain", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 10_000, holdingPeriodMonths: 3 }],
        },
        regime: "new",
        age: 30,
      });
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("Section 111A"))).toBe(true);
    });

    it("is ineligible with any long-term non-equity capital gain", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          capitalGainTransactions: [{ assetType: "gold", gainAmount: 10_000, holdingPeriodMonths: 30 }],
        },
        regime: "new",
        age: 30,
      });
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("Section 112)"))).toBe(true);
    });

    it("is eligible with LTCG-equity (112A) exactly AT the ₹1,25,000 exemption (zero taxable gain)", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 125_000, holdingPeriodMonths: 24 }],
        },
        regime: "new",
        age: 30,
      });
      expect(input.computation.income.capitalGains.ltcgEquityTaxableGain).toBe(0);
      expect(isEligibleForItr1(input).eligible).toBe(true);
    });

    it("is ineligible with LTCG-equity (112A) one rupee above the ₹1,25,000 exemption", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 125_001, holdingPeriodMonths: 24 }],
        },
        regime: "new",
        age: 30,
      });
      expect(input.computation.income.capitalGains.ltcgEquityTaxableGain).toBe(1);
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("112A"))).toBe(true);
    });

    it("is ineligible with a capital loss present, even if it doesn't reduce the taxable total below zero", () => {
      const input = buildItrExportInput({
        fullIncomeInput: {
          ...EMPTY_FULL_INCOME_INPUT,
          grossSalaryIncludingHra: 1_000_000,
          capitalGainTransactions: [{ assetType: "gold", gainAmount: -5_000, holdingPeriodMonths: 30 }],
        },
        regime: "new",
        age: 30,
      });
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("capital-loss"))).toBe(true);
    });
  });

  describe("other-source income", () => {
    it("is ineligible with any lottery/game-winnings income", () => {
      const input = buildItrExportInput({
        fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 1_000_000, otherSourcesIncome: 10_000 },
        regime: "new",
        age: 30,
        otherSourceIncomes: [{ sourceType: "LOTTERY_OR_GAME_WINNINGS", amount: 10_000 }],
      });
      const result = isEligibleForItr1(input);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes("115BB"))).toBe(true);
    });

    it("is eligible with ordinary interest/dividend other-source income", () => {
      const input = buildItrExportInput({
        fullIncomeInput: { ...EMPTY_FULL_INCOME_INPUT, grossSalaryIncludingHra: 1_000_000, otherSourcesIncome: 20_000 },
        regime: "new",
        age: 30,
        otherSourceIncomes: [
          { sourceType: "SAVINGS_INTEREST", amount: 15_000 },
          { sourceType: "DIVIDEND", amount: 5_000 },
        ],
      });
      expect(isEligibleForItr1(input).eligible).toBe(true);
    });
  });

  it("collects multiple simultaneous disqualifying reasons, not just the first one found", () => {
    const houseProperty = { type: "selfOccupied" as const, homeLoanInterestPaid: 0 };
    const input = buildItrExportInput({
      fullIncomeInput: {
        ...EMPTY_FULL_INCOME_INPUT,
        grossSalaryIncludingHra: ITR1_TOTAL_INCOME_LIMIT + 10_000_000,
        houseProperties: [houseProperty, houseProperty, houseProperty],
        capitalGainTransactions: [{ assetType: "listedEquityOrEquityMF", gainAmount: 10_000, holdingPeriodMonths: 3 }],
      },
      regime: "new",
      age: 30,
    });
    const result = isEligibleForItr1(input);
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
