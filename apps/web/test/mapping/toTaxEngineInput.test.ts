import { compareRegimes, computeFullTaxLiability } from "@cleartax/tax-engine";
import { describe, expect, it } from "vitest";
import {
  buildDeductionsInput,
  buildFullIncomeInput,
  buildHraInput,
  decimalToNumber,
  interestIncomeForTtaOrTtb,
  reconstructSection80CCD2,
  reconstructSection80D,
  sumBasicSalary,
  sumGrossSalary,
  sumOtherSourcesIncome,
  sumSectionAmount,
  toCapitalGainTransactionInput,
  toHousePropertyInput,
  type CapitalGainAssetRow,
  type DeductionRow,
  type HousePropertyRow,
  type OtherSourceIncomeRow,
  type SalaryIncomeRow,
} from "../../lib/mapping/toTaxEngineInput";

describe("decimalToNumber", () => {
  it("passes through a plain number unchanged", () => {
    expect(decimalToNumber(1234.56)).toBe(1234.56);
  });

  it("returns 0 for null/undefined", () => {
    expect(decimalToNumber(null)).toBe(0);
    expect(decimalToNumber(undefined)).toBe(0);
  });

  it("converts a Decimal-like object via Number()", () => {
    // Minimal stand-in for Prisma.Decimal — real Decimal instances stringify
    // via toString()/valueOf(), which Number() uses.
    const decimalLike = { toString: () => "1500000.50", valueOf: () => "1500000.50" };
    expect(decimalToNumber(decimalLike as unknown as number)).toBe(1500000.5);
  });
});

describe("buildHraInput", () => {
  it("returns undefined when there's no salary income at all", () => {
    expect(buildHraInput([])).toBeUndefined();
  });

  it("sums basicSalary/hraReceived/rentPaid across multiple employers (job-switch scenario)", () => {
    const rows: SalaryIncomeRow[] = [
      { grossSalary: 900_000, basicSalary: 400_000, hraReceived: 150_000, rentPaid: 120_000, isMetroCity: false },
      { grossSalary: 900_000, basicSalary: 500_000, hraReceived: 210_000, rentPaid: 180_000, isMetroCity: true },
    ];
    const hra = buildHraInput(rows);
    expect(hra).toEqual({ basicSalary: 900_000, hraReceived: 360_000, rentPaid: 300_000, isMetro: true });
  });

  it("isMetro is true if ANY employer row is flagged metro", () => {
    const rows: SalaryIncomeRow[] = [
      { grossSalary: 100, basicSalary: 100, hraReceived: 0, rentPaid: 0, isMetroCity: false },
      { grossSalary: 100, basicSalary: 100, hraReceived: 0, rentPaid: 0, isMetroCity: true },
    ];
    expect(buildHraInput(rows)?.isMetro).toBe(true);
  });

  it("isMetro is false if no employer row is flagged metro", () => {
    const rows: SalaryIncomeRow[] = [{ grossSalary: 100, basicSalary: 100, hraReceived: 0, rentPaid: 0, isMetroCity: false }];
    expect(buildHraInput(rows)?.isMetro).toBe(false);
  });
});

describe("sumGrossSalary / sumBasicSalary", () => {
  it("sums across rows", () => {
    const rows: SalaryIncomeRow[] = [
      { grossSalary: 900_000, basicSalary: 400_000, hraReceived: 0, rentPaid: 0, isMetroCity: false },
      { grossSalary: 600_000, basicSalary: 300_000, hraReceived: 0, rentPaid: 0, isMetroCity: false },
    ];
    expect(sumGrossSalary(rows)).toBe(1_500_000);
    expect(sumBasicSalary(rows)).toBe(700_000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumGrossSalary([])).toBe(0);
  });
});

describe("toHousePropertyInput", () => {
  it("maps a self-occupied property, ignoring rent/tax fields", () => {
    const row: HousePropertyRow = {
      propertyType: "SELF_OCCUPIED",
      annualLetableValue: 999_999, // should be ignored per the schema's own doc comment
      municipalTaxesPaid: 999,
      homeLoanInterest: 180_000,
    };
    expect(toHousePropertyInput(row)).toEqual({ type: "selfOccupied", homeLoanInterestPaid: 180_000 });
  });

  it("maps a let-out property with all three figures", () => {
    const row: HousePropertyRow = {
      propertyType: "LET_OUT",
      annualLetableValue: 240_000,
      municipalTaxesPaid: 12_000,
      homeLoanInterest: 300_000,
    };
    expect(toHousePropertyInput(row)).toEqual({
      type: "letOut",
      annualRentReceived: 240_000,
      municipalTaxesPaid: 12_000,
      homeLoanInterestPaid: 300_000,
    });
  });
});

