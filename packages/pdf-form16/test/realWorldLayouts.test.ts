import { beforeAll, describe, expect, it } from "vitest";
import { parseForm16Pdf } from "../src/index.js";
import { parsePartA } from "../src/parsePartA.js";
import { parsePartB } from "../src/parsePartB.js";
import type { ExtractedDocumentText, Form16PartA, Form16PartB } from "../src/types.js";
import {
  PAYROLL_FIXTURE,
  SECOND_EMPLOYER_FIXTURE,
  TRACES_FIXTURE,
  TREASURY_FIXTURE,
  buildPayrollVendorForm16Pdf,
  buildSecondEmployerForm16Pdf,
  buildTracesForm16Pdf,
  buildTreasuryStyleForm16Pdf,
} from "./realWorldFixtures.js";

function textOf(lines: string[]): ExtractedDocumentText {
  return { pages: [], fullText: lines.join("\n") };
}

async function parse(build: () => Promise<Uint8Array>): Promise<{ partA: Form16PartA; partB: Form16PartB }> {
  const result = await parseForm16Pdf(await build());
  if (result.status !== "success") throw new Error(`fixture failed to parse: ${result.status}`);
  return { partA: result.partA, partB: result.partB };
}

// ---------------------------------------------------------------------------
// Verbatim lines from a genuine TRACES certificate
// ---------------------------------------------------------------------------

/**
 * These are the EXACT reconstructed lines this package's own
 * pdfjs-dist + `reconstructLines()` pipeline produced from a real
 * TRACES-generated Form 16 (redacted specimen, AY 2022-23), tabs and all.
 *
 * They matter because `extractText.ts` only emits a tab when the rendered gap
 * exceeds its 12pt threshold, and a pdf-lib-built fixture rarely reaches it —
 * so the PDF fixtures below exercise the space-separated reconstruction while
 * these exercise the tab-separated one. Both occur in the same real document.
 */
const REAL_TRACES_PART_B_LINES = [
  "Whether opting for taxation u/s 115BAC No",
  "1. Gross Salary\tRs. Rs.",
  "(a) Salary as per provisions contained in section 17(1)\t2557983.00",
  "Value of perquisites under section 17(2) (as per Form No. 12BA,",
  "(b) 0.00",
  "wherever applicable)",
  "(d) Total 2557983.00",
  "(e) Reported total amount of salary received from other employer(s) 0.00",
  "2. Less: Allowances to the extent exempt under section 10",
  "(e) House rent allowance under section 10(13A)\t180150.00",
  "3. \t2377833.00",
  "4. Less: Deductions under section 16",
  "(a) Standard deduction under section 16(ia)\t50000.00",
  "(b)\tEntertainment allowance under section 16(ii)\t0.00",
  "(c)\tTax on employment under section 16(iii) 2400.00",
  "5.\tTotal amount of deductions under section 16 [4(a)+4(b)+4(c)]\t52400.00",
  "6.\tIncome chargeable under the head “Salaries” [(3+1(e)-5]\t2325433.00",
  "9.\tGross total income (6+8)\t2325433.00",
  "10.\tDeductions under Chapter VI-A\tGross Amount Deductible Amount",
  "12.\tTotal taxable income (9-11)\t2175433.00",
  "13.\tTax on total income\t465132.00",
  "16. Health and education cess\t18605.00",
  "17.\tTax payable (13+15+16-14)\t483737.00",
  "18.\tLess: Relief under section 89 (attach details)\t0.00",
  "19.\tNet tax payable (17-18)\t483737.00",
];

