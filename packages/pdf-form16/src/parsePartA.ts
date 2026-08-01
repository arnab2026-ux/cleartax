import type { ExtractedDocumentText, ExtractedField, Form16PartA, QuarterlyTds } from "./types";
import { foundField, notFound } from "./types";
import {
  ASSESSMENT_YEAR_REGEX,
  BSR_CODE_REGEX,
  DATE_REGEX,
  PAN_REGEX,
  RECEIPT_TOKEN_REGEX,
  TAN_REGEX,
  collectAmountsAfter,
  findLabeledAmountColumnAware,
  findLabeledBlock,
  findLabeledValue,
  findLabeledValueAhead,
  findOrdinalLabeledValue,
  looksLikeColumnHeader,
  maskNonAmountText,
  parseIndianAmount,
} from "./parseUtils";

const QUARTER_ROW_REGEX = /\bQ(?:uarter)?\s*[-.:]?\s*([1-4])\b/i;

/**
 * Labels on a real TRACES Part A carry a "/Specified Bank" or "/Specified
 * senior citizen" qualifier (added by the 2021 amendment that folded section
 * 194P into the same certificate). Consuming the qualifier as part of the
 * label keeps it out of the captured value.
 */
const EMPLOYER_NAME_LABELS = [
  /name\s*(?:and\s*address\s*)?of\s*(?:the\s*)?employer(?:\s*\/\s*specified\s*bank)?/i,
  /name\s*(?:and\s*address\s*)?of\s*(?:the\s*)?deductor/i,
];
const EMPLOYEE_NAME_LABELS = [
  /name\s*(?:and\s*address\s*)?of\s*(?:the\s*)?employee(?:\s*\/\s*specified\s*senior\s*citizen)?/i,
  /name\s*(?:and\s*designation\s*)?of\s*(?:the\s*)?employee/i,
  /name\s*of\s*(?:the\s*)?taxpayer/i,
];

/** Every "PAN of <someone>" label, used to work out which PAN on a shared value row is ours. */
const ANY_PAN_LABEL = /pan\s*of\s*(?:the\s*)?(?:deductor|employer|employee|taxpayer|specified)/;
const ANY_TAN_LABEL = /tan\s*of\s*(?:the\s*)?(?:deductor|employer)/;
/** Both halves of the standard side-by-side party block, used to find where the employer's column ends and the employee's begins. */
const ANY_PARTY_NAME_LABEL =
  /name\s*(?:and\s*\w+\s*)?of\s*(?:the\s*)?(?:employer|employee|deductor|taxpayer)/;

/**
 * Heuristically extract Part A (TDS certificate) fields from a Form 16's
 * reconstructed text. Every field is an `ExtractedField`, never a bare
 * value — nothing here should be trusted without human review.
 */
