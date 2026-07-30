/**
 * Helpers for the `/form16/review/[id]` screen — the mandatory human
 * review/edit step PROGRESS.md's Phase 3 notes call out as load-bearing,
 * not optional, for `packages/pdf-form16`'s heuristic output. Two jobs:
 *  1. Flatten every `ExtractedField<T>` in a `Form16ParseResult` into a
 *     uniform, renderable shape (label + found/value/confidence/sourceText)
 *     so the review UI can render one generic table instead of hand-writing
 *     a row per field.
 *  2. Compute sensible default values for the editable `SalaryIncome` form
 *     from whatever the parser did manage to extract — `.value` when
 *     `found`, a safe fallback (0 / "") when not, NEVER a guess.
 */
import type { Confidence, ExtractedField, Form16PartA, Form16PartB } from "@cleartax/pdf-form16";
import type { SalaryIncomeFormValues } from "./validation/salaryIncome";

export interface ReviewFieldRow {
  key: string;
  label: string;
  found: boolean;
  value: string;
  confidence: Confidence | null;
  sourceText: string | null;
  reason: string | null;
}

function fieldRow<T>(key: string, label: string, field: ExtractedField<T>): ReviewFieldRow {
  if (field.found) {
    return {
      key,
      label,
      found: true,
      value: field.value === null || field.value === undefined ? "" : String(field.value),
      confidence: field.confidence,
      sourceText: field.sourceText ?? null,
      reason: null,
    };
  }
  return {
    key,
    label,
    found: false,
    value: "",
    confidence: null,
    sourceText: null,
    reason: field.reason ?? null,
  };
}

/** Every Part A field except the per-quarter TDS table (rendered separately — see `flattenQuarterlyTds`), flattened for display. */
export function flattenPartA(partA: Form16PartA): ReviewFieldRow[] {
  return [
    fieldRow("employerName", "Employer name", partA.employerName),
    fieldRow("employerAddress", "Employer address", partA.employerAddress),
    fieldRow("employerTan", "Employer TAN", partA.employerTan),
    fieldRow("employerPan", "Employer PAN", partA.employerPan),
    fieldRow("employeeName", "Employee name", partA.employeeName),
    fieldRow("employeePan", "Employee PAN", partA.employeePan),
    fieldRow("assessmentYear", "Assessment year (as printed)", partA.assessmentYear),
    fieldRow("periodFrom", "Period from", partA.periodFrom),
    fieldRow("periodTo", "Period to", partA.periodTo),
    fieldRow("totalTdsDeposited", "Total TDS deposited", partA.totalTdsDeposited),
  ];
}

export function flattenQuarterlyTds(partA: Form16PartA): { quarter: string; rows: ReviewFieldRow[] }[] {
  return partA.quarterlyTds.map((q, index) => ({
    quarter: q.quarter.found ? q.quarter.value : `Row ${index + 1}`,
    rows: [
      fieldRow("amountDeposited", "Amount deposited", q.amountDeposited),
      fieldRow("receiptNumber", "Receipt number", q.receiptNumber),
      fieldRow("bsrCode", "BSR code", q.bsrCode),
      fieldRow("depositDate", "Deposit date", q.depositDate),
    ],
  }));
}

/** Every Part B field except the Chapter VI-A line items (rendered separately — see `flattenChapterViaLines`), flattened for display. */
export function flattenPartB(partB: Form16PartB): ReviewFieldRow[] {
  return [
    fieldRow("grossSalary", "Gross salary", partB.grossSalary),
    fieldRow("salarySection17_1", "Salary u/s 17(1)", partB.salarySection17_1),
    fieldRow("perquisitesSection17_2", "Perquisites u/s 17(2)", partB.perquisitesSection17_2),
    fieldRow("profitsInLieuSection17_3", "Profits in lieu u/s 17(3)", partB.profitsInLieuSection17_3),
    fieldRow("exemptionHra", "HRA exemption (as per Form 16)", partB.exemptionHra),
    fieldRow("exemptionLta", "LTA exemption", partB.exemptionLta),
    fieldRow("exemptionTransport", "Other exemptions", partB.exemptionTransport),
    fieldRow("standardDeduction", "Standard deduction", partB.standardDeduction),
    fieldRow("professionalTax", "Professional tax", partB.professionalTax),
    fieldRow("incomeChargeableUnderSalaries", "Income chargeable under salaries", partB.incomeChargeableUnderSalaries),
    fieldRow("totalChapterViaDeductions", "Total Chapter VI-A deductions", partB.totalChapterViaDeductions),
    fieldRow("grossTotalIncome", "Gross total income", partB.grossTotalIncome),
    fieldRow("totalTaxableIncome", "Total taxable income", partB.totalTaxableIncome),
    fieldRow("totalTaxByEmployer", "Total tax (as computed by employer)", partB.totalTaxByEmployer),
  ];
}

export function flattenChapterViaLines(partB: Form16PartB): { section: string; rows: ReviewFieldRow[] }[] {
  return partB.chapterViaDeductions.map((line, index) => ({
    section: line.section.found ? line.section.value : `Line ${index + 1}`,
    rows: [fieldRow("amount", "Amount", line.amount)],
  }));
}

function numericValue(field: ExtractedField<number>): number {
  return field.found ? field.value : 0;
}

function stringValue(field: ExtractedField<string>): string {
  return field.found ? field.value : "";
}

/**
 * Default values for the editable `SalaryIncomeFormValues` form,
 * pre-populated from whatever the parser extracted. `basicSalary`,
 * `hraReceived`, `rentPaid`, and `isMetroCity` are deliberately NOT
 * derivable from a Form 16 at all (it states neither rent paid nor the
 * employee's city) — these default to 0/false with the review UI expected
 * to prompt the user to fill them in manually for an accurate HRA
 * exemption, per `SalaryIncome`'s own schema doc comment.
 */
export function defaultSalaryFromForm16(partA: Form16PartA, partB: Form16PartB): SalaryIncomeFormValues {
  return {
    employerName: stringValue(partA.employerName),
    grossSalary: numericValue(partB.grossSalary),
    basicSalary: 0,
    hraReceived: 0,
    rentPaid: 0,
    isMetroCity: false,
    ltaReceived: 0,
    otherAllowances: 0,
    perquisitesValue: numericValue(partB.perquisitesSection17_2),
    exemptHra: numericValue(partB.exemptionHra),
    exemptLta: numericValue(partB.exemptionLta),
    exemptOther: numericValue(partB.exemptionTransport),
    standardDeduction: numericValue(partB.standardDeduction),
    professionalTax: numericValue(partB.professionalTax),
    tdsDeducted: numericValue(partA.totalTdsDeposited),
  };
}

/**
 * A `Form16Upload` should be marked `NEEDS_REVIEW` (rather than the more
 * confident `PARSED`) when any of the fields that matter most for an
 * accurate tax computation weren't found at all, or were found only at
 * "low" confidence — surfaced as a banner on the review screen so the user
 * knows to look closely rather than rubber-stamping the defaults.
 */
export function needsReview(partB: Form16PartB): boolean {
  const critical = [partB.grossSalary, partB.standardDeduction, partB.totalTaxableIncome];
  return critical.some((f) => !f.found || f.confidence === "low");
}
