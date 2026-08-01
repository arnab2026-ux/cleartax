import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Form 16 fixtures modelled on REAL published documents, not on what this
 * parser happens to handle.
 *
 * Every layout below was derived by taking a genuine or officially-published
 * Form 16 PDF, running it through this package's own pdfjs-dist +
 * `reconstructLines()` pipeline, and then reproducing the *reconstructed text
 * shape* that came out — label wording, column order, wrapping, punctuation
 * and number formatting included. Sources (see PROGRESS.md "Phase 10" for the
 * full notes):
 *
 *  - A real TRACES-generated Form 16 (redacted specimen, AY 2022-23,
 *    Part A + Part B Annexure-I):
 *    https://assets1.cleartax-cdn.com/cleartax/images/1655725194_sampleform16.pdf
 *  - The official Form 16 as substituted by the Income-tax (Twenty-sixth
 *    Amendment) Rules 2021 (Part B Annexure-I items 1-19, Annexure II):
 *    https://assets.learn.quicko.com/wp-content/uploads/2019/03/31170947/Form-16-Format_Income-Tax.pdf
 *  - The pre-2019 official blank form (old Part B numbering):
 *    https://support.taxmann.com/pdf/tds-forms/form16.pdf
 *  - An employer/treasury-generated Part B with its own numbering and wording:
 *    https://incometaxcalculator.tech/wp-content/uploads/2025/01/Form-16-Pdf-Download.pdf
 *
 * These deliberately do NOT copy the shape of `fixtures.ts`'s synthetic
 * fixture. Where a real document puts a label in a place the parser finds
 * awkward, the fixture keeps the real placement — the point is to find out
 * what breaks, not to confirm what already works.
 */

const PAGE_WIDTH = 595; // A4 portrait, as TRACES actually emits
const PAGE_HEIGHT = 842;
const LEFT = 36;

interface Cell {
  text: string;
  x: number;
}

/**
 * Real Form 16 tables leave gaps far wider than `extractText.ts`'s 12pt
 * column threshold, so column x-positions here are spaced accordingly — a
 * fixture whose columns render too close together reconstructs as one run and
 * would be testing the wrong thing.
 */
function row(page: PDFPage, font: PDFFont, y: number, cells: Cell[], size = 7.5): void {
  for (const cell of cells) {
    page.drawText(cell.text, { x: cell.x, y, size, font });
  }
}

function line(page: PDFPage, font: PDFFont, y: number, text: string, size = 7.5, x = LEFT): void {
  page.drawText(text, { x, y, size, font });
}

// ---------------------------------------------------------------------------
// 1. TRACES-standard Part A + Part B (Annexure-I)
// ---------------------------------------------------------------------------

export const TRACES_FIXTURE = {
  certificateNumber: "SRXJVMA",
  employerName: "DELOITTE SUPPORT SERVICES INDIA PRIVATE LIMITED",
  employerAddressLines: [
    "FLOOR 15, DELOITTE TOWER 1, SURVEY NO. 41",
    "GACHIBOWALI VILLAGE, HYDERABAD - 500032",
    "Telangana",
  ],
  employeeName: "MOHAMMED MUBEEN",
  employeeAddressLines: ["17-1-137/D/20, MUBEEN COLONY REIN BAZAR", "YAKUTHPURA, HYDERABAD - 500023"],
  employerPan: "AABCD9761D",
  employerTan: "HYDD01619C",
  employeePan: "ATOPM4017E",
  assessmentYear: "2026-27",
  periodFrom: "01-Apr-2025",
  periodTo: "31-Mar-2026",
  quarters: [
    { quarter: "Q1", receipt: "QUNPAQMB", paid: "762578.00", deducted: "158446.00", deposited: "158446.00" },
    { quarter: "Q2", receipt: "QUQSUMVE", paid: "571506.00", deducted: "99247.00", deposited: "99247.00" },
    // A genuinely nil quarter — the employee's TDS was fully covered earlier.
    { quarter: "Q3", receipt: "FXBUPVPZ", paid: "592463.00", deducted: "0.00", deposited: "0.00" },
    { quarter: "Q4", receipt: "QUYUZPGA", paid: "631436.00", deducted: "120996.00", deposited: "120996.00" },
  ],
  totalTdsDeposited: 378689,
  // Perquisites are deliberately non-zero, so 1(a) and 1(d) differ: a parser
  // that reads "Gross Salary" and then grabs the next line's figure returns
  // 2400000 instead of the real 2557983.
  salarySection17_1: 2400000,
  perquisitesSection17_2: 157983,
  grossSalary: 2557983,
  exemptionHra: 180150,
  exemptionLta: 0,
  standardDeduction: 75000,
  professionalTax: 2400,
  incomeChargeableUnderSalaries: 2300433,
  grossTotalIncome: 2300433,
  chapterVia: [
    { section: "80C", amount: 150000 },
    { section: "80CCD(1B)", amount: 50000 },
    { section: "80D", amount: 25000 },
  ],
  totalChapterViaDeductions: 225000,
  totalTaxableIncome: 2075433,
  totalTaxByEmployer: 447335,
};