export function parsePartA(text: ExtractedDocumentText): Form16PartA {
  const lines = text.fullText.split("\n");
  // `fullText` is every page's lines joined in order, so this parallel array
  // lines up index-for-index and gives the column helpers x positions to work
  // with. Callers that synthesise an `ExtractedDocumentText` from bare strings
  // pass no pages, and everything degrades to the tab-based path.
  const positioned = text.pages.flatMap((page) => page.lines);

  const employerBlock = findLabeledBlock(lines, EMPLOYER_NAME_LABELS, 6, positioned, ANY_PARTY_NAME_LABEL);
  const employeeBlock = findLabeledBlock(lines, EMPLOYEE_NAME_LABELS, 6, positioned, ANY_PARTY_NAME_LABEL);

  // An explicitly separate "Address of the Employer" label, where one exists,
  // wins over the address lines aggregated out of the combined block.
  //
  // The lookbehind matters: without it this pattern fires inside the *combined*
  // TRACES label "Name and address of the Employer", captures whatever follows
  // it on that line — which is the neighbouring "Name and address of the
  // Employee" header — and reports it as the employer's address at high
  // confidence.
  const explicitEmployerAddressRaw = findLabeledValue(
    lines,
    [
      /(?<!name\s{0,3}and\s{0,3})address\s*of\s*(?:the\s*)?employer/i,
      /(?<!name\s{0,3}and\s{0,3})address\s*of\s*(?:the\s*)?deductor/i,
    ],
    /^(.+)$/
  );
  const explicitEmployerAddress =
    explicitEmployerAddressRaw.found && looksLikeColumnHeader(explicitEmployerAddressRaw.value)
      ? notFound<string>("the only 'address of the employer' match was another column's header")
      : explicitEmployerAddressRaw;

  const employerTan = findOrdinalLabeledValue(
    lines,
    [/tan\s*of\s*(?:the\s*)?(?:employer|deductor)/i],
    ANY_TAN_LABEL,
    TAN_REGEX
  );

  const employerPan = findOrdinalLabeledValue(
    lines,
    [/pan\s*of\s*(?:the\s*)?(?:employer|deductor)/i],
    ANY_PAN_LABEL,
    PAN_REGEX
  );

  const employeePan = findOrdinalLabeledValue(
    lines,
    [/pan\s*of\s*(?:the\s*)?(?:employee|taxpayer)/i],
    ANY_PAN_LABEL,
    PAN_REGEX
  );

  const assessmentYear = findLabeledValueAhead(lines, [/assessment\s*year/i], ASSESSMENT_YEAR_REGEX, 5);

  const { periodFrom, periodTo } = parseEmploymentPeriod(lines);
  const quarterlyTds = parseQuarterlyTdsRows(lines);
  const totalTdsDeposited = parseTotalTdsDeposited(lines);

  // Part A's TRACES certificate number. Not persisted anywhere (no schema
  // column) but surfaced because it is the one field that distinguishes a
  // genuine TRACES-issued Part A from a self-typed one, which has no legal
  // validity — useful provenance for the review screen.
  const certificateNumber = findLabeledValue(
    lines,
    [/certificate\s*(?:no\.?|number)/i],
    RECEIPT_TOKEN_REGEX
  );

  return {
    employerName: employerBlock.first,
    employerAddress: explicitEmployerAddress.found ? explicitEmployerAddress : employerBlock.rest,
    employerTan,
    employerPan,
    employeeName: employeeBlock.first,
    employeePan,
    assessmentYear,
    periodFrom,
    periodTo,
    quarterlyTds,
    totalTdsDeposited,
    certificateNumber,
  };
}

/**
 * "Period with the Employer" appears three ways across the layouts examined:
 * as "Period with the Employer From <date>" / "... To <date>" on separate
 * lines; as a bare "From\tTo" header row with both dates on a row below
 * (TRACES); or with both dates on one row.
 *
 * The previous `periodTo` pattern `/\bto\b.*\d{4}|period.*to/i` is replaced
 * rather than extended: "to" followed anywhere by four digits matches ordinary
 * prose, including the certificate's own "...section 203 of the Income-tax
 * Act, 1961..." preamble, so it could return an arbitrary date from anywhere
 * in the document.
 */
function parseEmploymentPeriod(lines: string[]): {
  periodFrom: ExtractedField<string>;
  periodTo: ExtractedField<string>;
} {
  let periodFrom = findLabeledValue(
    lines,
    [/period\s*(?:with\s*the\s*employer\s*)?[:\s-]*from/i],
    DATE_REGEX
  );
  let periodTo = findLabeledValue(
    lines,
    [/period\s*(?:with\s*the\s*employer\s*)?[:\s-]*to\b/i],
    DATE_REGEX
  );
  if (periodFrom.found && periodTo.found) return { periodFrom, periodTo };

  // Header-row layout: anchor on the heading, then take the first row below it
  // carrying two dates. Both come from one row, so their order is unambiguous.
  const anchor = lines.findIndex(
    (line) => /period\s*with\s*the\s*employer/i.test(line) || /^\s*from\b[\s\t]*to\s*$/i.test(line)
  );
  if (anchor >= 0) {
    for (let i = anchor; i < Math.min(lines.length, anchor + 8); i++) {
      const dates = [...lines[i]!.matchAll(new RegExp(DATE_REGEX.source, "g"))];
      if (dates.length < 2) continue;
      if (!periodFrom.found) periodFrom = foundField(dates[0]![1] ?? dates[0]![0], "medium", lines[i]!);
      if (!periodTo.found) periodTo = foundField(dates[1]![1] ?? dates[1]![0], "medium", lines[i]!);
      break;
    }
  }

  return { periodFrom, periodTo };
}

