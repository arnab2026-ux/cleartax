import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Synthetic Form 16-like PDF fixtures for tests. Built programmatically
 * (rather than committed as binary blobs) so the fixture content is
 * reviewable as code and doesn't drift from what the tests actually assert.
 *
 * These are NOT real Form 16 layouts (no real sample was available to model
 * against directly) — field labels/positions are based on general knowledge
 * of the Form 16 format (Part A: employer/employee PAN/TAN, quarterly TDS;
 * Part B: salary breakup, exemptions, Chapter VI-A, gross total income).
 * They're realistic enough to exercise the line-reconstruction and
 * label/value heuristics, not just trivial single-token cases.
 */

// Wider than a real US-Letter page (612pt) on purpose: this fixture doesn't
// need visual realism, and the quarterly TDS table's rightmost column
// previously ran off a 612pt-wide page and got silently truncated mid-string
// by pdf-lib/PDF rendering, which broke depositDate extraction — not a bug
// in the parser, but a fixture layout mistake worth documenting so it isn't
// reintroduced.
const PAGE_WIDTH = 900;
const PAGE_HEIGHT = 792;
const FONT_SIZE = 10;
const LEFT_MARGIN = 50;
const LABEL_VALUE_GAP = 20; // > COLUMN_GAP_THRESHOLD (12) -> reconstructed as a tab-separated column, not run together as one word.

interface RowItem {
  text: string;
  x: number;
}