describe("toCapitalGainTransactionInput", () => {
  it("derives gainAmount from saleValue - acquisitionCost - expenses", () => {
    const row: CapitalGainAssetRow = {
      assetType: "LISTED_EQUITY_OR_EQUITY_MF",
      acquisitionDate: new Date("2020-01-01T00:00:00Z"),
      saleDate: new Date("2024-06-01T00:00:00Z"),
      acquisitionCost: 200_000,
      saleValue: 350_000,
      expenses: 500,
      acquiredBeforeRegimeChange: false,
      indexedGainAmount: null,
    };
    const input = toCapitalGainTransactionInput(row);
    expect(input.gainAmount).toBe(149_500);
    expect(input.assetType).toBe("listedEquityOrEquityMF");
    expect(input.holdingPeriodMonths).toBeGreaterThan(12);
    expect(input.indexedGainAmount).toBeUndefined();
  });

  it("derives a negative gainAmount for a loss", () => {
    const row: CapitalGainAssetRow = {
      assetType: "UNLISTED_SHARES",
      acquisitionDate: new Date("2023-01-01T00:00:00Z"),
      saleDate: new Date("2023-06-01T00:00:00Z"),
      acquisitionCost: 100_000,
      saleValue: 40_000,
      expenses: 0,
      acquiredBeforeRegimeChange: false,
      indexedGainAmount: null,
    };
    expect(toCapitalGainTransactionInput(row).gainAmount).toBe(-60_000);
  });

  it("maps every CapitalAssetType exhaustively", () => {
    const types = ["LISTED_EQUITY_OR_EQUITY_MF", "UNLISTED_SHARES", "DEBT_MUTUAL_FUND", "IMMOVABLE_PROPERTY", "GOLD", "OTHER_ASSET"] as const;
    const expected = ["listedEquityOrEquityMF", "unlistedShares", "debtMutualFund", "immovableProperty", "gold", "otherAsset"];
    types.forEach((t, i) => {
      const row: CapitalGainAssetRow = {
        assetType: t,
        acquisitionDate: new Date("2020-01-01T00:00:00Z"),
        saleDate: new Date("2021-01-01T00:00:00Z"),
        acquisitionCost: 0,
        saleValue: 0,
        expenses: 0,
        acquiredBeforeRegimeChange: false,
        indexedGainAmount: null,
      };
      expect(toCapitalGainTransactionInput(row).assetType).toBe(expected[i]);
    });
  });

  it("passes through indexedGainAmount and acquiredBeforeRegimeChange for the grandfathering option", () => {
    const row: CapitalGainAssetRow = {
      assetType: "IMMOVABLE_PROPERTY",
      acquisitionDate: new Date("2020-01-01T00:00:00Z"),
      saleDate: new Date("2025-01-01T00:00:00Z"),
      acquisitionCost: 1_500_000,
      saleValue: 6_000_000,
      expenses: 100_000,
      acquiredBeforeRegimeChange: true,
      indexedGainAmount: 3_800_000,
    };
    const input = toCapitalGainTransactionInput(row);
    expect(input.acquiredBeforeRegimeChange).toBe(true);
    expect(input.indexedGainAmount).toBe(3_800_000);
    expect(input.gainAmount).toBe(4_400_000);
  });
});

describe("sumOtherSourcesIncome", () => {
  it("sums across every source type", () => {
    const rows: OtherSourceIncomeRow[] = [
      { sourceType: "SAVINGS_INTEREST", amount: 8_000 },
      { sourceType: "DIVIDEND", amount: 12_000 },
      { sourceType: "FAMILY_PENSION", amount: 60_000 },
    ];
    expect(sumOtherSourcesIncome(rows)).toBe(80_000);
  });
});

describe("interestIncomeForTtaOrTtb", () => {
  const rows: OtherSourceIncomeRow[] = [
    { sourceType: "SAVINGS_INTEREST", amount: 5_000 },
    { sourceType: "FIXED_DEPOSIT_INTEREST", amount: 30_000 },
    { sourceType: "RECURRING_DEPOSIT_INTEREST", amount: 10_000 },
    { sourceType: "DIVIDEND", amount: 20_000 }, // never eligible for either
  ];

  it("below 60: only SAVINGS_INTEREST counts (Section 80TTA)", () => {
    expect(interestIncomeForTtaOrTtb(rows, "below60")).toBe(5_000);
  });

  it("60+: all bank/post-office interest types count (Section 80TTB)", () => {
    expect(interestIncomeForTtaOrTtb(rows, "senior")).toBe(45_000);
    expect(interestIncomeForTtaOrTtb(rows, "superSenior")).toBe(45_000);
  });

  it("returns 0 when there's no interest income at all", () => {
    expect(interestIncomeForTtaOrTtb([{ sourceType: "DIVIDEND", amount: 20_000 }], "below60")).toBe(0);
  });
});