function toAmount(
  raw: string,
  confidence: "high" | "medium" | "low",
  sourceText: string
): ExtractedField<number> {
  const parsed = parseIndianAmount(raw);
  return parsed === undefined
    ? notFound<number>(`matched text "${raw}" did not parse as a number`)
    : foundField(parsed, confidence, sourceText);
}

/**
 * The quarterly summary's total row. On a real TRACES Part A this row reads
 * "Total (Rs.)" followed by three figures (amount paid/credited, tax deducted,
 * tax deposited/remitted) — none of the existing labels appear on it at all,
 * so the total was simply never found on a genuine certificate. Anchoring on
 * the "Summary of amount paid/credited..." heading and stopping at the next
 * section keeps this away from the *challan* table's own "Total (Rs.)" row.
 */
function parseTotalTdsDeposited(lines: string[]): ExtractedField<number> {
  const labelled = findLabeledAmountColumnAware(lines, [
    /total\s*(?:amount\s*of\s*)?tax\s*deposited/i,
    /total\s*tds/i,
  ]);
  if (labelled.found) return labelled;

  const summaryAt = lines.findIndex((line) =>
    /summary\s*of\s*(?:the\s*)?amount\s*paid|summary\s*of\s*tax\s*deducted/i.test(line)
  );
  if (summaryAt < 0) return labelled;

  for (let i = summaryAt + 1; i < lines.length; i++) {
    if (/details\s*of\s*tax\s*deducted\s*and\s*deposited/i.test(lines[i]!)) break;
    if (!/^\s*total\s*\(\s*rs\.?\s*\)/i.test(lines[i]!)) continue;
    const candidates = collectAmountsAfter(lines[i]!, 0);
    if (candidates.length === 0) continue;
    return toAmount(candidates[candidates.length - 1]!.raw, "medium", lines[i]!);
  }
  return labelled;
}

/** Column labels that mark a quarterly row as *self-labelling* (each cell restates its header). */
const ROW_HAS_INLINE_LABELS = /receipt\s*no|bsr\s*code|tax\s*deposit|tax\s*deduct|date\s*of/i;

const NO_PER_QUARTER_BSR =
  "not stated per quarter on this layout — a TRACES Part A lists BSR code and " +
  "deposit date once per challan (often monthly), not once per quarter, so " +
  "there is no reliable way to attribute one to this quarter";

