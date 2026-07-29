import { beforeAll, describe, expect, it } from "vitest";
import { decryptForm16Pdf } from "../src/decrypt.js";
import { extractText } from "../src/extractText.js";
import { parsePartB } from "../src/parsePartB.js";
import type { ExtractedDocumentText, Form16PartB } from "../src/types.js";
import { FIXTURE_VALUES, buildSyntheticForm16Pdf } from "./fixtures.js";

/** Build a minimal `ExtractedDocumentText` directly from lines, bypassing PDF generation — parsePartB only reads `.fullText`. */
function textOf(lines: string[]): ExtractedDocumentText {
  return { pages: [], fullText: lines.join("\n") };
}

describe("parsePartB — against the synthetic Form 16 fixture", () => {
  let partB: Form16PartB;

  beforeAll(async () => {
    const bytes = await buildSyntheticForm16Pdf();
    const dec = await decryptForm16Pdf(bytes);
    if (dec.status !== "success") throw new Error("fixture failed to decrypt");
    try {
      const ext = await extractText(dec.document);
      if (ext.status !== "success") throw new Error("fixture failed to extract text");
      partB = parsePartB(ext.document as ExtractedDocumentText);
    } finally {
      await dec.document.destroy();
    }
  });

  it("extracts the salary breakup figures", () => {
    expect(partB.salarySection17_1).toMatchObject({ found: true, value: FIXTURE_VALUES.salarySection17_1 });
    expect(partB.perquisitesSection17_2).toMatchObject({ found: true, value: FIXTURE_VALUES.perquisitesSection17_2 });
    expect(partB.grossSalary).toMatchObject({ found: true, value: FIXTURE_VALUES.grossSalary });
  });

  it("extracts HRA and LTA exemptions", () => {
    expect(partB.exemptionHra).toMatchObject({ found: true, value: FIXTURE_VALUES.exemptionHra });
    expect(partB.exemptionLta).toMatchObject({ found: true, value: FIXTURE_VALUES.exemptionLta });
  });

  it("extracts standard deduction and professional tax", () => {
    expect(partB.standardDeduction).toMatchObject({ found: true, value: FIXTURE_VALUES.standardDeduction });
    expect(partB.professionalTax).toMatchObject({ found: true, value: FIXTURE_VALUES.professionalTax });
  });

  it("extracts all Chapter VI-A deduction lines with the correct section codes and amounts", () => {
    expect(partB.chapterViaDeductions).toHaveLength(FIXTURE_VALUES.chapterVIA.length);
    FIXTURE_VALUES.chapterVIA.forEach((expected, i) => {
      const line = partB.chapterViaDeductions[i]!;
      expect(line.section).toMatchObject({ found: true, value: expected.section, confidence: "high" });
      expect(line.amount).toMatchObject({ found: true, value: expected.amount, confidence: "high" });
    });
  });

  it("stops scanning for Chapter VI-A lines at Gross Total Income (doesn't pick up unrelated 80-codes after it)", () => {
    // The fixture's Chapter VI-A section has exactly 3 lines; confirms the
    // section-boundary heuristic in parsePartB.ts isn't over-matching.
    expect(partB.chapterViaDeductions).toHaveLength(3);
  });

  it("extracts the aggregate Chapter VI-A total", () => {
    expect(partB.totalChapterViaDeductions).toMatchObject({
      found: true,
      value: FIXTURE_VALUES.totalChapterViaDeductions,
    });
  });

  it("extracts gross total income and total taxable income", () => {
    expect(partB.grossTotalIncome).toMatchObject({ found: true, value: FIXTURE_VALUES.grossTotalIncome });
    expect(partB.totalTaxableIncome).toMatchObject({ found: true, value: FIXTURE_VALUES.totalTaxableIncome });
  });

  it("extracts the employer's stated total tax", () => {
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: FIXTURE_VALUES.totalTaxByEmployer });
  });
});

