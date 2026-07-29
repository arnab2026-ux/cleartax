import { beforeAll, describe, expect, it } from "vitest";
import { decryptForm16Pdf } from "../src/decrypt.js";
import { extractText } from "../src/extractText.js";
import { parsePartA } from "../src/parsePartA.js";
import type { ExtractedDocumentText, Form16PartA } from "../src/types.js";
import { FIXTURE_VALUES, buildSyntheticForm16Pdf } from "./fixtures.js";

describe("parsePartA — against the synthetic Form 16 fixture", () => {
  let partA: Form16PartA;

  beforeAll(async () => {
    const bytes = await buildSyntheticForm16Pdf();
    const dec = await decryptForm16Pdf(bytes);
    if (dec.status !== "success") throw new Error("fixture failed to decrypt");
    try {
      const ext = await extractText(dec.document);
      if (ext.status !== "success") throw new Error("fixture failed to extract text");
      partA = parsePartA(ext.document as ExtractedDocumentText);
    } finally {
      await dec.document.destroy();
    }
  });

  it("extracts the employer name with high confidence", () => {
    expect(partA.employerName.found).toBe(true);
    if (partA.employerName.found) {
      expect(partA.employerName.value).toContain(FIXTURE_VALUES.employerName);
    }
  });

  it("extracts the employer TAN with high confidence", () => {
    expect(partA.employerTan).toMatchObject({ found: true, value: FIXTURE_VALUES.employerTan, confidence: "high" });
  });

  it("extracts the employer PAN with high confidence", () => {
    expect(partA.employerPan).toMatchObject({ found: true, value: FIXTURE_VALUES.employerPan, confidence: "high" });
  });

  it("extracts the employee PAN with high confidence, distinct from the employer PAN", () => {
    expect(partA.employeePan).toMatchObject({ found: true, value: FIXTURE_VALUES.employeePan, confidence: "high" });
    expect(partA.employeePan.found && partA.employeePan.value).not.toBe(
      partA.employerPan.found && partA.employerPan.value
    );
  });

  it("extracts the assessment year", () => {
    expect(partA.assessmentYear).toMatchObject({ found: true, value: FIXTURE_VALUES.assessmentYear });
  });

  it("extracts all four quarterly TDS rows with correct amounts, receipt numbers, BSR codes, and dates", () => {
    expect(partA.quarterlyTds).toHaveLength(4);
    partA.quarterlyTds.forEach((row, i) => {
      const expected = FIXTURE_VALUES.quarters[i]!;
      expect(row.quarter).toMatchObject({ found: true, value: expected.quarter });
      expect(row.amountDeposited).toMatchObject({ found: true, value: expected.amount });
      expect(row.receiptNumber).toMatchObject({ found: true, value: expected.receipt });
      expect(row.bsrCode).toMatchObject({ found: true, value: expected.bsr });
      expect(row.depositDate.found).toBe(true);
    });
  });

  it("extracts the total TDS deposited", () => {
    expect(partA.totalTdsDeposited).toMatchObject({ found: true, value: FIXTURE_VALUES.totalTdsDeposited });
  });
});

describe("parsePartA — fields that are genuinely absent should be reported as not-found, not guessed", () => {
  it("does not fabricate a value for a field whose label never appears", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText("This document has no employer information at all.", { x: 50, y: 700, size: 10, font });
    const bytes = await doc.save();

    const dec = await decryptForm16Pdf(bytes);
    if (dec.status !== "success") throw new Error("unexpected decrypt failure");
    try {
      const ext = await extractText(dec.document);
      if (ext.status !== "success") throw new Error("unexpected extract failure");
      const partA = parsePartA(ext.document);
      expect(partA.employerTan.found).toBe(false);
      expect(partA.employeePan.found).toBe(false);
      expect(partA.quarterlyTds).toHaveLength(0);
    } finally {
      await dec.document.destroy();
    }
  });
});
