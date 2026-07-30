import { foundField, notFound } from "@cleartax/pdf-form16";
import type { Form16PartA, Form16PartB } from "@cleartax/pdf-form16";
import { describe, expect, it } from "vitest";
import { defaultSalaryFromForm16, flattenChapterViaLines, flattenPartA, flattenPartB, flattenQuarterlyTds, needsReview } from "../lib/form16Review";

function partA(overrides: Partial<Form16PartA> = {}): Form16PartA {
  return {
    employerName: foundField("Acme Corp", "high", "Name and address of the Employer: Acme Corp"),
    employerAddress: foundField("Acme Corp", "high", "Name and address of the Employer: Acme Corp"),
    employerTan: foundField("ABCD12345E", "high"),
    employerPan: foundField("ABCDE1234F", "high"),
    employeeName: foundField("Arjun Mehta", "high"),
    employeePan: foundField("PQRSX9876Z", "high"),
    assessmentYear: foundField("2026-27", "high"),
    periodFrom: foundField("01-Apr-2025", "medium"),
    periodTo: foundField("31-Mar-2026", "medium"),
    quarterlyTds: [
      {
        quarter: foundField("Q1", "high"),
        amountDeposited: foundField(37_500, "high", "Amount deposited 37500"),
        receiptNumber: notFound("blank on the form"),
        bsrCode: foundField("1234567", "high"),
        depositDate: foundField("07-Jul-2025", "medium"),
      },
    ],
    totalTdsDeposited: foundField(150_000, "high"),
    ...overrides,
  };
}

function partB(overrides: Partial<Form16PartB> = {}): Form16PartB {
  return {
    grossSalary: foundField(1_800_000, "high"),
    salarySection17_1: foundField(1_700_000, "medium"),
    perquisitesSection17_2: foundField(100_000, "medium"),
    profitsInLieuSection17_3: notFound("no matching line"),
    exemptionHra: foundField(210_000, "high"),
    exemptionLta: notFound("no matching line"),
    exemptionTransport: foundField(0, "low"),
    standardDeduction: foundField(75_000, "high"),
    professionalTax: foundField(2_400, "medium"),
    incomeChargeableUnderSalaries: foundField(1_512_600, "medium"),
    chapterViaDeductions: [{ section: foundField("80C", "high"), amount: foundField(150_000, "high") }],
    totalChapterViaDeductions: foundField(150_000, "high"),
    grossTotalIncome: foundField(1_512_600, "medium"),
    totalTaxableIncome: foundField(1_362_600, "medium"),
    totalTaxByEmployer: foundField(180_000, "high"),
    ...overrides,
  };
}

describe("flattenPartA / flattenPartB", () => {
  it("flattens every found field with its confidence and source text", () => {
    const rows = flattenPartA(partA());
    const employer = rows.find((r) => r.key === "employerName");
    expect(employer).toMatchObject({ found: true, value: "Acme Corp", confidence: "high" });
    expect(employer?.sourceText).toContain("Acme Corp");
  });

  it("flattens a not-found field with its reason, no value/confidence", () => {
    const rows = flattenPartB(partB());
    const lta = rows.find((r) => r.key === "exemptionLta");
    expect(lta).toMatchObject({ found: false, value: "", confidence: null, reason: "no matching line" });
  });

  it("stringifies a numeric value", () => {
    const rows = flattenPartB(partB());
    const gross = rows.find((r) => r.key === "grossSalary");
    expect(gross?.value).toBe("1800000");
  });
});

describe("flattenQuarterlyTds / flattenChapterViaLines", () => {
  it("labels each quarterly row by its found quarter", () => {
    const groups = flattenQuarterlyTds(partA());
    expect(groups).toHaveLength(1);
    expect(groups[0].quarter).toBe("Q1");
    const receipt = groups[0].rows.find((r) => r.key === "receiptNumber");
    expect(receipt?.found).toBe(false);
  });

  it("labels each Chapter VI-A line by its section", () => {
    const groups = flattenChapterViaLines(partB());
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe("80C");
    expect(groups[0].rows[0].value).toBe("150000");
  });
});

describe("defaultSalaryFromForm16", () => {
  it("prefills what the parser found and zeroes what it can never know", () => {
    const defaults = defaultSalaryFromForm16(partA(), partB());
    expect(defaults.employerName).toBe("Acme Corp");
    expect(defaults.grossSalary).toBe(1_800_000);
    expect(defaults.exemptHra).toBe(210_000);
    expect(defaults.exemptLta).toBe(0); // not found on the form
    expect(defaults.standardDeduction).toBe(75_000);
    expect(defaults.tdsDeducted).toBe(150_000);
    // Form 16 never states these — must default to 0/false, not guessed:
    expect(defaults.basicSalary).toBe(0);
    expect(defaults.hraReceived).toBe(0);
    expect(defaults.rentPaid).toBe(0);
    expect(defaults.isMetroCity).toBe(false);
  });

  it("falls back to empty string for employer name when not found", () => {
    const defaults = defaultSalaryFromForm16(partA({ employerName: notFound() }), partB());
    expect(defaults.employerName).toBe("");
  });
});

describe("needsReview", () => {
  it("is false when the critical fields are all found at high/medium confidence", () => {
    expect(needsReview(partB())).toBe(false);
  });

  it("is true when grossSalary wasn't found", () => {
    expect(needsReview(partB({ grossSalary: notFound() }))).toBe(true);
  });

  it("is true when a critical field was found only at low confidence", () => {
    expect(needsReview(partB({ totalTaxableIncome: foundField(1_362_600, "low") }))).toBe(true);
  });
});