describe("real TRACES Part B — verbatim reconstructed lines (tab-separated)", () => {
  let partB: Form16PartB;
  beforeAll(() => {
    partB = parsePartB(textOf(REAL_TRACES_PART_B_LINES));
  });

  it("reads the amount, not the digits inside the statutory reference beside it", () => {
    // Every one of these returned the section/clause number before Phase 10:
    // HRA was 10 (from "section 10(13A)"), the standard deduction was 16 (from
    // "section 16(ia)"), gross total income was 6 (from "(6+8)"), taxable
    // income was 9 (from "(9-11)") and the final tax was 17 (from "(17-18)").
    expect(partB.exemptionHra).toMatchObject({ found: true, value: 180150 });
    expect(partB.standardDeduction).toMatchObject({ found: true, value: 50000 });
    expect(partB.professionalTax).toMatchObject({ found: true, value: 2400 });
    expect(partB.grossTotalIncome).toMatchObject({ found: true, value: 2325433 });
    expect(partB.totalTaxableIncome).toMatchObject({ found: true, value: 2175433 });
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: 483737 });
  });

  it("reads Gross Salary from item 1(d) Total, not from the header row or item 1(a)", () => {
    expect(partB.grossSalary).toMatchObject({ found: true, value: 2557983 });
    expect(partB.salarySection17_1).toMatchObject({ found: true, value: 2557983 });
  });

  it("matches the official 'Salary as per provisions contained in section 17(1)' wording", () => {
    expect(partB.salarySection17_1.found).toBe(true);
  });

  it("finds perquisites when the label wraps and the value sits on the item-marker line", () => {
    // "(b) 0.00" is a line of its own, between the two halves of the label.
    // Before Phase 10 this returned 12, from "Form No. 12BA" on the label line.
    expect(partB.perquisitesSection17_2).toMatchObject({ found: true, value: 0 });
  });

  it("matches 'Income chargeable under the head “Salaries”' despite the typographic quotes", () => {
    expect(partB.incomeChargeableUnderSalaries).toMatchObject({ found: true, value: 2325433 });
  });

  it("prefers item 19 'Net tax payable' over item 17 'Tax payable', which appears earlier", () => {
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: 483737 });
  });
});