export async function buildTracesForm16Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = TRACES_FIXTURE;

  // ---- Part A, page 1 ----
  const a = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 40;
  line(a, font, y, "FORM NO. 16", 11);
  y -= 12;
  line(a, font, y, "[See rule 31(1)(a)]", 7);
  y -= 12;
  line(a, font, y, "PART A", 9);
  y -= 12;
  line(
    a,
    font,
    y,
    "Certificate under Section 203 of the Income-tax Act, 1961 for tax deducted at source on salary paid to an employee under section 192",
    6.5
  );
  y -= 16;
  row(a, font, y, [
    { text: `Certificate No. ${f.certificateNumber}`, x: LEFT },
    { text: "Last updated on 06-Jun-2026", x: 320 },
  ]);
  y -= 18;

  // The two-column name/address block. Real TRACES prints ONE header row
  // covering both parties, then name, then address lines, side by side.
  row(a, font, y, [
    { text: "Name and address of the Employer/Specified Bank", x: LEFT },
    { text: "Name and address of the Employee/Specified senior citizen", x: 310 },
  ]);
  y -= 11;
  row(a, font, y, [
    { text: f.employerName, x: LEFT },
    { text: f.employeeName, x: 310 },
  ]);
  for (let i = 0; i < 3; i++) {
    y -= 10;
    row(a, font, y, [
      { text: f.employerAddressLines[i] ?? "", x: LEFT },
      { text: f.employeeAddressLines[i] ?? "", x: 310 },
    ]);
  }
  y -= 18;

  // The three-column identity row: labels on one line, all three values bare
  // on the next. Getting the employee's PAN right here requires knowing it is
  // the SECOND PAN-shaped token, not the first.
  row(a, font, y, [
    { text: "PAN of the Deductor", x: LEFT },
    { text: "TAN of the Deductor", x: 200 },
    { text: "PAN of the Employee/Specified senior citizen", x: 360 },
  ]);
  y -= 11;
  row(a, font, y, [
    { text: f.employerPan, x: LEFT },
    { text: f.employerTan, x: 200 },
    { text: f.employeePan, x: 360 },
  ]);
  y -= 18;

  // CIT / assessment year / period block: "From" and "To" are a sub-header
  // row, and the values sit several lines below, interleaved with the CIT's
  // own multi-line address.
  row(a, font, y, [
    { text: "CIT (TDS)", x: LEFT },
    { text: "Assessment Year", x: 250 },
    { text: "Period with the Employer", x: 380 },
  ]);
  y -= 11;
  row(a, font, y, [
    { text: "From", x: 380 },
    { text: "To", x: 480 },
  ]);
  y -= 11;
  line(a, font, y, "The Commissioner of Income Tax (TDS)");
  y -= 10;
  line(a, font, y, "Room No. 411, Income Tax Towers, 10-2-3 A.C. Guard ,");
  y -= 10;
  row(a, font, y, [
    { text: "Hyderabad - 500004", x: LEFT },
    { text: f.assessmentYear, x: 250 },
    { text: f.periodFrom, x: 380 },
    { text: f.periodTo, x: 480 },
  ]);
  y -= 22;

  line(a, font, y, "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee");
  y -= 14;
  // The header is genuinely spread over several reconstructed lines, and the
  // DATA ROWS CARRY NO LABELS AT ALL — the single most important difference
  // from the synthetic fixture.
  row(a, font, y, [
    { text: "Receipt Numbers of original", x: 100 },
    { text: "Amount of tax deposited /", x: 430 },
  ]);
  y -= 9;
  row(a, font, y, [
    { text: "quarterly statements of TDS", x: 100 },
    { text: "Amount of tax deducted", x: 320 },
    { text: "remitted", x: 430 },
  ]);
  y -= 9;
  row(a, font, y, [
    { text: "Quarter(s)", x: LEFT },
    { text: "under sub-section (3) of", x: 100 },
    { text: "Amount paid/credited", x: 210 },
    { text: "(Rs.)", x: 320 },
    { text: "(Rs.)", x: 430 },
  ]);
  y -= 9;
  line(a, font, y, "Section 200", 7.5, 100);
  y -= 12;
  for (const q of f.quarters) {
    row(a, font, y, [
      { text: q.quarter, x: LEFT },
      { text: q.receipt, x: 100 },
      { text: q.paid, x: 210 },
      { text: q.deducted, x: 320 },
      { text: q.deposited, x: 430 },
    ]);
    y -= 11;
  }
  row(a, font, y, [
    { text: "Total (Rs.)", x: LEFT },
    { text: "2557983.00", x: 210 },
    { text: "378689.00", x: 320 },
    { text: "378689.00", x: 430 },
  ]);
  y -= 20;

  line(
    a,
    font,
    y,
    "II. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH CHALLAN",
    6.5
  );
  y -= 12;
  row(a, font, y, [
    { text: "Sl. No.", x: LEFT },
    { text: "Tax Deposited in respect of", x: 85 },
    { text: "BSR Code of the Bank", x: 210 },
    { text: "Date on which Tax deposited", x: 320 },
    { text: "Challan Serial Number", x: 450 },
  ]);
  y -= 9;
  row(a, font, y, [
    { text: "the deductee (Rs.)", x: 85 },
    { text: "Branch", x: 210 },
    { text: "(dd/mm/yyyy)", x: 320 },
  ]);
  y -= 12;
  // Twelve monthly challans against four quarters: there is deliberately no
  // 1:1 mapping from a challan to a quarter, which is exactly why per-quarter
  // BSR code / deposit date cannot be honestly derived from this layout.
  const challans = [
    ["1", "20912.00", "6390340", "04-05-2025", "04357"],
    ["2", "20912.00", "6390340", "02-06-2025", "01139"],
    ["3", "116622.00", "6390340", "06-07-2025", "07512"],
    ["4", "33164.00", "6390340", "04-08-2025", "04966"],
  ];
  for (const c of challans) {
    row(a, font, y, [
      { text: c[0]!, x: LEFT },
      { text: c[1]!, x: 85 },
      { text: c[2]!, x: 210 },
      { text: c[3]!, x: 320 },
      { text: c[4]!, x: 450 },
    ]);
    y -= 11;
  }

  // ---- Part B (Annexure-I), page 2 ----
  const b = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - 40;
  // The continuation banner TRACES repeats on every page after the first.
  row(b, font, y, [
    { text: `Certificate Number: ${f.certificateNumber}`, x: LEFT },
    { text: `TAN of Employer: ${f.employerTan}`, x: 170 },
    { text: `PAN of Employee: ${f.employeePan}`, x: 320 },
    { text: `Assessment Year: ${f.assessmentYear}`, x: 470 },
  ]);
  y -= 20;
  line(b, font, y, "PART B (Annexure-I)", 9);
  y -= 14;
  line(b, font, y, "Details of Salary Paid and any other income and tax deducted");
  y -= 14;
  line(b, font, y, "Whether opting for taxation u/s 115BAC   No");
  y -= 16;

  // Item 1: "Gross Salary" is a HEADER with only currency-unit cells beside
  // it; the figure lives at 1(d).
  row(b, font, y, [
    { text: "1. Gross Salary", x: LEFT },
    { text: "Rs.", x: 400 },
    { text: "Rs.", x: 480 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(a) Salary as per provisions contained in section 17(1)", x: LEFT },
    { text: String(f.salarySection17_1) + ".00", x: 400 },
  ]);
  y -= 11;
  // A wrapped label with the value on the row that carries only the item marker.
  line(b, font, y, "Value of perquisites under section 17(2) (as per Form No. 12BA,", 7.5, 60);
  y -= 11;
  row(b, font, y, [
    { text: "(b)", x: LEFT },
    { text: String(f.perquisitesSection17_2) + ".00", x: 400 },
  ]);
  y -= 11;
  line(b, font, y, "wherever applicable)", 7.5, 60);
  y -= 11;
  row(b, font, y, [
    { text: "(c) Profits in lieu of salary under section 17(3)", x: LEFT },
    { text: "0.00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(d) Total", x: LEFT },
    { text: String(f.grossSalary) + ".00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(e) Reported total amount of salary received from other employer(s)", x: LEFT },
    { text: "0.00", x: 400 },
  ]);
  y -= 16;

  line(b, font, y, "2. Less: Allowances to the extent exempt under section 10");
  y -= 11;
  row(b, font, y, [
    { text: "(a) Travel concession or assistance under section 10(5)", x: LEFT },
    { text: "0.00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(d) Cash equivalent of leave salary encashment under section 10(10AA)", x: LEFT },
    { text: "0.00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(e) House rent allowance under section 10(13A)", x: LEFT },
    { text: String(f.exemptionHra) + ".00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(h) Total amount of exemption claimed under section 10", x: LEFT },
    { text: String(f.exemptionHra) + ".00", x: 400 },
  ]);
  y -= 16;

  line(b, font, y, "4. Less: Deductions under section 16");
  y -= 11;
  row(b, font, y, [
    { text: "(a) Standard deduction under section 16(ia)", x: LEFT },
    { text: String(f.standardDeduction) + ".00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(b) Entertainment allowance under section 16(ii)", x: LEFT },
    { text: "0.00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "(c) Tax on employment under section 16(iii)", x: LEFT },
    { text: String(f.professionalTax) + ".00", x: 400 },
  ]);
  y -= 11;
  // Typographic quotes around "Salaries", and a bracketed cross-reference
  // formula between the label and the figure — both are what TRACES prints.
  row(b, font, y, [
    { text: "6. Income chargeable under the head “Salaries” [(3+1(e)-5]", x: LEFT },
    { text: String(f.incomeChargeableUnderSalaries) + ".00", x: 400 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "9. Gross total income (6+8)", x: LEFT },
    { text: String(f.grossTotalIncome) + ".00", x: 400 },
  ]);
  y -= 16;

  row(b, font, y, [
    { text: "10. Deductions under Chapter VI-A", x: LEFT },
    { text: "Gross Amount", x: 390 },
    { text: "Deductible Amount", x: 470 },
  ]);
  y -= 11;
  // Wrapped label, amounts on the item-marker row ABOVE the section code.
  line(b, font, y, "Deduction in respect of life insurance premia, contributions to", 7.5, 60);
  y -= 11;
  row(b, font, y, [
    { text: "(a)", x: LEFT },
    { text: "150000.00", x: 390 },
    { text: "150000.00", x: 470 },
  ]);
  y -= 11;
  line(b, font, y, "provident fund etc. under section 80C", 7.5, 60);
  y -= 11;
  // The sub-total row, which must NOT be reported as a second 80C deduction.
  row(b, font, y, [
    { text: "(d) Total deduction under section 80C, 80CCC and 80CCD(1)", x: LEFT },
    { text: "150000.00", x: 390 },
    { text: "150000.00", x: 470 },
  ]);
  y -= 11;
  // Section code printed WITH a space before the parenthetical, and the
  // amounts on the following item-marker row.
  line(b, font, y, "Deductions in respect of amount paid/deposited to notified", 7.5, 60);
  y -= 11;
  line(b, font, y, "pension scheme under section 80CCD (1B)", 7.5, 60);
  y -= 11;
  row(b, font, y, [
    { text: "(e)", x: LEFT },
    { text: "50000.00", x: 390 },
    { text: "50000.00", x: 470 },
  ]);
  y -= 11;
  // Gross amount differs from deductible amount: only the deductible figure
  // belongs in a return.
  row(b, font, y, [
    { text: "(g) Deduction in respect of health insurance premia under section 80D", x: LEFT },
    { text: "31000.00", x: 390 },
    { text: "25000.00", x: 470 },
  ]);
  y -= 11;
  line(b, font, y, "Aggregate of deductible amount under Chapter VI-A", 7.5, 60);
  y -= 11;
  row(b, font, y, [
    { text: "11.", x: LEFT },
    { text: String(f.totalChapterViaDeductions) + ".00", x: 470 },
  ]);
  y -= 11;
  line(b, font, y, "[10(d)+10(e)+10(f)+10(g)+10(h)+10(i)+10(j)+10(l)]", 7.5, 60);
  y -= 14;

  row(b, font, y, [
    { text: "12. Total taxable income (9-11)", x: LEFT },
    { text: String(f.totalTaxableIncome) + ".00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "13. Tax on total income", x: LEFT },
    { text: "430130.00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "14. Rebate under section 87A, if applicable", x: LEFT },
    { text: "0.00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "16. Health and education cess", x: LEFT },
    { text: "17205.00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "17. Tax payable (13+15+16-14)", x: LEFT },
    { text: String(f.totalTaxByEmployer) + ".00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "18. Less: Relief under section 89 (attach details)", x: LEFT },
    { text: "0.00", x: 470 },
  ]);
  y -= 11;
  row(b, font, y, [
    { text: "19. Net tax payable (17-18)", x: LEFT },
    { text: String(f.totalTaxByEmployer) + ".00", x: 470 },
  ]);

  return doc.save();
}

// ---------------------------------------------------------------------------
// 2. Payroll-software-generated Part B (Zoho/greytHR/Keka house style)
// ---------------------------------------------------------------------------

export const PAYROLL_FIXTURE = {
  employerName: "Fintech Innovations India Pvt Ltd",
  employerAddressLines: ["Tower B, 7th Floor, Prestige Tech Park", "Marathahalli, Bengaluru - 560103", "Karnataka"],
  employeeName: "Priya Ramanathan",
  employerTan: "BLRF12345E",
  employeePan: "AKLPR7788Q",
  assessmentYear: "2026-27",
  grossSalary: 2150000,
  // Both of these appear TWICE in the document: once as a gross salary
  // component (5,40,000 / 60,000) and once as the exempt portion. Only the
  // exempt portion belongs in a return.
  exemptionHra: 384000,
  exemptionLta: 45000,
  hraSalaryComponent: 540000,
  ltaSalaryComponent: 60000,
  standardDeduction: 75000,
  professionalTax: 2400,
  incomeChargeableUnderSalaries: 1628600,
  chapterVia: [
    { section: "80C", amount: 150000 },
    { section: "80D", amount: 25000 },
    { section: "80CCD(1B)", amount: 50000 },
  ],
  totalChapterViaDeductions: 225000,
  grossTotalIncome: 1628600,
  totalTaxableIncome: 1403600,
  totalTaxByEmployer: 154123,
  totalTdsDeposited: 154123,
};

/**
 * A payroll vendor's own Part B: a "Particulars / Amount (Rs.)" table rather
 * than the statutory numbering, Indian digit grouping (1,50,000), explicit
 * "Rs." prefixes, "Less:" prefixes on deduction rows, and Chapter VI-A rows
 * written as "Sec 80C - <description>". The employer block uses separate
 * "Name of the Employer" / "Address" labels instead of the combined TRACES one.
 */
export async function buildPayrollVendorForm16Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = PAYROLL_FIXTURE;

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 40;
  line(page, font, y, "FORM 16 - PART B", 10);
  y -= 14;
  line(page, font, y, "Annexure to Certificate u/s 203 of the Income Tax Act, 1961", 7);
  y -= 18;

  row(page, font, y, [
    { text: "Name of the Employer", x: LEFT },
    { text: f.employerName, x: 200 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Address of the Employer", x: LEFT },
    { text: f.employerAddressLines[0]!, x: 200 },
  ]);
  y -= 11;
  line(page, font, y, f.employerAddressLines[1]!, 7.5, 200);
  y -= 11;
  line(page, font, y, f.employerAddressLines[2]!, 7.5, 200);
  y -= 11;
  row(page, font, y, [
    { text: "TAN of the Employer", x: LEFT },
    { text: f.employerTan, x: 200 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Name of the Employee", x: LEFT },
    { text: f.employeeName, x: 200 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "PAN of the Employee", x: LEFT },
    { text: f.employeePan, x: 200 },
  ]);
  y -= 11;
  // A genuinely blank optional field: the employee reference number was never
  // populated by the payroll system.
  row(page, font, y, [
    { text: "Employee Reference No.", x: LEFT },
    { text: "", x: 200 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Assessment Year", x: LEFT },
    { text: f.assessmentYear, x: 200 },
  ]);
  y -= 20;

  row(page, font, y, [
    { text: "Particulars", x: LEFT },
    { text: "Amount (Rs.)", x: 380 },
    { text: "Total (Rs.)", x: 470 },
  ]);
  y -= 14;
  const rows: [string, string][] = [
    ["Basic Salary", "Rs. 10,80,000"],
    ["House Rent Allowance", "Rs. 5,40,000"],
    ["Special Allowance", "Rs. 4,20,000"],
    ["Leave Travel Allowance", "Rs. 60,000"],
    ["Performance Bonus", "Rs. 1,50,000"],
  ];
  for (const [label, amount] of rows) {
    row(page, font, y, [
      { text: label, x: LEFT },
      { text: amount, x: 380 },
    ]);
    y -= 11;
  }
  row(page, font, y, [
    { text: "Gross Salary", x: LEFT },
    { text: "Rs. 21,50,000", x: 470 },
  ]);
  y -= 16;

  line(page, font, y, "Less: Allowances exempt under section 10");
  y -= 11;
  row(page, font, y, [
    { text: "HRA Exemption u/s 10(13A)", x: LEFT },
    { text: "Rs. 3,84,000", x: 380 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "LTA Exemption claimed u/s 10(5)", x: LEFT },
    { text: "Rs. 45,000", x: 380 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Conveyance Allowance", x: LEFT },
    { text: "Rs. 0", x: 380 },
  ]);
  y -= 16;

  line(page, font, y, "Less: Deductions under section 16");
  y -= 11;
  row(page, font, y, [
    { text: "Standard Deduction u/s 16(ia)", x: LEFT },
    { text: "Rs. 75,000", x: 380 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Professional Tax u/s 16(iii)", x: LEFT },
    { text: "Rs. 2,400", x: 380 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Income chargeable under the head 'Salaries'", x: LEFT },
    { text: "Rs. 16,28,600", x: 470 },
  ]);
  y -= 16;

  line(page, font, y, "Deductions under Chapter VI-A");
  y -= 11;
  row(page, font, y, [
    { text: "Gross Amount", x: 380 },
    { text: "Deductible Amount", x: 460 },
  ]);
  y -= 11;
  const chapter: [string, string, string][] = [
    ["Sec 80C - Life insurance, PF, ELSS, tuition fees", "1,92,500", "1,50,000"],
    ["Sec 80D - Medical insurance premium", "31,000", "25,000"],
    ["Sec 80CCD (1B) - NPS additional contribution", "50,000", "50,000"],
  ];
  for (const [label, gross, deductible] of chapter) {
    row(page, font, y, [
      { text: label, x: LEFT },
      { text: gross, x: 380 },
      { text: deductible, x: 460 },
    ]);
    y -= 11;
  }
  row(page, font, y, [
    { text: "Total deductions under Chapter VI-A", x: LEFT },
    { text: "2,25,000", x: 460 },
  ]);
  y -= 16;

  row(page, font, y, [
    { text: "Gross Total Income", x: LEFT },
    { text: "Rs. 16,28,600", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Total Taxable Income (rounded off)", x: LEFT },
    { text: "Rs. 14,03,600", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Tax on Total Income", x: LEFT },
    { text: "Rs. 1,42,220", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Less: Rebate u/s 87A", x: LEFT },
    { text: "Rs. 0", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Health and Education Cess @ 4%", x: LEFT },
    { text: "Rs. 5,689", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Total Tax Payable", x: LEFT },
    { text: "Rs. 1,54,123", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Less: Relief u/s 89", x: LEFT },
    { text: "Rs. 0", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Net Tax Payable", x: LEFT },
    { text: "Rs. 1,54,123", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Total TDS deducted and deposited", x: LEFT },
    { text: "Rs. 1,54,123", x: 460 },
  ]);

  return doc.save();
}

// ---------------------------------------------------------------------------
// 3. Government/treasury-generated Part B (old statutory numbering, own wording)
// ---------------------------------------------------------------------------

export const TREASURY_FIXTURE = {
  employerName: "Office of the District Treasury Officer, Ernakulam",
  employeeName: "K R Vijayan",
  employeePan: "BQTPV3344L",
  grossSalary: 1284560,
  salarySection17_1: 1284560,
  exemptionHra: 96000,
  standardDeduction: 75000,
  professionalTax: 2500,
  incomeChargeableUnderSalaries: 1111060,
  chapterVia: [
    { section: "80C", amount: 150000 },
    { section: "80CCD(1B)", amount: 50000 },
    { section: "80D", amount: 18500 },
  ],
  totalChapterViaDeductions: 218500,
  grossTotalIncome: 1071060,
  totalTaxableIncome: 852560,
  totalTaxByEmployer: 68932,
};

/**
 * The wording used by government treasury / SAP-style generators: the old
 * 1-19 numbering with locally-invented labels ("Prof. Tax on Employment",
 * "Deduct: interest on HBA", "Aggregate of deductible amount (10A + 10B)",
 * "Total Income rounded off to nearest multiple of ten rupees ( 9 - 11 )",
 * "Total Income Tax for the Year (17-18)"), spaces inside the arithmetic
 * cross-references, and Chapter VI-A rows named descriptively with the section
 * code trailing.
 */
export async function buildTreasuryStyleForm16Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = TREASURY_FIXTURE;

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 40;
  line(page, font, y, "FORM NO. 16", 10);
  y -= 12;
  line(page, font, y, "PART B (Annexure)", 9);
  y -= 16;
  row(page, font, y, [
    { text: "Name and address of the Employer", x: LEFT },
    { text: "Name and Designation of the Employee", x: 310 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: f.employerName, x: LEFT },
    { text: f.employeeName, x: 310 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Kakkanad, Ernakulam - 682030", x: LEFT },
    { text: "Senior Superintendent", x: 310 },
  ]);
  y -= 16;
  row(page, font, y, [
    { text: "PAN of the Deductor", x: LEFT },
    { text: "TAN of the Deductor", x: 200 },
    { text: "PAN of the Employee", x: 380 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "AAAGE2233K", x: LEFT },
    { text: "CHNE04567B", x: 200 },
    { text: f.employeePan, x: 380 },
  ]);
  y -= 20;

  const items: [string, string][] = [
    ["1. Gross Salary", ""],
    ["(a) Salary as per provisions contained in sec.17(1)", "1284560"],
    ["(b) Value of perquisites u/s 17(2) (as per Form No.12BA)", "0"],
    ["(c) Profits in lieu of salary under section 17(3) (as per Form No.12BA)", "0"],
    ["Total", "1284560"],
    ["2. Allowance to the extent exempt u/s 10", ""],
    ["a) House Rent Allowance", "96000"],
    ["b) Other Allowances", "0"],
    ["3. Balance ( 1- 2)", "1188560"],
    ["4. Deductions", ""],
    ["a) Standard Deduction", "75000"],
    ["b) Conveyance Allowance", "0"],
    ["c) Prof. Tax on Employment", "2500"],
    ["5. Aggregate of 4(a), (b) and (c)", "77500"],
    ["6. Income chargeable under the head Salaries (3-5)", "1111060"],
    ["7. Deduct: interest on HBA", "40000"],
    ["8. Add: Any other income reported by the employee", "0"],
    ["9. Gross total income (6-7+8)", "1071060"],
  ];
  for (const [label, amount] of items) {
    row(page, font, y, amount ? [{ text: label, x: LEFT }, { text: amount, x: 460 }] : [{ text: label, x: LEFT }]);
    y -= 11;
  }
  y -= 6;

  row(page, font, y, [
    { text: "10. Deductions under Chapter VIA", x: LEFT },
    { text: "Gross", x: 390 },
    { text: "Deductible", x: 455 },
  ]);
  y -= 11;
  const chapter: [string, string, string][] = [
    ["Contribution to GPF, LIC and tuition fees u/s. 80C", "168000", "150000"],
    ["Remaining Contribution to NPS u/s. 80CCD (1B)", "50000", "50000"],
    ["Health Insurance - Mediclaim u/s. 80D", "18500", "18500"],
  ];
  for (const [label, gross, deductible] of chapter) {
    row(page, font, y, [
      { text: label, x: LEFT },
      { text: gross, x: 390 },
      { text: deductible, x: 455 },
    ]);
    y -= 11;
  }
  y -= 6;

  const tail: [string, string][] = [
    ["11. Aggregate of deductible amount (10A + 10B)", "218500"],
    ["12. Total Income rounded off to nearest multiple of ten rupees ( 9 - 11 )", "852560"],
    ["13. Tax on Total Income", "66280"],
    ["14. Less: Rebate for the Income upto 5 Lakhs u/s 87 A", "0"],
    ["15. Income tax after Rebate ( 13 - 14 )", "66280"],
    ["16. Health and Education Cess [ @ 4% of (15) ]", "2652"],
    ["17. Total Tax Payable ( 15 + 16 )", "68932"],
    ["18. Less: Relief for arrears of salary u/s. 89(1)", "0"],
    ["19. Total Income Tax for the Year (17-18)", "68932"],
  ];
  for (const [label, amount] of tail) {
    row(page, font, y, [
      { text: label, x: LEFT },
      { text: amount, x: 460 },
    ]);
    y -= 11;
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// 4. Second employer's Form 16 for the same employee (mid-year job change)
// ---------------------------------------------------------------------------

export const SECOND_EMPLOYER_FIXTURE = {
  employerName: "Northstar Analytics LLP",
  employerTan: "MUMN98765C",
  employeePan: "AKLPR7788Q",
  employeeName: "Priya Ramanathan",
  periodFrom: "01-Sep-2025",
  periodTo: "31-Mar-2026",
  grossSalary: 980000,
  totalTdsDeposited: 61200,
};

/**
 * The second of two Form 16s an employee who changed jobs mid-year receives.
 * Only Q3 and Q4 have entries (there was no employment relationship in Q1/Q2),
 * the employer PAN is genuinely absent from the certificate, and Part B is
 * minimal. Nothing here should be merged with the other employer's document —
 * this fixture exists to confirm each certificate parses standalone and that
 * absent fields are reported absent rather than borrowed.
 */
export async function buildSecondEmployerForm16Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = SECOND_EMPLOYER_FIXTURE;

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 40;
  line(page, font, y, "FORM NO. 16", 10);
  y -= 12;
  line(page, font, y, "PART A", 9);
  y -= 16;
  row(page, font, y, [
    { text: "Name and address of the Employer", x: LEFT },
    { text: "Name and address of the Employee", x: 310 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: f.employerName, x: LEFT },
    { text: f.employeeName, x: 310 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Unit 402, Boomerang, Chandivali", x: LEFT },
    { text: "Flat 12C, Palm Meadows", x: 310 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "Mumbai - 400072", x: LEFT },
    { text: "Bengaluru - 560103", x: 310 },
  ]);
  y -= 16;
  // NOTE: no "PAN of the Deductor" column at all on this certificate.
  row(page, font, y, [
    { text: "TAN of the Deductor", x: LEFT },
    { text: "PAN of the Employee", x: 300 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: f.employerTan, x: LEFT },
    { text: f.employeePan, x: 300 },
  ]);
  y -= 16;
  row(page, font, y, [
    { text: "Assessment Year", x: LEFT },
    { text: "Period with the Employer", x: 300 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "From", x: 300 },
    { text: "To", x: 430 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "2026-27", x: LEFT },
    { text: f.periodFrom, x: 300 },
    { text: f.periodTo, x: 430 },
  ]);
  y -= 20;

  line(page, font, y, "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee");
  y -= 12;
  row(page, font, y, [
    { text: "Quarter(s)", x: LEFT },
    { text: "Receipt Numbers of original", x: 110 },
    { text: "Amount paid/credited", x: 250 },
    { text: "Amount of tax deducted", x: 370 },
    { text: "Amount of tax deposited", x: 470 },
  ]);
  y -= 12;
  const quarters = [
    ["Q3", "PVNRABCD", "560000.00", "35000.00", "35000.00"],
    ["Q4", "PVNREFGH", "420000.00", "26200.00", "26200.00"],
  ];
  for (const q of quarters) {
    row(page, font, y, [
      { text: q[0]!, x: LEFT },
      { text: q[1]!, x: 110 },
      { text: q[2]!, x: 250 },
      { text: q[3]!, x: 370 },
      { text: q[4]!, x: 470 },
    ]);
    y -= 11;
  }
  row(page, font, y, [
    { text: "Total (Rs.)", x: LEFT },
    { text: "980000.00", x: 250 },
    { text: "61200.00", x: 370 },
    { text: "61200.00", x: 470 },
  ]);
  y -= 20;

  line(page, font, y, "PART B (Annexure-I)", 9);
  y -= 14;
  row(page, font, y, [
    { text: "1. Gross Salary", x: LEFT },
    { text: "Rs.", x: 470 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "(a) Salary as per provisions contained in section 17(1)", x: LEFT },
    { text: "980000.00", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "(d) Total", x: LEFT },
    { text: "980000.00", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "(a) Standard deduction under section 16(ia)", x: LEFT },
    { text: "75000.00", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "12. Total taxable income (9-11)", x: LEFT },
    { text: "905000.00", x: 460 },
  ]);
  y -= 11;
  row(page, font, y, [
    { text: "19. Net tax payable (17-18)", x: LEFT },
    { text: "61200.00", x: 460 },
  ]);

  return doc.save();
}
