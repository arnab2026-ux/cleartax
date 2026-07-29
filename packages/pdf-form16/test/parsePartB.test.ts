import { beforeAll, describe, expect, it } from "vitest";
import { decryptForm16Pdf } from "../src/decrypt.js";
import { extractText } from "../src/extractText.js";
import { parsePartB } from "../src/parsePartB.js";
import type { ExtractedDocumentText, Form16PartB } from "../src/types.js";
import { FIXTURE_VALUES, buildSyntheticForm16Pdf } from "./fixtures.js";

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