describe("reconstructSection80D", () => {
  it("splits self-family / parents / preventive-checkup amounts by metaJson.bucket", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80D", amount: 20_000, metaJson: { bucket: "selfFamily", isSenior: false } },
      { section: "SECTION_80D", amount: 30_000, metaJson: { bucket: "parents", isSenior: true } },
      { section: "SECTION_80D", amount: 4_000, metaJson: { bucket: "preventiveCheckup" } },
    ];
    expect(reconstructSection80D(rows)).toEqual({
      selfAndFamilyPremium: 20_000,
      selfOrFamilyHasSenior: false,
      parentsPremium: 30_000,
      parentsHaveSenior: true,
      preventiveHealthCheckup: 4_000,
    });
  });

  it("ignores rows from other sections", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80C", amount: 150_000, metaJson: null },
      { section: "SECTION_80D", amount: 10_000, metaJson: { bucket: "selfFamily" } },
    ];
    expect(reconstructSection80D(rows).selfAndFamilyPremium).toBe(10_000);
  });

  it("fails safe (contributes 0) for a row with missing/malformed metaJson, rather than guessing a bucket", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80D", amount: 10_000, metaJson: null },
      { section: "SECTION_80D", amount: 20_000, metaJson: { bucket: "not-a-real-bucket" } },
      { section: "SECTION_80D", amount: 5_000, metaJson: "not-even-an-object" },
    ];
    expect(reconstructSection80D(rows)).toEqual({
      selfAndFamilyPremium: 0,
      selfOrFamilyHasSenior: false,
      parentsPremium: 0,
      parentsHaveSenior: false,
      preventiveHealthCheckup: 0,
    });
  });

  it("defaults isSenior to false when omitted from metaJson", () => {
    const rows: DeductionRow[] = [{ section: "SECTION_80D", amount: 10_000, metaJson: { bucket: "selfFamily" } }];
    expect(reconstructSection80D(rows).selfOrFamilyHasSenior).toBe(false);
  });

  it("sums multiple rows in the same bucket", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80D", amount: 10_000, metaJson: { bucket: "selfFamily" } },
      { section: "SECTION_80D", amount: 5_000, metaJson: { bucket: "selfFamily" } },
    ];
    expect(reconstructSection80D(rows).selfAndFamilyPremium).toBe(15_000);
  });
});

describe("reconstructSection80CCD2", () => {
  it("reads employmentType from metaJson and passes through the basic-salary base", () => {
    const rows: DeductionRow[] = [{ section: "SECTION_80CCD_2", amount: 90_000, metaJson: { employmentType: "government" } }];
    expect(reconstructSection80CCD2(rows, 900_000)).toEqual({ employerContribution: 90_000, salary: 900_000, employmentType: "government" });
  });

  it("defaults employmentType to 'other' when there are no 80CCD(2) rows", () => {
    expect(reconstructSection80CCD2([], 900_000)).toEqual({ employerContribution: 0, salary: 900_000, employmentType: "other" });
  });

  it("defaults employmentType to 'other' for malformed metaJson", () => {
    const rows: DeductionRow[] = [{ section: "SECTION_80CCD_2", amount: 50_000, metaJson: { employmentType: "freelance" } }];
    expect(reconstructSection80CCD2(rows, 500_000).employmentType).toBe("other");
  });

  it("sums contributions across multiple rows", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80CCD_2", amount: 40_000, metaJson: { employmentType: "other" } },
      { section: "SECTION_80CCD_2", amount: 10_000, metaJson: { employmentType: "other" } },
    ];
    expect(reconstructSection80CCD2(rows, 500_000).employerContribution).toBe(50_000);
  });
});

describe("sumSectionAmount", () => {
  it("sums only rows matching the given section", () => {
    const rows: DeductionRow[] = [
      { section: "SECTION_80C", amount: 100_000, metaJson: null },
      { section: "SECTION_80C", amount: 50_000, metaJson: null },
      { section: "SECTION_80CCD_1B", amount: 50_000, metaJson: null },
    ];
    expect(sumSectionAmount(rows, "SECTION_80C")).toBe(150_000);
    expect(sumSectionAmount(rows, "SECTION_80CCD_1B")).toBe(50_000);
  });
});