function parseQuarterlyTdsRows(lines: string[]): QuarterlyTds[] {
  const rows: QuarterlyTds[] = [];

  for (const line of lines) {
    const quarterMatch = line.match(QUARTER_ROW_REGEX);
    if (!quarterMatch || !quarterMatch[1]) continue;

    const quarter = foundField(`Q${quarterMatch[1]}`, "high" as const, line);
    const selfLabelled = ROW_HAS_INLINE_LABELS.test(line);

    // ---- Self-labelling layout (each cell restates its column header) ----
    //
    // The negative lookbehinds exclude the challan table's date column, whose
    // header reads "Date of tax deposit" on the old form and "Date on which
    // tax deposited" on the current one — both contain the substring this
    // pattern looks for. The "date of" spelling was found by testing; the "on
    // which" spelling is confirmed by the official revised form and by a real
    // TRACES certificate, so it is no longer a speculative guard.
    let amountDeposited = findLabeledAmountColumnAware(
      [line],
      [
        /(?<!date\s*of\s*)(?<!on\s*which\s*)(?:amount\s*of\s*)?tax\s*deposit(?:ed)?(?:\s*\/\s*remitted)?/i,
        /deposited/i,
      ]
    );
    if (!amountDeposited.found) {
      const fallback = findLabeledAmountColumnAware([line], [/tax\s*deduct(?:ed)?/i]);
      if (fallback.found) {
        amountDeposited = foundField(fallback.value, "medium", fallback.sourceText);
      }
    }

    let receiptNumber = findLabeledValue(
      [line],
      [/receipt\s*no\.?/i],
      // Anchored + guarded against crossing into a *different* known column's
      // own label (BSR Code / Date of tax deposit). Without this, a row whose
      // receipt number is genuinely blank falls through to whatever digit run
      // comes next and silently reports the adjacent BSR code instead.
      /^(?:(?!bsr\s*code|date\s*of).)*?(\d{6,})/i
    );

    let bsrCode = findLabeledValue([line], [/bsr\s*code/i], BSR_CODE_REGEX);
    const depositDate = findLabeledValue([line], [/date\s*of\s*(?:tax\s*)?deposit/i], DATE_REGEX);

    // ---- Bare positional layout (TRACES) ----
    //
    // A real TRACES quarterly row carries no labels at all; the headers sit in
    // a separate, often multi-line block above it. A row looks like
    //   "Q1 QUNPAQMB 762578.00\t158446.00 158446.00"
    // i.e. quarter, 8-character statement receipt number, amount paid/
    // credited, tax deducted, tax deposited/remitted. This branch only runs
    // when the row carries no inline labels, so it can never override the
    // self-labelling path above.
    if (!selfLabelled) {
      const afterQuarter = (quarterMatch.index ?? 0) + quarterMatch[0].length;

      if (!amountDeposited.found) {
        const candidates = collectAmountsAfter(line, afterQuarter);
        if (candidates.length > 0) {
          // Rightmost money column: on every layout examined the deposited/
          // remitted figure is the last of the row's money columns. "medium"
          // because that is a positional inference, not a labelled match.
          amountDeposited = toAmount(candidates[candidates.length - 1]!.raw, "medium", line);
        }
      }

      if (!receiptNumber.found) {
        // Scan the *masked* row so date-shaped and PAN/TAN-shaped tokens can't
        // be mistaken for a statement receipt number, and require at least one
        // letter so a plain money column can never be picked up.
        const masked = maskNonAmountText(line);
        const token = masked.slice(afterQuarter).match(RECEIPT_TOKEN_REGEX);
        if (token?.[1] && /[A-Z]/.test(token[1])) {
          receiptNumber = foundField(token[1], "medium", line);
        }
      }

    }

    if (!bsrCode.found) {
      if (selfLabelled) {
        // Weak last resort for self-labelling layouts whose BSR column header
        // is worded differently: a bare 7-digit token on the row. Guarded
        // against grabbing the integer part of a decimal amount
        // ("1234567.00"), which a plain `\b\d{7}\b` happily matches.
        const anyBsrLike = line.match(/(?<![\d.,])(\d{7})(?![\d.,])/);
        bsrCode = anyBsrLike
          ? foundField(anyBsrLike[1] ?? anyBsrLike[0], "low", line)
          : notFound("no 7-digit BSR-code-shaped token found on this row");
      } else {
        // Never guess on a bare TRACES row: its money columns are full of
        // 7-digit-shaped figures, and the real BSR code isn't on this row.
        bsrCode = notFound(NO_PER_QUARTER_BSR);
      }
    }

    rows.push({
      quarter,
      amountDeposited,
      receiptNumber,
      bsrCode,
      depositDate: depositDate.found
        ? depositDate
        : notFound(selfLabelled ? "no deposit date found on this row" : NO_PER_QUARTER_BSR),
    });
  }

  return rows;
}
