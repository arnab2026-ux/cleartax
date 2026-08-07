/**
 * Phase 11 — the `apps/web` mapping layer for foreign assets and foreign
 * income, plus the Schedule FA calendar-year period helper. Pure-logic only
 * (no Prisma client), matching the design of every other file in
 * `test/mapping/`; the end-to-end assemblies feed the REAL
 * `computeFullTaxLiability`, never a hand-built fixture.
 */
import { computeFullTaxLiability } from "@cleartax/tax-engine";
import { describe, expect, it } from "vitest";
import {
  buildFullIncomeInput,
  toForeignSourceIncomeInput,
  type ForeignSourceIncomeRow,
} from "../../lib/mapping/toTaxEngineInput";
import { toItrForeignAssetInput, type ForeignAssetRowForItr } from "../../lib/mapping/toItrSchemaInput";
import { mapFullTaxLiabilityToTaxComputation } from "../../lib/mapping/taxComputationMapping";
import {
  FOREIGN_ASSET_OWNERSHIP_TO_ITR,
  FOREIGN_ASSET_TYPE_TO_ITR,
  FOREIGN_INCOME_HEAD_TO_ENGINE,
  FOREIGN_INCOME_NATURE_TO_ITR,
  FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE,
  RESIDENTIAL_STATUS_TO_ITR,
} from "../../lib/mapping/enumMaps";
import { foreignAssetReportingPeriod, isWithinForeignAssetPeriod } from "../../lib/foreignAssetPeriod";

const US_DIVIDEND_ROW: ForeignSourceIncomeRow = {
  countryCode: "2",
  countryName: "UNITED STATES OF AMERICA",
  taxIdentificationNumber: "123-45-6789",
  head: "OTHER_SOURCES",
  incomeAmount: 100_000,
  foreignTaxPaid: 25_000,
  dtaaRateCapPercent: 25,
  reliefSection: "SECTION_90",
  alreadyIncludedInIndianIncome: false,
};

const RSU_SHARES_ROW: ForeignAssetRowForItr = {
  assetType: "A3_FOREIGN_EQUITY_DEBT_INTEREST",
  countryCode: "2",
  countryName: "UNITED STATES OF AMERICA",
  entityName: "Acme Global Inc.",
  entityAddress: "1 Acme Way, Sunnyvale, CA",
  zipCode: "94085",
  natureOfEntity: "Company",
  accountNumber: null,
  ownership: "OWNER",
  acquisitionDate: new Date(Date.UTC(2023, 1, 15)),
  initialValue: 1_800_000,
  peakValue: 3_300_000,
  closingValue: 2_900_000,
  incomeAccrued: 48_000,
  incomeNature: "DIVIDEND",
  grossProceeds: 620_000,
  incomeTaxableInIndia: 0,
};

function emptyIncomeParams() {
  return {
    salaryIncomes: [{ grossSalary: 2_000_000, basicSalary: 1_000_000, hraReceived: 0, rentPaid: 0, isMetroCity: false }],
    houseProperties: [],
    capitalGainAssets: [],
    otherSourceIncomes: [],
    deductions: [],
    age: 30,
  };
}

// ---------------------------------------------------------------------------