/** Draw several items on the same visual row (same y) at different x — exercises reconstructLines()'s row-clustering, not just single whole-line strings. */
function drawRow(page: PDFPage, font: PDFFont, y: number, items: RowItem[]): void {
  for (const item of items) {
    page.drawText(item.text, { x: item.x, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  }
}

function drawLabelValue(page: PDFPage, font: PDFFont, y: number, label: string, value: string): void {
  drawRow(page, font, y, [
    { text: label, x: LEFT_MARGIN },
    { text: value, x: LEFT_MARGIN + Math.max(label.length * 5.2, 180) + LABEL_VALUE_GAP },
  ]);
}

export const FIXTURE_VALUES = {
  employerName: "Acme Software Private Limited",
  employerTan: "BLRA12345B",
  employerPan: "AAACA1234A",
  employeeName: "Rohan Sharma",
  employeePan: "ABCDE1234F",
  employeeDob: "28011990", // DDMMYYYY, used for the PAN+DOB password fixture
  assessmentYear: "2026-27",
  quarters: [
    { quarter: "Q1", amount: 25000, receipt: "123456", bsr: "1234567", date: "07-Jul-2025" },
    { quarter: "Q2", amount: 27500, receipt: "234567", bsr: "1234567", date: "07-Oct-2025" },
    { quarter: "Q3", amount: 27500, receipt: "345678", bsr: "1234567", date: "07-Jan-2026" },
    { quarter: "Q4", amount: 30000, receipt: "456789", bsr: "1234567", date: "07-Apr-2026" },
  ],
  totalTdsDeposited: 110000,
  grossSalary: 1800000,
  salarySection17_1: 1750000,
  perquisitesSection17_2: 50000,
  exemptionHra: 180000,
  exemptionLta: 25000,
  standardDeduction: 75000,
  professionalTax: 2400,
  chapterVIA: [
    { section: "80C", amount: 150000 },
    { section: "80D", amount: 25000 },
    { section: "80CCD(1B)", amount: 50000 },
  ],
  totalChapterViaDeductions: 225000,
  grossTotalIncome: 1747600,
  totalTaxableIncome: 1447600,
  totalTaxByEmployer: 267800,
};

/**
 * Builds a synthetic, unencrypted, text-based Form 16-like PDF (Part A on
 * page 1, Part B on page 2) exercising realistic multi-item rows (employer
 * header, quarterly TDS table, Chapter VI-A lines) as well as simple
 * same-line "Label: Value" pairs.
 */
export async function buildSyntheticForm16Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // ---- Part A ----
  const partA = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 60;
  partA.drawText("FORM NO. 16", { x: LEFT_MARGIN, y, size: 14, font });
  y -= 20;
  partA.drawText("Certificate under section 203 of the Income-tax Act, 1961", { x: LEFT_MARGIN, y, size: 9, font });
  y -= 30;
  partA.drawText("PART A", { x: LEFT_MARGIN, y, size: 12, font });
  y -= 30;

  drawLabelValue(partA, font, y, "Name and address of the Employer", FIXTURE_VALUES.employerName);
  y -= 20;
  drawLabelValue(partA, font, y, "TAN of the Employer", FIXTURE_VALUES.employerTan);
  y -= 20;
  drawLabelValue(partA, font, y, "PAN of the Employer", FIXTURE_VALUES.employerPan);
  y -= 30;
  drawLabelValue(partA, font, y, "Name of the Employee", FIXTURE_VALUES.employeeName);
  y -= 20;
  drawLabelValue(partA, font, y, "PAN of the Employee", FIXTURE_VALUES.employeePan);
  y -= 20;
  drawLabelValue(partA, font, y, "Assessment Year", FIXTURE_VALUES.assessmentYear);
  y -= 20;
  drawLabelValue(partA, font, y, "Period with the Employer From", "01-Apr-2025");
  y -= 16;
  drawLabelValue(partA, font, y, "Period with the Employer To", "31-Mar-2026");
  y -= 40;

  partA.drawText("Summary of tax deducted and deposited quarterly", { x: LEFT_MARGIN, y, size: 10, font });
  y -= 20;
  // Table header row, multi-item to exercise column reconstruction.
  drawRow(partA, font, y, [
    { text: "Quarter", x: LEFT_MARGIN },
    { text: "Tax deposited/remitted", x: LEFT_MARGIN + 60 },
    { text: "Receipt No.", x: LEFT_MARGIN + 220 },
    { text: "BSR Code", x: LEFT_MARGIN + 320 },
    { text: "Date of tax deposit", x: LEFT_MARGIN + 400 },
  ]);
  y -= 18;
  for (const q of FIXTURE_VALUES.quarters) {
    drawRow(partA, font, y, [
      { text: q.quarter, x: LEFT_MARGIN },
      // Real Form 16 quarterly tables are inconsistent about whether each
      // data row restates the column label or relies solely on the header
      // above — this fixture models the (common, template-generated) case
      // where it's restated per row, which is what parsePartA.ts's per-row
      // heuristic matching is actually designed to find. A column-header-only
      // layout (label once, bare values below) is a known gap — see
      // PROGRESS.md.
      // Generously spaced (this is a synthetic fixture with no page-width
      // constraint we care about) so each item's rendered width can't run
      // into the next column and eliminate the gap reconstructLines() relies
      // on to insert a separator — that exact mistake, with "BSR Code
      // 1234567" bumping into "Date of tax deposit", previously produced an
      // untokenizable "...1234567Date..." run and made bsrCode wrongly
      // report not-found.
      { text: `Tax deposited/remitted: ${q.amount}`, x: LEFT_MARGIN + 70 },
      { text: `Receipt No. ${q.receipt}`, x: LEFT_MARGIN + 260 },
      { text: `BSR Code ${q.bsr}`, x: LEFT_MARGIN + 380 },
      { text: `Date of tax deposit ${q.date}`, x: LEFT_MARGIN + 500 },
    ]);
    y -= 18;
  }
  y -= 10;
  drawLabelValue(partA, font, y, "Total amount of tax deposited", String(FIXTURE_VALUES.totalTdsDeposited));

  // ---- Part B ----
  const partB = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - 60;
  partB.drawText("PART B (Annexure)", { x: LEFT_MARGIN, y, size: 12, font });
  y -= 30;

  drawLabelValue(partB, font, y, "Salary as per section 17(1)", String(FIXTURE_VALUES.salarySection17_1));
  y -= 18;
  drawLabelValue(partB, font, y, "Value of perquisites under section 17(2)", String(FIXTURE_VALUES.perquisitesSection17_2));
  y -= 18;
  drawLabelValue(partB, font, y, "Gross Salary", String(FIXTURE_VALUES.grossSalary));
  y -= 30;

  partB.drawText("Exemptions under section 10", { x: LEFT_MARGIN, y, size: 10, font });
  y -= 18;
  drawLabelValue(partB, font, y, "House Rent Allowance", String(FIXTURE_VALUES.exemptionHra));
  y -= 18;
  drawLabelValue(partB, font, y, "Leave Travel Allowance", String(FIXTURE_VALUES.exemptionLta));
  y -= 30;

  drawLabelValue(partB, font, y, "Standard Deduction", String(FIXTURE_VALUES.standardDeduction));
  y -= 18;
  drawLabelValue(partB, font, y, "Tax on employment", String(FIXTURE_VALUES.professionalTax));
  y -= 18;
  drawLabelValue(
    partB,
    font,
    y,
    "Income chargeable under the head Salaries",
    String(FIXTURE_VALUES.grossSalary - FIXTURE_VALUES.exemptionHra - FIXTURE_VALUES.exemptionLta - FIXTURE_VALUES.standardDeduction - FIXTURE_VALUES.professionalTax)
  );
  y -= 30;

  partB.drawText("Deductions under Chapter VI-A", { x: LEFT_MARGIN, y, size: 10, font });
  y -= 18;
  for (const line of FIXTURE_VALUES.chapterVIA) {
    drawRow(partB, font, y, [
      { text: line.section, x: LEFT_MARGIN },
      { text: String(line.amount), x: LEFT_MARGIN + 100 },
    ]);
    y -= 16;
  }
  drawLabelValue(partB, font, y, "Aggregate of deductions under Chapter VI-A", String(FIXTURE_VALUES.totalChapterViaDeductions));
  y -= 30;

  drawLabelValue(partB, font, y, "Gross Total Income", String(FIXTURE_VALUES.grossTotalIncome));
  y -= 18;
  drawLabelValue(partB, font, y, "Total Taxable Income", String(FIXTURE_VALUES.totalTaxableIncome));
  y -= 18;
  drawLabelValue(partB, font, y, "Net tax payable", String(FIXTURE_VALUES.totalTaxByEmployer));

  return doc.save();
}

/** A single blank page with no text at all — simulates a scanned/image-only PDF (no extractable text layer). */
export async function buildNoTextLayerPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return doc.save();
}

/**
 * The PAN+DOB-derived password `decrypt.ts` would try first for this
 * fixture's employee, if the fixture were actually encrypted.
 *
 * NOTE: there is no real encrypted-PDF fixture in this test suite. Plain
 * `pdf-lib` (the maintained package used here) does not support writing
 * encrypted PDFs at all, and the alternative package that does
 * (`pdf-lib-with-encrypt`) has a confirmed dependency bug in its `.encrypt()`
 * path (`pako.deflate is not a function`) that made it unusable for this
 * purpose — see PROGRESS.md. `decrypt.test.ts` instead tests
 * `decryptForm16Pdf`'s branching logic (needs-password / wrong-password /
 * success-via-PAN+DOB / success-via-override) by mocking pdfjs-dist's
 * `getDocument` to throw the same `PasswordException` shape it throws for a
 * real encrypted PDF. `derivePanDobPassword` itself (the actual password-
 * construction logic) is tested directly and doesn't need a PDF at all.
 */
export const PAN_DOB_PASSWORD_FOR_FIXTURE = `${FIXTURE_VALUES.employeePan}${FIXTURE_VALUES.employeeDob}`;
