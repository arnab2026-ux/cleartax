import { describe, expect, it } from "vitest";
import {
  HOUSE_PROPERTY_LOSS_SETOFF_CAP_OLD_REGIME,
  SELF_OCCUPIED_INTEREST_CAP_OLD_REGIME,
  aggregateHousePropertyIncome,
  housePropertyContributionToGrossTotalIncome,
} from "../src/ay2026-27/houseProperty.js";

describe("self-occupied property", () => {
  it("old regime: interest deduction capped at 2,00,000", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "selfOccupied", homeLoanInterestPaid: 250_000 }],
      "old",
    );
    expect(SELF_OCCUPIED_INTEREST_CAP_OLD_REGIME).toBe(200_000);
    expect(result.properties[0]?.interestDeductionAllowed).toBe(200_000);
    expect(result.totalHousePropertyIncome).toBe(-200_000);
  });

  it("old regime: interest below cap is allowed in full", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "selfOccupied", homeLoanInterestPaid: 150_000 }],
      "old",
    );
    expect(result.properties[0]?.interestDeductionAllowed).toBe(150_000);
    expect(result.totalHousePropertyIncome).toBe(-150_000);
  });

  it("boundary: interest exactly at 2,00,000 cap is not reduced", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "selfOccupied", homeLoanInterestPaid: 200_000 }],
      "old",
    );
    expect(result.properties[0]?.interestDeductionAllowed).toBe(200_000);
  });

  it("new regime: self-occupied interest deduction is disallowed entirely", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "selfOccupied", homeLoanInterestPaid: 250_000 }],
      "new",
    );
    expect(result.properties[0]?.interestDeductionAllowed).toBe(0);
    expect(result.totalHousePropertyIncome).toBe(0);
  });
});

describe("let-out property", () => {
  it("computes NAV, 30% standard deduction, and uncapped interest — old regime", () => {
    const result = aggregateHousePropertyIncome(
      [
        {
          type: "letOut",
          annualRentReceived: 600_000,
          municipalTaxesPaid: 20_000,
          homeLoanInterestPaid: 500_000,
        },
      ],
      "old",
    );
    const p = result.properties[0];
    // NAV = 600,000 - 20,000 = 580,000; std ded = 30% * 580,000 = 174,000
    // income = 580,000 - 174,000 - 500,000 = -94,000 (a loss, despite uncapped interest)
    expect(p?.netAnnualValue).toBe(580_000);
    expect(p?.standardDeduction30Percent).toBe(174_000);
    expect(p?.interestDeductionAllowed).toBe(500_000);
    expect(p?.incomeOrLoss).toBe(-94_000);
  });

  it("new regime: let-out interest deduction is uncapped too (restriction is self-occupied-only)", () => {
    const result = aggregateHousePropertyIncome(
      [
        {
          type: "letOut",
          annualRentReceived: 600_000,
          municipalTaxesPaid: 20_000,
          homeLoanInterestPaid: 500_000,
        },
      ],
      "new",
    );
    expect(result.properties[0]?.interestDeductionAllowed).toBe(500_000);
    expect(result.totalHousePropertyIncome).toBe(-94_000);
  });

  it("positive income when rent comfortably exceeds deductions", () => {
    const result = aggregateHousePropertyIncome(
      [
        {
          type: "letOut",
          annualRentReceived: 400_000,
          municipalTaxesPaid: 10_000,
          homeLoanInterestPaid: 50_000,
        },
      ],
      "old",
    );
    // NAV = 390,000; std ded = 117,000; income = 390,000 - 117,000 - 50,000 = 223,000
    expect(result.properties[0]?.incomeOrLoss).toBe(223_000);
    expect(result.totalHousePropertyIncome).toBe(223_000);
  });
});

describe("loss set-off against other heads — Section 71(3A)", () => {
  it("old regime: loss set off capped at 2,00,000, excess carried forward", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "selfOccupied", homeLoanInterestPaid: 200_000 }, { type: "letOut", annualRentReceived: 0, municipalTaxesPaid: 0, homeLoanInterestPaid: 150_000 }],
      "old",
    );
    // self-occupied loss = -200,000; let-out loss = -150,000; total = -350,000
    expect(HOUSE_PROPERTY_LOSS_SETOFF_CAP_OLD_REGIME).toBe(200_000);
    expect(result.totalHousePropertyIncome).toBe(-350_000);
    expect(result.lossSetOffAgainstOtherHeads).toBe(200_000);
    expect(result.lossCarriedForward).toBe(150_000);
    expect(housePropertyContributionToGrossTotalIncome(result)).toBe(-200_000);
  });

  it("old regime: loss under the cap is set off in full, nothing carried forward", () => {
    const result = aggregateHousePropertyIncome([{ type: "selfOccupied", homeLoanInterestPaid: 120_000 }], "old");
    expect(result.lossSetOffAgainstOtherHeads).toBe(120_000);
    expect(result.lossCarriedForward).toBe(0);
  });

  it("new regime: house-property loss cannot be set off against other heads at all (cap = 0)", () => {
    const result = aggregateHousePropertyIncome(
      [{ type: "letOut", annualRentReceived: 100_000, municipalTaxesPaid: 0, homeLoanInterestPaid: 500_000 }],
      "new",
    );
    // NAV = 100,000; std ded = 30,000; interest 500,000 (uncapped even in new regime for let-out)
    // income = 100,000 - 30,000 - 500,000 = -430,000
    expect(result.totalHousePropertyIncome).toBe(-430_000);
    expect(result.lossSetOffAgainstOtherHeads).toBe(0);
    expect(result.lossCarriedForward).toBe(430_000);
    expect(housePropertyContributionToGrossTotalIncome(result)).toBe(0);
  });

  it("no properties: zero contribution, no crash", () => {
    const result = aggregateHousePropertyIncome([], "old");
    expect(result.totalHousePropertyIncome).toBe(0);
    expect(housePropertyContributionToGrossTotalIncome(result)).toBe(0);
  });

  it("intra-head netting: a let-out loss and a let-out gain net before the inter-head cap applies", () => {
    const result = aggregateHousePropertyIncome(
      [
        { type: "letOut", annualRentReceived: 1_000_000, municipalTaxesPaid: 0, homeLoanInterestPaid: 0 }, // income: NAV 1,000,000 - 30% = 700,000
        { type: "selfOccupied", homeLoanInterestPaid: 200_000 }, // loss -200,000 (old regime cap)
      ],
      "old",
    );
    expect(result.totalHousePropertyIncome).toBe(500_000);
    expect(result.lossSetOffAgainstOtherHeads).toBe(0); // net is positive, no loss to set off
    expect(housePropertyContributionToGrossTotalIncome(result)).toBe(500_000);
  });
});
