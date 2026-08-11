import { foundField, notFound } from "@cleartax/pdf-form16";
import type { Form16PartA, Form16PartB } from "@cleartax/pdf-form16";
import { describe, expect, it } from "vitest";
import {
  defaultSalaryFromForm16,
  flattenChapterViaLines,
  flattenPartA,
  flattenPartB,
  flattenQuarterlyTds,
  needsReview,
  reconcileSection10,
} from "../lib/form16Review";

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
    exemptionGratuity: notFound("no matching line"),
    exemptionCommutedPension: notFound("no matching line"),
    exemptionLeaveEncashment: notFound("no matching line"),
    exemptionVrs: notFound("no matching line"),
    exemptionOtherSection10: notFound("no matching line"),
    totalSection10Exemption: notFound("no matching line"),
    salaryAfterSection10: notFound("no matching line"),
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

describe("Section 10 exemption routing", () => {
  it("sums only the four retirement heads, never HRA/LTA/transport", () => {
    const values = defaultSalaryFromForm16(
      partA(),
      partB({
        exemptionGratuity: foundField(100_000, "high"),
        exemptionCommutedPension: foundField(200_000, "high"),
        exemptionLeaveEncashment: foundField(351_000, "high"),
        exemptionVrs: foundField(50_000, "high"),
      })
    );
    expect(values.exemptRetirementSection10).toBe(701_000);
    // HRA still travels via its own field and must not be swept in.
    expect(values.exemptHra).toBe(210_000);
  });

  it("routes the unidentifiable 'any other exemption u/s 10' to the OLD-REGIME-ONLY bucket", () => {
    // Deliberate conservatism: the label does not say which head it is, and
    // applying it under both regimes would under-tax a new-regime filer.
    const values = defaultSalaryFromForm16(
      partA(),
      partB({ exemptionTransport: foundField(19_200, "high"), exemptionOtherSection10: foundField(40_000, "medium") })
    );
    expect(values.exemptOther).toBe(59_200);
    expect(values.exemptRetirementSection10).toBe(0);
  });

  it("reproduces the real certificate: ₹3,51,000 of leave encashment reaches the both-regime bucket", () => {
    const values = defaultSalaryFromForm16(
      partA(),
      partB({ exemptionLeaveEncashment: foundField(351_000, "high"), exemptionHra: notFound("no matching line") })
    );
    expect(values.exemptRetirementSection10).toBe(351_000);
    expect(values.exemptOther).toBe(0);
  });
});

describe("reconcileSection10", () => {
  it("flags exemption the certificate claimed that no head accounts for", () => {
    const result = reconcileSection10(partB({ totalSection10Exemption: foundField(500_000, "high") }), 210_000);
    expect(result).toEqual({ reportedTotal: 500_000, identifiedTotal: 210_000, unattributed: 290_000 });
  });

  it("reports nothing to reconcile when the heads account for the whole total", () => {
    const result = reconcileSection10(partB({ totalSection10Exemption: foundField(210_000, "high") }), 210_000);
    expect(result.unattributed).toBeNull();
  });

  it("does not flag the harmless direction, where the heads exceed the stated total", () => {
    // Over-identifying is not a tax risk (nothing is being silently taxed),
    // and a user who corrected a field upward would otherwise see a warning
    // for having done the right thing.
    const result = reconcileSection10(partB({ totalSection10Exemption: foundField(100_000, "high") }), 210_000);
    expect(result.unattributed).toBeNull();
  });

  it("reports nothing when the certificate stated no total at all", () => {
    const result = reconcileSection10(partB(), 210_000);
    expect(result).toEqual({ reportedTotal: null, identifiedTotal: 210_000, unattributed: null });
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