describe("real TRACES Part A identity row — verbatim reconstructed lines", () => {
  it("returns the EMPLOYEE's PAN for the employee, not the deductor's, when both sit on one value row", () => {
    // The single most dangerous Part A collision: three labels on one row,
    // three bare values on the next. A plain next-line PAN search returns the
    // first PAN-shaped token for both PAN fields.
    const partA = parsePartA(
      textOf([
        "PAN of the Deductor\tTAN of the Deductor\tPAN of the Employee/Specified senior citizen",
        "AABCD9761D HYDD01619C ATOPM4017E",
      ])
    );
    expect(partA.employerPan).toMatchObject({ found: true, value: "AABCD9761D" });
    expect(partA.employeePan).toMatchObject({ found: true, value: "ATOPM4017E" });
    expect(partA.employerTan).toMatchObject({ found: true, value: "HYDD01619C" });
  });

  it("does not report the neighbouring employee column header as the employer's name or address", () => {
    const partA = parsePartA(
      textOf([
        "Name and address of the Employer/Specified Bank\tName and address of the Employee/Specified senior citizen",
      ])
    );
    expect(partA.employerName.found).toBe(false);
    expect(partA.employerAddress.found).toBe(false);
  });

  it("reads the quarterly total from the TRACES 'Total (Rs.)' row, taking the deposited column", () => {
    const partA = parsePartA(
      textOf([
        "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee",
        "Q1 QUNPAQMB 762578.00\t158446.00 158446.00",
        "Total (Rs.) 2557983.00\t483740.00 483740.00",
      ])
    );
    // The rightmost money column is "Amount of tax deposited/remitted"; the
    // leftmost (2557983.00) is the salary paid/credited, which must not be
    // reported as TDS.
    expect(partA.totalTdsDeposited).toMatchObject({ found: true, value: 483740 });
  });

  it("extracts the TRACES certificate number", () => {
    const partA = parsePartA(textOf(["Certificate No. SRXJVMA\tLast updated on 06-Jun-2026"]));
    expect(partA.certificateNumber).toMatchObject({ found: true, value: "SRXJVMA" });
  });

  it("does not mistake the 'Date on which tax deposited' challan column for an amount", () => {
    // The current official form words this column "Date on which tax
    // deposited" (the old one said "Date of tax deposit"). Only the latter was
    // guarded against before Phase 10.
    const partA = parsePartA(
      textOf(["Q1\tDate on which tax deposited 07-Jul-2025\tAmount of tax deposited: 25000"])
    );
    expect(partA.quarterlyTds[0]!.amountDeposited).toMatchObject({ found: true, value: 25000 });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: TRACES-standard Part A + Part B (Annexure-I)
// ---------------------------------------------------------------------------

describe("TRACES-standard Form 16 (Part A + Part B Annexure-I), end to end", () => {
  let partA: Form16PartA;
  let partB: Form16PartB;
  beforeAll(async () => {
    ({ partA, partB } = await parse(buildTracesForm16Pdf));
  });

  it("separates the employer and employee columns of the shared name/address block", () => {
    expect(partA.employerName).toMatchObject({ found: true, value: TRACES_FIXTURE.employerName });
    expect(partA.employeeName).toMatchObject({ found: true, value: TRACES_FIXTURE.employeeName });
  });

  it("aggregates the employer's multi-line address without pulling in the employee's", () => {
    expect(partA.employerAddress.found).toBe(true);
    if (!partA.employerAddress.found) return;
    for (const fragment of TRACES_FIXTURE.employerAddressLines) {
      expect(partA.employerAddress.value).toContain(fragment);
    }
    expect(partA.employerAddress.value).not.toContain(TRACES_FIXTURE.employeeName);
    expect(partA.employerAddress.value).not.toContain("MUBEEN COLONY");
  });

  it("extracts the three identity values from the shared row, each attributed correctly", () => {
    expect(partA.employerPan).toMatchObject({ found: true, value: TRACES_FIXTURE.employerPan });
    expect(partA.employerTan).toMatchObject({ found: true, value: TRACES_FIXTURE.employerTan });
    expect(partA.employeePan).toMatchObject({ found: true, value: TRACES_FIXTURE.employeePan });
  });

  it("extracts the assessment year and the employment period from the CIT/AY/period block", () => {
    expect(partA.assessmentYear).toMatchObject({ found: true, value: TRACES_FIXTURE.assessmentYear });
    expect(partA.periodFrom).toMatchObject({ found: true, value: TRACES_FIXTURE.periodFrom });
    expect(partA.periodTo).toMatchObject({ found: true, value: TRACES_FIXTURE.periodTo });
  });

  it("parses unlabelled quarterly rows positionally, including a nil-TDS quarter", () => {
    expect(partA.quarterlyTds).toHaveLength(4);
    partA.quarterlyTds.forEach((row, i) => {
      const expected = TRACES_FIXTURE.quarters[i]!;
      expect(row.quarter).toMatchObject({ found: true, value: expected.quarter });
      expect(row.amountDeposited).toMatchObject({ found: true, value: Number(expected.deposited) });
      expect(row.receiptNumber).toMatchObject({ found: true, value: expected.receipt });
    });
    // Q3 is a genuine nil quarter — 0 must be reported as 0, not as not-found.
    expect(partA.quarterlyTds[2]!.amountDeposited).toMatchObject({ found: true, value: 0 });
  });

  it("does NOT invent a per-quarter BSR code or deposit date on this layout", () => {
    // A TRACES Part A lists BSR code and deposit date once per challan (twelve
    // monthly challans against four quarters in the real document), so there
    // is no honest 1:1 attribution. Reporting nothing is the correct answer;
    // the row's money columns contain 7-digit-shaped figures that a weaker
    // fallback would happily return as a BSR code.
    for (const row of partA.quarterlyTds) {
      expect(row.bsrCode.found).toBe(false);
      expect(row.depositDate.found).toBe(false);
    }
  });

  it("reads the quarterly total row", () => {
    expect(partA.totalTdsDeposited).toMatchObject({ found: true, value: TRACES_FIXTURE.totalTdsDeposited });
  });

  it("extracts the certificate number", () => {
    expect(partA.certificateNumber).toMatchObject({ found: true, value: TRACES_FIXTURE.certificateNumber });
  });

  it("reads gross salary from 1(d) Total even though 1(a) differs from it", () => {
    expect(partB.grossSalary).toMatchObject({ found: true, value: TRACES_FIXTURE.grossSalary });
    expect(partB.salarySection17_1).toMatchObject({ found: true, value: TRACES_FIXTURE.salarySection17_1 });
    expect(partB.perquisitesSection17_2).toMatchObject({
      found: true,
      value: TRACES_FIXTURE.perquisitesSection17_2,
    });
  });

  it("extracts the numbered Part B computation rows", () => {
    expect(partB.exemptionHra).toMatchObject({ found: true, value: TRACES_FIXTURE.exemptionHra });
    expect(partB.standardDeduction).toMatchObject({ found: true, value: TRACES_FIXTURE.standardDeduction });
    expect(partB.professionalTax).toMatchObject({ found: true, value: TRACES_FIXTURE.professionalTax });
    expect(partB.incomeChargeableUnderSalaries).toMatchObject({
      found: true,
      value: TRACES_FIXTURE.incomeChargeableUnderSalaries,
    });
    expect(partB.grossTotalIncome).toMatchObject({ found: true, value: TRACES_FIXTURE.grossTotalIncome });
    expect(partB.totalTaxableIncome).toMatchObject({ found: true, value: TRACES_FIXTURE.totalTaxableIncome });
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: TRACES_FIXTURE.totalTaxByEmployer });
    expect(partB.totalChapterViaDeductions).toMatchObject({
      found: true,
      value: TRACES_FIXTURE.totalChapterViaDeductions,
    });
  });

  it("pairs wrapped Chapter VI-A labels with their amounts, keeps '80CCD (1B)' distinct, skips the sub-total row, and takes the DEDUCTIBLE column", () => {
    expect(partB.chapterViaDeductions.map((l) => (l.section.found ? l.section.value : null))).toEqual([
      "80C",
      "80CCD(1B)",
      "80D",
    ]);
    expect(partB.chapterViaDeductions.map((l) => (l.amount.found ? l.amount.value : null))).toEqual([
      150000, 50000, 25000,
    ]);
    // 80D's gross amount is 31000 and its deductible amount 25000 — only the
    // deductible figure belongs in a return.
  });

  it("reports fields the certificate genuinely does not contain as not-found", () => {
    expect(partB.exemptionTransport.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: payroll-software-generated Part B
// ---------------------------------------------------------------------------

describe("payroll-software-generated Part B (Particulars/Amount table, Indian digit grouping)", () => {
  let partA: Form16PartA;
  let partB: Form16PartB;
  beforeAll(async () => {
    ({ partA, partB } = await parse(buildPayrollVendorForm16Pdf));
  });

  it("parses Indian comma grouping and 'Rs.' prefixes", () => {
    expect(partB.grossSalary).toMatchObject({ found: true, value: PAYROLL_FIXTURE.grossSalary });
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: PAYROLL_FIXTURE.totalTaxByEmployer });
    expect(partA.totalTdsDeposited).toMatchObject({ found: true, value: PAYROLL_FIXTURE.totalTdsDeposited });
  });

  it("takes the EXEMPT portion of HRA and LTA, not the gross salary component of the same name", () => {
    // The document lists "House Rent Allowance Rs. 5,40,000" as a salary
    // component and "HRA Exemption u/s 10(13A) Rs. 3,84,000" as the exemption.
    // The gross line comes first, and returning it would overstate the
    // exemption by 1,56,000.
    expect(partB.exemptionHra).toMatchObject({ found: true, value: PAYROLL_FIXTURE.exemptionHra });
    expect(partB.exemptionLta).toMatchObject({ found: true, value: PAYROLL_FIXTURE.exemptionLta });
  });

  it("reads separate employer name and address labels", () => {
    expect(partA.employerName).toMatchObject({ found: true, value: PAYROLL_FIXTURE.employerName });
    expect(partA.employerAddress.found).toBe(true);
    expect(partA.employeeName).toMatchObject({ found: true, value: PAYROLL_FIXTURE.employeeName });
  });

  it("takes the deductible column of the Chapter VI-A table, not the gross column", () => {
    expect(partB.chapterViaDeductions.map((l) => (l.amount.found ? l.amount.value : null))).toEqual([
      150000, 25000, 50000,
    ]);
    expect(partB.chapterViaDeductions.map((l) => (l.section.found ? l.section.value : null))).toEqual([
      "80C",
      "80D",
      "80CCD(1B)",
    ]);
  });

  it("reports genuinely-absent fields as not-found rather than borrowing a neighbour", () => {
    // This Part B carries no Part A, no employer PAN and no employment period.
    expect(partA.employerPan.found).toBe(false);
    expect(partA.periodFrom.found).toBe(false);
    expect(partA.periodTo.found).toBe(false);
    expect(partA.certificateNumber?.found).toBe(false);
    // It also never breaks salary down by section 17 sub-clause.
    expect(partB.salarySection17_1.found).toBe(false);
    expect(partB.perquisitesSection17_2.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: government/treasury-generated Part B
// ---------------------------------------------------------------------------

describe("government/treasury-generated Part B (old numbering, locally-invented wording)", () => {
  let partA: Form16PartA;
  let partB: Form16PartB;
  beforeAll(async () => {
    ({ partA, partB } = await parse(buildTreasuryStyleForm16Pdf));
  });

  it("separates 'Name and address of the Employer' from 'Name and Designation of the Employee'", () => {
    expect(partA.employerName).toMatchObject({ found: true, value: TREASURY_FIXTURE.employerName });
    expect(partA.employeeName).toMatchObject({ found: true, value: TREASURY_FIXTURE.employeeName });
  });

  it("handles this generator's own row wording", () => {
    // "Prof. Tax on Employment", "Total Income rounded off to nearest multiple
    // of ten rupees ( 9 - 11 )", "Total Income Tax for the Year (17-18)",
    // "Aggregate of deductible amount (10A + 10B)" — none of which match the
    // statutory phrasing.
    expect(partB.professionalTax).toMatchObject({ found: true, value: TREASURY_FIXTURE.professionalTax });
    expect(partB.totalTaxableIncome).toMatchObject({ found: true, value: TREASURY_FIXTURE.totalTaxableIncome });
    expect(partB.totalTaxByEmployer).toMatchObject({ found: true, value: TREASURY_FIXTURE.totalTaxByEmployer });
    expect(partB.totalChapterViaDeductions).toMatchObject({
      found: true,
      value: TREASURY_FIXTURE.totalChapterViaDeductions,
    });
  });

  it("reads gross salary from the block's unnumbered 'Total' row", () => {
    expect(partB.grossSalary).toMatchObject({ found: true, value: TREASURY_FIXTURE.grossSalary });
  });

  it("extracts Chapter VI-A rows whose section code trails a descriptive label", () => {
    expect(partB.chapterViaDeductions.map((l) => (l.section.found ? l.section.value : null))).toEqual([
      "80C",
      "80CCD(1B)",
      "80D",
    ]);
    expect(partB.chapterViaDeductions.map((l) => (l.amount.found ? l.amount.value : null))).toEqual([
      150000, 50000, 18500,
    ]);
  });

  it("does not invent an assessment year or TDS total that this Part B never states", () => {
    expect(partA.assessmentYear.found).toBe(false);
    expect(partA.totalTdsDeposited.found).toBe(false);
    expect(partA.quarterlyTds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a second employer's certificate for the same employee
// ---------------------------------------------------------------------------

describe("second employer's Form 16 after a mid-year job change", () => {
  let partA: Form16PartA;
  let partB: Form16PartB;
  beforeAll(async () => {
    ({ partA, partB } = await parse(buildSecondEmployerForm16Pdf));
  });

  it("parses standalone, with its own employer and its own shorter period", () => {
    expect(partA.employerName).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.employerName });
    expect(partA.employerTan).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.employerTan });
    expect(partA.employeePan).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.employeePan });
    expect(partA.periodFrom).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.periodFrom });
    expect(partA.periodTo).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.periodTo });
  });

  it("reports only the two quarters this employer actually deducted in", () => {
    expect(partA.quarterlyTds.map((r) => (r.quarter.found ? r.quarter.value : null))).toEqual(["Q3", "Q4"]);
    expect(partA.totalTdsDeposited).toMatchObject({
      found: true,
      value: SECOND_EMPLOYER_FIXTURE.totalTdsDeposited,
    });
  });

  it("reports the absent employer PAN column as not-found rather than reusing the employee's PAN", () => {
    expect(partA.employerPan.found).toBe(false);
    expect(partA.employeePan).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.employeePan });
  });

  it("reports the many Part B rows this minimal certificate omits as not-found", () => {
    expect(partB.grossSalary).toMatchObject({ found: true, value: SECOND_EMPLOYER_FIXTURE.grossSalary });
    expect(partB.exemptionHra.found).toBe(false);
    expect(partB.professionalTax.found).toBe(false);
    expect(partB.incomeChargeableUnderSalaries.found).toBe(false);
    expect(partB.grossTotalIncome.found).toBe(false);
    expect(partB.chapterViaDeductions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: the parser must never confidently return a wrong number
// ---------------------------------------------------------------------------

describe("reference-aware amount extraction", () => {
  it("never returns a section number, clause letter or cross-reference formula as an amount", () => {
    const partB = parsePartB(
      textOf([
        "(e) House rent allowance under section 10(13A)",
        "(a) Standard deduction under section 16(ia)",
        "6. Income chargeable under the head “Salaries” [(3+1(e)-5]",
        "9. Gross total income (6+8)",
        "12. Total taxable income (9-11)",
        "19. Net tax payable (17-18)",
      ])
    );
    // Not one of these rows carries a figure. Every field must say so rather
    // than return 10, 16, 3, 6, 9 or 17.
    expect(partB.exemptionHra.found).toBe(false);
    expect(partB.standardDeduction.found).toBe(false);
    expect(partB.incomeChargeableUnderSalaries.found).toBe(false);
    expect(partB.grossTotalIncome.found).toBe(false);
    expect(partB.totalTaxableIncome.found).toBe(false);
    expect(partB.totalTaxByEmployer.found).toBe(false);
  });

  it("still reads a genuine amount that follows a statutory reference on the same row", () => {
    const partB = parsePartB(textOf(["(a) Standard deduction under section 16(ia)\t75000.00"]));
    expect(partB.standardDeduction).toMatchObject({ found: true, value: 75000 });
  });

  it("does not treat a date or an assessment year as an amount", () => {
    const partA = parsePartA(
      textOf(["Total amount of tax deposited 01-Apr-2025"])
    );
    expect(partA.totalTdsDeposited.found).toBe(false);
  });

  it("reports 0.00 as a found zero, never as not-found", () => {
    const partB = parsePartB(textOf(["(e) House rent allowance under section 10(13A)\t0.00"]));
    expect(partB.exemptionHra).toMatchObject({ found: true, value: 0 });
  });

  it("drops to medium confidence when a row offers several candidate columns", () => {
    const partB = parsePartB(textOf(["Gross Salary\t1200000\t1800000"]));
    expect(partB.grossSalary).toMatchObject({ found: true, confidence: "medium" });
  });
});