describe("parsePartB — adversarial review regression tests", () => {
  it("extracts the final 'Net tax payable' figure, not an earlier intermediate 'Tax payable on total income' line", () => {
    // A realistic Part B tax-computation block: "tax payable" legitimately
    // appears multiple times before the final net figure (pre-rebate, then
    // again as the final line). The bare /tax\s*payable/i pattern matches
    // the FIRST such line; since findLabeledAmount returns on the first
    // matching line regardless of pattern order in the array, listing
    // /net\s*tax\s*payable/i later doesn't help without the priority-chain fix.
    const text = textOf([
      "Tax payable on total income 45000",
      "Rebate under section 87A 0",
      "Surcharge 0",
      "Health and education cess 1800",
      "Net tax payable 40000",
    ]);
    const partB = parsePartB(text);
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: 40000 });
  });

  it("falls back to a broader 'tax payable' match when no 'net tax payable' line exists anywhere", () => {
    const text = textOf(["Tax payable 55000"]);
    const partB = parsePartB(text);
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: 55000 });
  });

  it("does not misattribute a combined/aggregate exemption figure as the HRA-specific exemption", () => {
    // Before the fix, the unbounded /exempt.*\bhra\b/i pattern would span
    // this entire unrelated sentence (from "exempt" all the way to "HRA")
    // and return 45000 (a combined, non-HRA-specific figure) instead of
    // continuing on to the real, specific "House Rent Allowance" line below.
    const text = textOf([
      "Amount exempt under section 10 including HRA and LTA 45000",
      "House Rent Allowance 180000",
    ]);
    const partB = parsePartB(text);
    expect(partB.exemptionHra).toMatchObject({ found: true, value: 180000 });
  });

  it("still matches HRA exemption via the bounded fallback patterns when phrased without the full 'house rent allowance' label", () => {
    const text = textOf(["HRA - Exempt 180000"]);
    const partB = parsePartB(text);
    expect(partB.exemptionHra).toMatchObject({ found: true, value: 180000 });

    const text2 = textOf(["Exempt HRA amount 180000"]);
    const partB2 = parsePartB(text2);
    expect(partB2.exemptionHra).toMatchObject({ found: true, value: 180000 });
  });

  // --- Robustness checks for the three Chapter VI-A / gross-vs-taxable-income
  // fixes already applied in an earlier pass (see PROGRESS.md's "Phase 3"
  // section). These pin the CURRENT (correct) behavior against boundary
  // cases the original fixture didn't happen to exercise, confirming the
  // fixes are actually robust rather than merely coincidentally correct for
  // the one case they were caught on.

  it("Chapter VI-A section regex: correctly captures a section code at the very end of a line (no following character at all)", () => {
    const text = textOf(["Deductions under Chapter VI-A", "80D", "Gross Total Income 1000000"]);
    const partB = parsePartB(text);
    expect(partB.chapterViaDeductions).toHaveLength(1);
    expect(partB.chapterViaDeductions[0]!.section).toMatchObject({ found: true, value: "80D" });
    expect(partB.chapterViaDeductions[0]!.amount.found).toBe(false);
  });

  it("Chapter VI-A section regex: correctly stops at a section code immediately followed by punctuation (comma), not swallowing it", () => {
    const text = textOf(["Deductions under Chapter VI-A", "80D, 25000", "Gross Total Income 1000000"]);
    const partB = parsePartB(text);
    expect(partB.chapterViaDeductions[0]!.section).toMatchObject({ found: true, value: "80D" });
    expect(partB.chapterViaDeductions[0]!.amount).toMatchObject({ found: true, value: 25000 });
  });

  it("Chapter VI-A section regex: still correctly captures a parenthesized sub-section code ('80CCD(1B)') immediately followed by whitespace, not truncated to '80CCD'", () => {
    const text = textOf(["Deductions under Chapter VI-A", "80CCD(1B) 50000", "Gross Total Income 1000000"]);
    const partB = parsePartB(text);
    expect(partB.chapterViaDeductions[0]!.section).toMatchObject({ found: true, value: "80CCD(1B)" });
  });

  it("totalTaxableIncome fix handles irregular multi-space spacing between 'Gross' and 'Total Income'", () => {
    const text = textOf(["Gross  Total   Income 1747600", "Total Taxable Income 1447600"]);
    const partB = parsePartB(text);
    expect(partB.totalTaxableIncome).toMatchObject({ found: true, value: 1447600 });
  });
});
