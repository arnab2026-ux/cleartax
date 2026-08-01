import { beforeAll, describe, expect, it } from "vitest";
import { decryptForm16Pdf } from "../src/decrypt.js";
import { extractText } from "../src/extractText.js";
import { parsePartA } from "../src/parsePartA.js";
import type { ExtractedDocumentText, Form16PartA } from "../src/types.js";
import { FIXTURE_VALUES, buildSyntheticForm16Pdf } from "./fixtures.js";

/** Build a minimal `ExtractedDocumentText` directly from lines, bypassing PDF generation — parsePartA only reads `.fullText`. */
function textOf(lines: string[]): ExtractedDocumentText {
  return { pages: [], fullText: lines.join("\n") };
}

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

describe("parsePartA — adversarial review regression tests", () => {
  it("does not misattribute the BSR code as the receipt number when a row's receipt number is genuinely blank", () => {
    // Reconstructed row text as extractText.ts would actually produce it: a
    // wide gap (column boundary) between the "Receipt No." label (with no
    // value, since this quarter's row legitimately has none) and the next
    // column's "BSR Code 1234567" becomes a literal tab. Before the fix,
    // findLabeledValue's leading-separator strip removes that tab, and the
    // unbounded /(\d{6,})/ pattern then greedily grabbed the *next* column's
    // 7-digit BSR code as if it were the receipt number.
    const text = textOf([
      "Q1\tTax deposited/remitted: 25000\tReceipt No.\tBSR Code 1234567\tDate of tax deposit 07-Jul-2025",
    ]);
    const partA = parsePartA(text);
    expect(partA.quarterlyTds).toHaveLength(1);
    expect(partA.quarterlyTds[0]!.receiptNumber.found).toBe(false);
    // The real BSR code must still be extracted correctly under its own label.
    expect(partA.quarterlyTds[0]!.bsrCode).toMatchObject({ found: true, value: "1234567" });
  });

  it("still extracts a genuinely-present receipt number correctly (no regression)", () => {
    const text = textOf([
      "Q1\tTax deposited/remitted: 25000\tReceipt No. 123456\tBSR Code 1234567\tDate of tax deposit 07-Jul-2025",
    ]);
    const partA = parsePartA(text);
    expect(partA.quarterlyTds[0]!.receiptNumber).toMatchObject({ found: true, value: "123456" });
  });

  // --- Robustness checks for the amountDeposited fix already applied in an
  // earlier pass (excluding "Date of tax deposit" via a negative lookbehind).
  // These pin the current (correct) behavior against case/spacing variations
  // the original fixture didn't happen to exercise.

  it("amountDeposited fix is case-insensitive: 'DATE OF TAX DEPOSIT' (all caps) still doesn't leak the deposit day as the amount", () => {
    const text = textOf(["Q1\tDATE OF TAX DEPOSIT 07-Jul-2025\tAmount of tax deposited: 25000"]);
    const partA = parsePartA(text);
    expect(partA.quarterlyTds[0]!.amountDeposited).toMatchObject({ found: true, value: 25000 });
  });

  it("amountDeposited fix handles irregular double-spacing in 'Date  of  tax  deposit'", () => {
    const text = textOf(["Q1\tDate  of  tax  deposit 07-Jul-2025\tAmount of tax deposited: 25000"]);
    const partA = parsePartA(text);
    expect(partA.quarterlyTds[0]!.amountDeposited).toMatchObject({ found: true, value: 25000 });
  });

  it("reports employerAddress as not-found (rather than echoing the employer NAME) when the combined label has no address lines under it", () => {
    // BEHAVIOUR CHANGED IN PHASE 10 — this test previously asserted that
    // employerName and employerAddress both returned the SAME value, which was
    // a known-wrong behaviour pinned deliberately (see PROGRESS.md Phase 3
    // review, flagged item 1): both label patterns matched the one combined
    // "Name and address of the Employer" header and shared a match boundary,
    // so the company name was reported as its own street address.
    //
    // Phase 10 replaced that with a block reader that takes the name from the
    // first value line of the employer's column and the address from the lines
    // beneath it. Here there are no lines beneath it, so the honest answer is
    // "no address found" — not the company name over again.
    const text = textOf(["Name and address of the Employer\tAcme Software Private Limited"]);
    const partA = parsePartA(text);
    expect(partA.employerName).toMatchObject({ found: true, value: "Acme Software Private Limited" });
    expect(partA.employerAddress.found).toBe(false);
  });

  it("aggregates the address lines beneath the combined 'Name and address of the Employer' label", () => {
    // The layout every TRACES-generated Part A actually uses: one combined
    // header, the company name on the next line, then several address lines,
    // terminated by the next column header.
    const text = textOf([
      "Name and address of the Employer",
      "Acme Software Private Limited",
      "Plot 42, Whitefield Main Road",
      "Bengaluru - 560066",
      "Karnataka",
      "PAN of the Deductor",
    ]);
    const partA = parsePartA(text);
    expect(partA.employerName).toMatchObject({ found: true, value: "Acme Software Private Limited" });
    expect(partA.employerAddress).toMatchObject({
      found: true,
      value: "Plot 42, Whitefield Main Road, Bengaluru - 560066, Karnataka",
    });
  });
});
