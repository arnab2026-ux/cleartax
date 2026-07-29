import type { ExtractedDocumentText, Form16PartA, QuarterlyTds } from "./types";
import { foundField, notFound } from "./types";
import {
  AMOUNT_REGEX,
  ASSESSMENT_YEAR_REGEX,
  BSR_CODE_REGEX,
  DATE_REGEX,
  PAN_REGEX,
  TAN_REGEX,
  findLabeledAmount,
  findLabeledValue,
  parseIndianAmount,
} from "./parseUtils";

const QUARTER_ROW_REGEX = /\bQ(?:uarter)?\s*[-.:]?\s*([1-4])\b/i;

/**
 * Heuristically extract Part A (TDS certificate) fields from a Form 16's
 * reconstructed text. Every field is an `ExtractedField`, never a bare
 * value — nothing here should be trusted without human review.
 */
export function parsePartA(text: ExtractedDocumentText): Form16PartA {
  const lines = text.fullText.split("\n");

  const employerName = findLabeledValue(
    lines,
    [/name\s*(?:and\s*address)?\s*of\s*(?:the\s*)?employer/i, /name\s*of\s*(?:the\s*)?deductor/i],
    /^(.+)$/
  );

  const employerAddress = findLabeledValue(
    lines,
    [/address\s*of\s*(?:the\s*)?employer/i, /address\s*of\s*(?:the\s*)?deductor/i],
    /^(.+)$/
  );

  const employerTan = findLabeledValue(
    lines,
    [/tan\s*of\s*(?:the\s*)?(?:employer|deductor)/i],
    TAN_REGEX
  );

  const employerPan = findLabeledValue(
    lines,
    [/pan\s*of\s*(?:the\s*)?(?:employer|deductor)/i],
    PAN_REGEX
  );

  const employeeName = findLabeledValue(
    lines,
    [/name\s*of\s*(?:the\s*)?employee/i, /name\s*of\s*(?:the\s*)?taxpayer/i],
    /^(.+)$/
  );

  const employeePan = findLabeledValue(
    lines,
    [/pan\s*of\s*(?:the\s*)?employee/i, /pan\s*of\s*(?:the\s*)?taxpayer/i],
    PAN_REGEX
  );

  const assessmentYear = findLabeledValue(
    lines,
    [/assessment\s*year/i],
    ASSESSMENT_YEAR_REGEX
  );

  const periodFrom = findLabeledValue(
    lines,
    [/period\s*(?:with\s*the\s*employer\s*)?from/i],
    DATE_REGEX
  );
  const periodTo = findLabeledValue(lines, [/\bto\b.*\d{4}|period.*to/i], DATE_REGEX);

  const quarterlyTds = parseQuarterlyTdsRows(lines);

  const totalTdsDeposited = findLabeledAmount(lines, [
    /total\s*(?:amount\s*of\s*)?tax\s*deposited/i,
    /total\s*tds/i,
  ]);

  return {
    employerName,
    employerAddress,
    employerTan,
    employerPan,
    employeeName,
    employeePan,
    assessmentYear,
    periodFrom,
    periodTo,
    quarterlyTds,
    totalTdsDeposited,
  };
}

function parseQuarterlyTdsRows(lines: string[]): QuarterlyTds[] {
  const rows: QuarterlyTds[] = [];

  for (const line of lines) {
    const quarterMatch = line.match(QUARTER_ROW_REGEX);
    if (!quarterMatch || !quarterMatch[1]) continue;

    const quarter = foundField(`Q${quarterMatch[1]}`, "high" as const, line);

    // Prefer an explicit "amount deposited/remitted" figure; fall back to
    // "tax deducted" as a proxy (usually equal in practice, but not
    // guaranteed — hence the lower confidence) if the more specific label
    // isn't present on this row.
    //
    // The negative lookbehind excludes "Date of tax deposit" (a real,
    // confirmed collision found during testing: that column header also
    // contains the substring "tax deposit", so the unqualified pattern
    // matched it and extracted the *day* out of the deposit date as if it
    // were the deposited amount).
    let amountDeposited = findLabeledValue(
      [line],
      [/(?<!date\s*of\s*)(?:amount\s*of\s*)?tax\s*deposit(?:ed)?(?:\s*\/\s*remitted)?/i, /deposited/i],
      AMOUNT_REGEX
    );
    if (!amountDeposited.found) {
      const fallback = findLabeledValue([line], [/tax\s*deduct(?:ed)?/i], AMOUNT_REGEX);
      if (fallback.found) {
        amountDeposited = foundField(fallback.value, "medium", fallback.sourceText);
      }
    }
    const amountDepositedNumber = amountDeposited.found
      ? (() => {
          const parsed = parseIndianAmount(amountDeposited.value);
          return parsed === undefined
            ? notFound<number>("matched text did not parse as a number")
            : foundField(parsed, amountDeposited.confidence, amountDeposited.sourceText);
        })()
      : notFound<number>(amountDeposited.reason);

    const receiptNumber = findLabeledValue([line], [/receipt\s*no\.?/i], /(\d{6,})/);

    let bsrCode = findLabeledValue([line], [/bsr\s*code/i], BSR_CODE_REGEX);
    if (!bsrCode.found) {
      // Weak fallback: any bare 7-digit token on the row. Low confidence —
      // could just as easily be part of another figure.
      const anyBsrLike = line.match(BSR_CODE_REGEX);
      bsrCode = anyBsrLike
        ? foundField(anyBsrLike[1] ?? anyBsrLike[0], "low", line)
        : notFound("no 7-digit BSR-code-shaped token found on this row");
    }

    const depositDate = findLabeledValue(
      [line],
      [/date\s*of\s*(?:tax\s*)?deposit/i],
      DATE_REGEX
    );

    rows.push({
      quarter,
      amountDeposited: amountDepositedNumber,
      receiptNumber,
      bsrCode,
      depositDate,
    });
  }

  return rows;
}