describe("buildDeductionsInput", () => {
  it("assembles every section from the right rows", () => {
    const deductionRows: DeductionRow[] = [
      { section: "SECTION_80C", amount: 150_000, metaJson: null },
      { section: "SECTION_80CCD_1B", amount: 50_000, metaJson: null },
      { section: "SECTION_80D", amount: 20_000, metaJson: { bucket: "selfFamily" } },
      { section: "SECTION_80CCD_2", amount: 60_000, metaJson: { employmentType: "other" } },
    ];
    const otherSourceRows: OtherSourceIncomeRow[] = [{ sourceType: "SAVINGS_INTEREST", amount: 6_000 }];

    const result = buildDeductionsInput(deductionRows, otherSourceRows, 900_000, "below60");
    expect(result.section80C).toBe(150_000);
    expect(result.section80CCD1B).toBe(50_000);
    expect(result.section80D.selfAndFamilyPremium).toBe(20_000);
    expect(result.section80CCD2).toEqual({ employerContribution: 60_000, salary: 900_000, employmentType: "other" });
    expect(result.interestIncomeForTtaOrTtb).toBe(6_000);
  });
});

describe("buildFullIncomeInput (end to end)", () => {
  it("assembles a complete FullIncomeInput from a realistic multi-employer, multi-asset profile", () => {
    const params = {
      salaryIncomes: [
        { grossSalary: 900_000, basicSalary: 400_000, hraReceived: 150_000, rentPaid: 120_000, isMetroCity: false },
        { grossSalary: 900_000, basicSalary: 500_000, hraReceived: 210_000, rentPaid: 180_000, isMetroCity: true },
      ] satisfies SalaryIncomeRow[],
      houseProperties: [
        { propertyType: "SELF_OCCUPIED", annualLetableValue: 0, municipalTaxesPaid: 0, homeLoanInterest: 180_000 },
      ] satisfies HousePropertyRow[],
      capitalGainAssets: [
        {
          assetType: "LISTED_EQUITY_OR_EQUITY_MF",
          acquisitionDate: new Date("2020-01-01T00:00:00Z"),
          saleDate: new Date("2024-06-01T00:00:00Z"),
          acquisitionCost: 200_000,
          saleValue: 350_000,
          expenses: 500,
          acquiredBeforeRegimeChange: false,
          indexedGainAmount: null,
        },
      ] satisfies CapitalGainAssetRow[],
      otherSourceIncomes: [{ sourceType: "SAVINGS_INTEREST", amount: 8_000 }] satisfies OtherSourceIncomeRow[],
      deductions: [
        { section: "SECTION_80C", amount: 150_000, metaJson: null },
        { section: "SECTION_80D", amount: 20_000, metaJson: { bucket: "selfFamily" } },
      ] satisfies DeductionRow[],
      age: 45,
    };

    const input = buildFullIncomeInput(params);
    expect(input.isSalaried).toBe(true);
    expect(input.grossSalaryIncludingHra).toBe(1_800_000);
    expect(input.hra).toEqual({ basicSalary: 900_000, hraReceived: 360_000, rentPaid: 300_000, isMetro: true });
    expect(input.houseProperties).toHaveLength(1);
    expect(input.capitalGainTransactions).toHaveLength(1);
    expect(input.otherSourcesIncome).toBe(8_000);
    expect(input.deductions?.section80C).toBe(150_000);

    // Sanity: the assembled input should feed cleanly into the real engine
    // without throwing, and produce a plausible (positive) tax liability.
    const result = computeFullTaxLiability(input, "old", 45);
    expect(result.totalTaxLiabilityRounded).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalTaxLiabilityRounded)).toBe(true);

    const comparison = compareRegimes(input, 45);
    expect(["old", "new"]).toContain(comparison.recommendedRegime);
  });

  it("produces isSalaried: false and hra: undefined when there's no salary income", () => {
    const input = buildFullIncomeInput({
      salaryIncomes: [],
      houseProperties: [],
      capitalGainAssets: [],
      otherSourceIncomes: [],
      deductions: [],
      age: 30,
    });
    expect(input.isSalaried).toBe(false);
    expect(input.hra).toBeUndefined();
    expect(input.grossSalaryIncludingHra).toBe(0);
  });

  it("a senior citizen's interest income correctly routes through 80TTB inside the assembled deductions", () => {
    const input = buildFullIncomeInput({
      salaryIncomes: [],
      houseProperties: [],
      capitalGainAssets: [],
      otherSourceIncomes: [
        { sourceType: "SAVINGS_INTEREST", amount: 5_000 },
        { sourceType: "FIXED_DEPOSIT_INTEREST", amount: 40_000 },
      ],
      deductions: [],
      age: 65,
    });
    expect(input.deductions?.interestIncomeForTtaOrTtb).toBe(45_000);

    const result = computeFullTaxLiability(input, "old", 65);
    expect(result.income.deductions.section80TTB).toBe(45_000);
    expect(result.income.deductions.section80TTA).toBe(0);
  });
});