describe("foreignAssetReportingPeriod — the calendar-year trap", () => {
  it("AY 2026-27 reports CALENDAR 2025, not FY 2025-26", () => {
    const period = foreignAssetReportingPeriod("2026-27");
    expect(period.calendarYear).toBe(2025);
    expect(period.start.toISOString().slice(0, 10)).toBe("2025-01-01");
    expect(period.end.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(period.label).toBe("1 January 2025 to 31 December 2025");
    // Explicitly NOT the financial year every other schedule uses.
    expect(period.start.toISOString().slice(0, 10)).not.toBe("2025-04-01");
    expect(period.end.toISOString().slice(0, 10)).not.toBe("2026-03-31");
  });

  it("matches the Income Tax Department's own worked example for AY 2025-26", () => {
    // "For Assessment Year 2025-26, the calendar year ending on December 31st
    // comprises the period from January 1, 2024, to December 31, 2024."
    const period = foreignAssetReportingPeriod("2025-26");
    expect(period.start.toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(period.end.toISOString().slice(0, 10)).toBe("2024-12-31");
  });

  it.each(["2027-28", "2030-31"])("stays one year behind the AY start for %s", (ay) => {
    expect(foreignAssetReportingPeriod(ay).calendarYear).toBe(Number(ay.slice(0, 4)) - 1);
  });

  it("throws on a malformed assessment year instead of producing a NaN period", () => {
    for (const bad of ["2026", "26-27", "2026-2027", "", "AY2026-27"]) {
      expect(() => foreignAssetReportingPeriod(bad)).toThrow(/Malformed assessment year/);
    }
  });

  describe("isWithinForeignAssetPeriod boundaries", () => {
    const cases: Array<[string, boolean]> = [
      ["2024-12-31", false],
      ["2025-01-01", true],
      ["2025-06-30", true],
      ["2025-12-31", true],
      ["2026-01-01", false],
    ];
    it.each(cases)("%s -> %s", (date, expected) => {
      expect(isWithinForeignAssetPeriod(new Date(`${date}T00:00:00.000Z`), "2026-27")).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------

describe("enum maps are exhaustive and correct", () => {
  it("maps every Schedule FA table to its letter", () => {
    expect(FOREIGN_ASSET_TYPE_TO_ITR["A3_FOREIGN_EQUITY_DEBT_INTEREST"]).toBe("A3");
    expect(FOREIGN_ASSET_TYPE_TO_ITR["A2_FOREIGN_CUSTODIAL_ACCOUNT"]).toBe("A2");
    expect(FOREIGN_ASSET_TYPE_TO_ITR["A1_FOREIGN_DEPOSITORY_ACCOUNT"]).toBe("A1");
    expect(Object.keys(FOREIGN_ASSET_TYPE_TO_ITR)).toHaveLength(10);
    expect(new Set(Object.values(FOREIGN_ASSET_TYPE_TO_ITR)).size).toBe(10);
  });

  it("preserves the government's own BENIFICIARY spelling", () => {
    expect(FOREIGN_ASSET_OWNERSHIP_TO_ITR["BENIFICIARY"]).toBe("BENIFICIARY");
  });

  it("maps heads and relief sections to the engine's unions", () => {
    expect(FOREIGN_INCOME_HEAD_TO_ENGINE["OTHER_SOURCES"]).toBe("otherSources");
    expect(FOREIGN_INCOME_HEAD_TO_ENGINE["CAPITAL_GAINS"]).toBe("capitalGains");
    expect(FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE["SECTION_90"]).toBe("90");
    expect(FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE["SECTION_90A"]).toBe("90A");
    expect(FOREIGN_TAX_RELIEF_SECTION_TO_ENGINE["SECTION_91"]).toBe("91");
    expect(FOREIGN_INCOME_NATURE_TO_ITR["SALE_PROCEEDS"]).toBe("SALE_PROCEEDS");
    expect(RESIDENTIAL_STATUS_TO_ITR["RNOR"]).toBe("RNOR");
  });
});

// ---------------------------------------------------------------------------

describe("toForeignSourceIncomeInput", () => {
  it("maps a US dividend row field for field", () => {
    expect(toForeignSourceIncomeInput(US_DIVIDEND_ROW)).toEqual({
      countryCode: "2",
      countryName: "UNITED STATES OF AMERICA",
      taxIdentificationNumber: "123-45-6789",
      head: "otherSources",
      incomeInr: 100_000,
      foreignTaxPaidInr: 25_000,
      dtaaRateCapPercent: 25,
      reliefSection: "90",
      alreadyIncludedInIndianIncome: false,
    });
  });

  it("turns a NULL treaty cap into undefined, NOT 0", () => {
    // 0 would mean "the treaty caps that country's tax at 0%", which would
    // silently destroy the entire credit. null means "no treaty cap".
    const mapped = toForeignSourceIncomeInput({ ...US_DIVIDEND_ROW, dtaaRateCapPercent: null });
    expect(mapped.dtaaRateCapPercent).toBeUndefined();
    expect(mapped.dtaaRateCapPercent).not.toBe(0);
  });

  it("keeps an explicit 0% treaty cap as 0 (a real, if unusual, treaty term)", () => {
    expect(toForeignSourceIncomeInput({ ...US_DIVIDEND_ROW, dtaaRateCapPercent: 0 }).dtaaRateCapPercent).toBe(0);
  });
});

describe("toItrForeignAssetInput", () => {
  it("maps an A3 RSU row, turning nulls into undefined", () => {
    const mapped = toItrForeignAssetInput(RSU_SHARES_ROW);
    expect(mapped.table).toBe("A3");
    expect(mapped.entityName).toBe("Acme Global Inc.");
    expect(mapped.accountNumber).toBeUndefined();
    expect(mapped.peakValue).toBe(3_300_000);
    expect(mapped.grossProceeds).toBe(620_000);
  });

  it("does NOT turn a missing required field into an empty string (it must fail loudly downstream)", () => {
    const mapped = toItrForeignAssetInput({ ...RSU_SHARES_ROW, entityName: null, zipCode: null });
    expect(mapped.entityName).toBeUndefined();
    expect(mapped.zipCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("buildFullIncomeInput with foreign income (end to end through the real engine)", () => {
  it("adds an un-counted foreign dividend to slab-rate other-sources income", () => {
    const input = buildFullIncomeInput({ ...emptyIncomeParams(), foreignSourceIncomes: [US_DIVIDEND_ROW] });
    const result = computeFullTaxLiability(input, "new", 30);
    expect(result.income.foreignSlabRateIncome).toBe(100_000);
    expect(result.income.otherSourcesIncome).toBe(100_000);
    expect(result.foreignTaxCredit.totalCredit).toBeGreaterThan(0);
    expect(result.netTaxLiabilityAfterReliefRounded).toBeLessThan(result.totalTaxLiabilityRounded);
  });

  it("does not add an already-counted row, but still computes its credit", () => {
    const alreadyCounted: ForeignSourceIncomeRow = {
      ...US_DIVIDEND_ROW,
      head: "SALARY",
      alreadyIncludedInIndianIncome: true,
      incomeAmount: 500_000,
      foreignTaxPaid: 50_000,
      dtaaRateCapPercent: null,
    };
    const withRow = computeFullTaxLiability(buildFullIncomeInput({ ...emptyIncomeParams(), foreignSourceIncomes: [alreadyCounted] }), "new", 30);
    const withoutRow = computeFullTaxLiability(buildFullIncomeInput(emptyIncomeParams()), "new", 30);

    expect(withRow.income.totalIncome).toBe(withoutRow.income.totalIncome);
    expect(withRow.totalTaxLiabilityRounded).toBe(withoutRow.totalTaxLiabilityRounded);
    expect(withRow.foreignTaxCredit.perSource).toHaveLength(1);
    expect(withRow.foreignTaxCredit.totalCredit).toBeGreaterThan(0);
  });

  it("omitting foreignSourceIncomes entirely behaves exactly as before Phase 11", () => {
    const input = buildFullIncomeInput(emptyIncomeParams());
    expect(input.foreignSourceIncomes).toEqual([]);
    const result = computeFullTaxLiability(input, "new", 30);
    expect(result.foreignTaxCredit.totalCredit).toBe(0);
    expect(result.netTaxLiabilityAfterReliefRounded).toBe(result.totalTaxLiabilityRounded);
  });
});

describe("mapFullTaxLiabilityToTaxComputation with a foreign tax credit", () => {
  it("keeps totalTaxLiability GROSS but computes netPayableOrRefund NET of the credit", () => {
    const result = computeFullTaxLiability(
      buildFullIncomeInput({ ...emptyIncomeParams(), foreignSourceIncomes: [US_DIVIDEND_ROW] }),
      "new",
      30,
    );
    const row = mapFullTaxLiabilityToTaxComputation(result, 50_000);

    expect(row.totalTaxLiability).toBe(result.totalTaxLiabilityRounded);
    expect(row.foreignTaxCredit).toBe(result.foreignTaxCredit.totalCredit);
    expect(row.foreignTaxCredit).toBeGreaterThan(0);
    expect(row.netPayableOrRefund).toBe(result.netTaxLiabilityAfterReliefRounded - 50_000);
    // The credit is exactly the gap between the gross liability and what is
    // actually payable — this is the reconciliation the /summary page shows.
    expect(row.totalTaxLiability - row.foreignTaxCredit).toBeCloseTo(result.netTaxLiabilityAfterRelief, 0);
  });

  it("reports a zero credit and an unchanged net figure for a taxpayer with no foreign income", () => {
    const result = computeFullTaxLiability(buildFullIncomeInput(emptyIncomeParams()), "new", 30);
    const row = mapFullTaxLiabilityToTaxComputation(result, 50_000);
    expect(row.foreignTaxCredit).toBe(0);
    expect(row.netPayableOrRefund).toBe(row.totalTaxLiability - 50_000);
  });
});
