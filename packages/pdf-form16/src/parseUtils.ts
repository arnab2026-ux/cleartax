import type { Confidence, ExtractedField } from "./types";
import { foundField, notFound } from "./types";

export const PAN_REGEX = /\b([A-Z]{5}\d{4}[A-Z])\b/;
export const TAN_REGEX = /\b([A-Z]{4}\d{5}[A-Z])\b/;
/** BSR code: 7-digit bank branch code used on TDS challans. */
export const BSR_CODE_REGEX = /\b(\d{7})\b/;
/** Assessment year, e.g. "2026-27". */
export const ASSESSMENT_YEAR_REGEX = /\b(20\d{2}-\d{2})\b/;
/** Common Indian date formats: DD/MM/YYYY, DD-MM-YYYY, or "31-Mar-2026". */
export const DATE_REGEX = /\b(\d{1,2}[/-][A-Za-z]{3}[/-]\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/;
/** A rupee amount, optionally prefixed with ₹/Rs./INR, with optional thousands separators and paise. */
export const AMOUNT_REGEX = /(?:₹|Rs\.?|INR)?\s*(-?\d(?:[\d,]*\d)?(?:\.\d{1,2})?)/;

export function parseIndianAmount(raw: string): number | undefined {
  const match = raw.match(AMOUNT_REGEX);
  if (!match || !match[1]) return undefined;
  const num = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Search `lines` for the first occurrence of `valuePattern`, restricted to
 * lines that also match one of `labelPatterns`. Looks on the same line
 * first (after the label text, to avoid recapturing part of the label), then
 * falls back to the very next non-empty line — Form 16 layouts commonly put
 * a label and its value either "Label: value" on one line, or label on one
 * table row/line and value on the next.
 */
export function findLabeledValue(
  lines: string[],
  labelPatterns: RegExp[],
  valuePattern: RegExp
): ExtractedField<string> {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const labelMatch = labelPatterns
      .map((p) => line.match(p))
      .find((m): m is RegExpMatchArray => m !== null);
    if (!labelMatch) continue;

    const searchStart = (labelMatch.index ?? 0) + labelMatch[0].length;
    // Strip a leading separator (": ", " - ", etc.) so catch-all value
    // patterns like /^(.+)$/ capture the value, not the punctuation.
    const afterLabel = line.slice(searchStart).replace(/^[:\-\s]+/, "");

    if (afterLabel.length > 0) {
      const afterLabelMatch = afterLabel.match(valuePattern);
      if (afterLabelMatch) {
        return foundField(afterLabelMatch[1] ?? afterLabelMatch[0], "high", line);
      }
    }

    // Nothing usable directly after the label on this line — try the next
    // non-empty line (common when the label is a standalone header/row and
    // the value is printed on the following line/table row).
    const nextLine = lines[i + 1];
    if (nextLine && nextLine.trim().length > 0) {
      const nextMatch = nextLine.match(valuePattern);
      if (nextMatch) {
        return foundField(nextMatch[1] ?? nextMatch[0], "medium", nextLine);
      }
    }

    // Last resort: the value pattern matches somewhere on the label's own
    // line (e.g. a catch-all pattern, or the label text incidentally
    // contains a pattern-shaped substring). Low confidence — we can't be
    // sure this is really the value and not just the label text itself.
    const wholeLineMatch = line.match(valuePattern);
    if (wholeLineMatch) {
      return foundField(wholeLineMatch[1] ?? wholeLineMatch[0], "low", line);
    }
  }
  return notFound("no line matched an expected label for this field");
}

export function findLabeledAmount(
  lines: string[],
  labelPatterns: RegExp[]
): ExtractedField<number> {
  const textField = findLabeledValue(lines, labelPatterns, AMOUNT_REGEX);
  if (!textField.found) return notFound(textField.reason);
  const amount = parseIndianAmount(textField.value);
  if (amount === undefined) {
    return notFound(`matched a label but "${textField.value}" did not parse as an amount`);
  }
  return foundField(amount, textField.confidence, textField.sourceText);
}

// ---------------------------------------------------------------------------
// Column- and reference-aware extraction (Phase 10)
//
// Everything above this line is the original Phase 3 matching engine and is
// deliberately left untouched — it carries seven previously-found label-
// collision fixes and their regression tests. The helpers below are ADDITIVE:
// they solve a class of failure the original engine cannot, namely that on a
// real (TRACES-generated) Form 16 the digits that AMOUNT_REGEX finds first
// after a label are almost never the amount. Real examples, taken verbatim
// from a genuine TRACES Form 16 run through this package's own extractText():
//
//   "(e) House rent allowance under section 10(13A)\t180150.00"  -> 10
//   "(a) Standard deduction under section 16(ia)\t50000.00"      -> 16
//   "9. Gross total income (6+8)\t2325433.00"                    -> 6
//   "19. Net tax payable (17-18)\t483737.00"                     -> 17
//   "...under section 17(2) (as per Form No. 12BA,"              -> 12
//
// The fix has two halves:
//  1. MASK the spans that are structurally incapable of being an amount
//     (statutory references, bracketed cross-reference formulae, item
//     numbering, dates, alphanumeric identifiers), then
//  2. prefer the RIGHTMOST surviving candidate rather than the first, because
//     every Form 16 layout examined puts the value column at the right end of
//     its row, with the label (and its section references) to the left.
// ---------------------------------------------------------------------------

/** Receipt numbers on a TRACES Part A quarterly row are 8-character alphanumeric tokens (e.g. "QUNPAQMB"), not pure digit runs. */
export const RECEIPT_TOKEN_REGEX = /\b([A-Z][A-Z0-9]{5,11})\b/;

function blank(text: string, pattern: RegExp): string {
  return text.replace(pattern, (m) => " ".repeat(m.length));
}

/**
 * Item numbering at the start of a line or of a tab-delimited column
 * ("1.", "12.", "a)"). Must be followed by whitespace/end so it can't eat the
 * integer part of a decimal amount ("0.00" must NOT be read as item "0." + 00).
 */
const ITEM_MARKER_MASKS: RegExp[] = [
  /(?:^|(?<=\t))[ \t]*\d{1,2}\s*[.)](?=\s|$)/g,
  /(?:^|(?<=\t))[ \t]*[A-Za-z]\s*\)(?=\s|$)/g,
];

const REFERENCE_MASKS: RegExp[] = [
  // Bracketed cross-reference formulae and notes: "[10(d)+10(e)]",
  // "[(3+1(e)-5]", "[Note: ...]", "[See rule 31(1)(a)]".
  /\[[^\]]*\]/g,
  // Parenthesised groups: sub-clause refs "(13A)", arithmetic cross-references
  // "(6+8)", "( 9 - 11 )", column units "(Rs.)", "(dd/mm/yyyy)", and prose
  // asides "(as per Form No. 12BA, wherever applicable)". No Form 16 layout
  // examined puts the actual value inside parentheses, and losing a value
  // yields "not found" — the safe direction — rather than a wrong number.
  /\((?:[^()]|\([^()]*\))*\)/g,
  // Statutory references: "section 17", "u/s 10", "sec.17", "rule 31".
  /\b(?:u\/s|under\s+section|section|sec|rule|clause)\s*\.?\s*\d[\dA-Za-z]*/gi,
  // Dates: "01-Apr-2021", "04-05-2021"; and hyphenated number groups such as
  // the assessment year "2022-23" or an address fragment like "10-2-3".
  /\b\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4}\b/g,
  /\b\d{1,5}(?:\s*[-/]\s*\d{1,5})+\b/g,
  // Alphanumeric identifiers where digits and letters touch: "12BA", "80C",
  // "24G", "10AA", "Q1", "AABCD9761D", "HYDD01619C".
  /\b\d+[A-Za-z]+[A-Za-z0-9]*\b/g,
  /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g,
];

/**
 * Blank out (preserving length, so offsets stay valid against the original
 * line) every span that cannot be a rupee amount. Length preservation is what
 * lets callers mask once and then reason about tab-column offsets taken from
 * the unmasked line.
 */
export function maskNonAmountText(line: string): string {
  let out = line;
  for (const pattern of ITEM_MARKER_MASKS) out = blank(out, pattern);
  for (const pattern of REFERENCE_MASKS) out = blank(out, pattern);
  return out;
}

export interface AmountCandidate {
  raw: string;
  index: number;
}

const AMOUNT_SCAN_SOURCE = /-?\d[\d,]*(?:\.\d{1,2})?/.source;

function scanAmounts(masked: string, from: number, to: number): AmountCandidate[] {
  const out: AmountCandidate[] = [];
  const re = new RegExp(AMOUNT_SCAN_SOURCE, "g");
  re.lastIndex = Math.max(0, from);
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const end = match.index + match[0].length;
    if (match.index >= to) break;
    if (end > to) break;
    const before = match.index > 0 ? masked[match.index - 1]! : " ";
    const after = masked[end] ?? " ";
    // Refuse to start or end mid-token: a run that touches a letter, another
    // digit, or a decimal point on either side isn't a standalone amount.
    if (/[A-Za-z\d.,]/.test(before)) continue;
    if (/[A-Za-z\d]/.test(after)) continue;
    const digits = match[0].replace(/\D/g, "");
    if (digits.length === 0 || digits.length > 12) continue;
    out.push({ raw: match[0], index: match.index });
  }
  return out;
}

/** Byte ranges of each tab-delimited column in a reconstructed line. */
function segmentRanges(line: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === "\t") {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  return ranges;
}

/**
 * True when a column contains nothing but a value: digits, separators and an
 * optional currency marker. A column that still has words in it after masking
 * is a *different labelled column* ("Receipt No. 123456", "BSR Code 1234567"),
 * and an amount search must not cross into it.
 */
function isValueOnlyColumn(maskedSegment: string): boolean {
  return (
    maskedSegment
      .replace(/₹|Rs\.?|INR/gi, " ")
      .replace(/[\d,.\-+/()*%:\s]/g, "")
      .length === 0
  );
}

/**
 * Column headings that can legitimately appear *after* a value on the same
 * row of a Form 16 table. Reaching a second labelled column means the value
 * we want has already gone past, so the amount scan must stop here.
 *
 * Whether two columns are separated by a tab or merely by spaces depends
 * entirely on how wide the gap happened to render, so a tab boundary alone is
 * not a reliable column marker: a self-labelling quarterly row can reconstruct
 * as one single run, "Q1 Tax deposited/remitted: 25000 Receipt No. 123456 BSR
 * Code 1234567 Date of tax deposit 07-Jul-2025", in which taking the rightmost
 * candidate would return the BSR code as the amount deposited.
 */
const NEXT_COLUMN_LABEL_REGEX =
  /\b(?:receipt\s*(?:no|number)|bsr\s*code|date\s*(?:of|on\s+which)|challan|status\s*of|sl\.?\s*no|book\s*identification|amount\s*(?:paid|of\s*tax)|tax\s*(?:deduct|deposit)(?:ed)?|deposited\s*\/\s*remitted)\b/i;

/**
 * Amount candidates from `fromIndex` up to whichever comes first — the next
 * labelled column on this row, or the end of this tab-delimited column — plus
 * any immediately-following value-only columns.
 */
export function collectAmountsAfter(line: string, fromIndex: number): AmountCandidate[] {
  const masked = maskNonAmountText(line);
  const ranges = segmentRanges(line);
  const owner = ranges.findIndex((r) => fromIndex >= r.start && fromIndex <= r.end);
  if (owner < 0) return [];

  let ownEnd = ranges[owner]!.end;
  const nextLabel = line.slice(fromIndex, ownEnd).match(NEXT_COLUMN_LABEL_REGEX);
  if (nextLabel?.index !== undefined) ownEnd = fromIndex + nextLabel.index;

  const out = scanAmounts(masked, fromIndex, ownEnd);
  // If another labelled column interrupted this one, everything further right
  // belongs to other fields — don't walk into it.
  if (ownEnd !== ranges[owner]!.end) return out;
  for (let i = owner + 1; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (!isValueOnlyColumn(masked.slice(range.start, range.end))) break;
    out.push(...scanAmounts(masked, range.start, range.end));
  }
  return out;
}

/** Amount candidates from every value-only column of a line (used for the label-on-its-own-line case). */
export function collectAmountsInValueColumns(line: string): AmountCandidate[] {
  const masked = maskNonAmountText(line);
  const out: AmountCandidate[] = [];
  for (const range of segmentRanges(line)) {
    if (!isValueOnlyColumn(masked.slice(range.start, range.end))) continue;
    out.push(...scanAmounts(masked, range.start, range.end));
  }
  return out;
}

/** True when the whole line is item-marker + amounts (a TRACES "amounts row" whose label wrapped onto an adjacent line). */
export function isAmountsOnlyLine(line: string): boolean {
  if (line.trim().length === 0) return false;
  const masked = maskNonAmountText(line);
  for (const range of segmentRanges(line)) {
    if (!isValueOnlyColumn(masked.slice(range.start, range.end))) return false;
  }
  return collectAmountsInValueColumns(line).length > 0;
}

function matchAnyLabel(line: string, labelPatterns: RegExp[]): RegExpMatchArray | undefined {
  return labelPatterns
    .map((p) => line.match(p))
    .find((m): m is RegExpMatchArray => m !== null);
}

function nextNonEmptyIndex(lines: string[], after: number): number {
  for (let i = after + 1; i < lines.length; i++) {
    if (lines[i]!.trim().length > 0) return i;
  }
  return -1;
}

function toAmountField(
  candidate: AmountCandidate,
  confidence: Confidence,
  sourceText: string
): ExtractedField<number> {
  const parsed = parseIndianAmount(candidate.raw);
  if (parsed === undefined) {
    return notFound(`matched a label but "${candidate.raw}" did not parse as an amount`);
  }
  return foundField(parsed, confidence, sourceText);
}

/**
 * Reference-aware, column-aware labelled-amount search. Same contract as
 * `findLabeledAmount` but with the masking + rightmost-candidate rules
 * described at the top of this section.
 *
 * Confidence reflects genuine ambiguity: a single surviving candidate next to
 * its label is "high"; several candidates on the row (a Gross/Qualifying/
 * Deductible triple, say) means we picked by column position, which is
 * "medium"; anything resolved off a *following* line drops a further step.
 */
export function findLabeledAmountColumnAware(
  lines: string[],
  labelPatterns: RegExp[]
): ExtractedField<number> {
  let sawLabel = false;

  for (const line of lines) {
    const label = matchAnyLabel(line, labelPatterns);
    if (!label) continue;
    sawLabel = true;
    const candidates = collectAmountsAfter(line, (label.index ?? 0) + label[0].length);
    if (candidates.length > 0) {
      return toAmountField(
        candidates[candidates.length - 1]!,
        candidates.length === 1 ? "high" : "medium",
        line
      );
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (!matchAnyLabel(lines[i]!, labelPatterns)) continue;
    const next = nextNonEmptyIndex(lines, i);
    if (next < 0) continue;
    const candidates = collectAmountsInValueColumns(lines[next]!);
    if (candidates.length > 0) {
      return toAmountField(
        candidates[candidates.length - 1]!,
        candidates.length === 1 ? "medium" : "low",
        lines[next]!
      );
    }
  }

  return notFound(
    sawLabel
      ? "a label matched, but no amount could be separated from the statutory/formula references near it"
      : "no line matched an expected label for this field"
  );
}

/**
 * Column headers seen on real Form 16s. Used to reject a neighbouring
 * column's *header* being mistaken for the value of the column we want — the
 * TRACES header row is literally
 * "Name and address of the Employer\tName and address of the Employee",
 * so a naive "everything after the label" capture returns the employee header
 * as the employer's name.
 */
const COLUMN_HEADER_REGEX =
  // "name and <anything> of" rather than "name and address of": real headers
  // include "Name and Designation of the Employee" as well as the TRACES
  // "Name and address of the Employee/Specified senior citizen".
  /^(?:name\s+(?:and\s+\w+\s+)?of|pan\s+of|tan\s+of|address\s+of|employee\s+reference|pension\s+payment|assessment\s+year|period\s+with|cit\s*\(?tds\)?|specified\s+(?:bank|senior)|quarter|receipt\s+numbers?|amount\s+(?:paid|of\s+tax)|bsr\s+code|date\s+(?:of|on\s+which)|challan|sl\.?\s*no|status\s+of|book\s+identification|gross\s+amount|deductible\s+amount|qualifying\s+amount|total\s*\(\s*rs|rs\.?|from|to)\b/i;

export function looksLikeColumnHeader(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return COLUMN_HEADER_REGEX.test(trimmed);
}

function columnIndexAt(line: string, index: number): number {
  return segmentRanges(line).findIndex((r) => index >= r.start && index <= r.end);
}

export interface LabeledBlock {
  /** The first value line of the block — typically the name. */
  first: ExtractedField<string>;
  /** Any further lines of the same column, joined — typically the address. */
  rest: ExtractedField<string>;
}

/**
 * Read a free-text value that lives *below* its label in a specific column,
 * continuing across however many lines the column occupies.
 *
 * This is what the standard TRACES "Name and address of the Employer" /
 * "Name and address of the Employee" two-column block actually looks like:
 * one header row, then the name, then 2-4 address lines, then the next
 * header row. It resolves the limitation flagged in the Phase 3 review (name
 * and address being indistinguishable) for that layout, while degrading to
 * "name only, address not found" on single-line "Label: Value" layouts.
 */
/** The subset of `TextLine` this module needs: reconstructed text plus each run's x position. */
export interface PositionedLine {
  text: string;
  items: { text: string; x: number }[];
}

/**
 * Map a character offset in a reconstructed line back to the x position of the
 * text run it came from. `buildLine()` concatenates runs in x order with at
 * most one separator character between them, so walking the runs with
 * `indexOf` recovers each one's offset without depending on the exact
 * separator thresholds.
 */
function runXAtOffset(line: PositionedLine, offset: number): number | undefined {
  let cursor = 0;
  let best: number | undefined;
  for (const item of line.items) {
    const at = line.text.indexOf(item.text, cursor);
    if (at < 0) continue;
    cursor = at + item.text.length;
    if (at <= offset) best = item.x;
    if (at > offset) break;
  }
  return best;
}

/**
 * Read a column of a multi-column block by x position rather than by tab.
 *
 * Tabs are not a dependable column marker: `extractText.ts` only emits one
 * when the rendered gap exceeds its threshold, so the very same two-column
 * TRACES block reconstructs with a tab on one document and a plain space on
 * another. Taking the whole line then merges the employer's name and the
 * employee's name into one string — and hands the *employer's* name back as
 * the employee's. x positions are unambiguous, so use them when the caller
 * has them.
 */
function readPositionedColumn(
  positioned: PositionedLine[],
  startLine: number,
  fromX: number,
  toX: number,
  maxContinuationLines: number
): string[] {
  const collected: string[] = [];
  const EDGE_TOLERANCE = 2;
  for (
    let j = startLine;
    j < positioned.length && collected.length < maxContinuationLines;
    j++
  ) {
    const candidate = positioned[j]!;
    if (candidate.text.trim().length === 0) break;
    const text = candidate.items
      .filter((item) => item.x >= fromX - EDGE_TOLERANCE && item.x < toX - EDGE_TOLERANCE)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" ")
      .trim();
    if (looksLikeColumnHeader(text)) break;
    if (text.length === 0) continue;
    collected.push(text);
  }
  return collected;
}

export function findLabeledBlock(
  lines: string[],
  labelPatterns: RegExp[],
  maxContinuationLines = 6,
  positioned?: PositionedLine[],
  siblingLabelPattern?: RegExp
): LabeledBlock {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const label = matchAnyLabel(line, labelPatterns);
    if (!label) continue;

    const labelEnd = (label.index ?? 0) + label[0].length;
    const column = columnIndexAt(line, labelEnd);
    if (column < 0) continue;
    const ranges = segmentRanges(line);

    // Same line: the remainder of the label's own column, else the next
    // column along — but never a column that is itself a header.
    const ownRemainder = line.slice(labelEnd, ranges[column]!.end).replace(/^[:\-\s/]+/, "").trim();
    if (ownRemainder.length > 0 && !looksLikeColumnHeader(ownRemainder)) {
      return { first: foundField(ownRemainder, "high", line), rest: notFound("single-line layout: no separate address lines follow the label") };
    }
    for (let c = column + 1; c < ranges.length; c++) {
      const text = line.slice(ranges[c]!.start, ranges[c]!.end).trim();
      if (text.length === 0) continue;
      if (looksLikeColumnHeader(text)) break;
      return { first: foundField(text, "high", line), rest: notFound("single-line layout: no separate address lines follow the label") };
    }

    // Otherwise walk down this column until the next header row. Prefer x
    // positions when the caller supplied them, since tabs may or may not be
    // present depending on how wide the gap happened to render.
    const positionedLine = positioned?.length === lines.length ? positioned[i] : undefined;
    if (positionedLine && siblingLabelPattern) {
      const ourX = runXAtOffset(positionedLine, label.index ?? 0);
      if (ourX !== undefined) {
        const siblingXs = [
          ...positionedLine.text.matchAll(new RegExp(siblingLabelPattern.source, "gi")),
        ]
          .map((m) => runXAtOffset(positionedLine, m.index ?? 0))
          .filter((x): x is number => x !== undefined && x > ourX);
        const nextX = siblingXs.length > 0 ? Math.min(...siblingXs) : Number.POSITIVE_INFINITY;
        const found = readPositionedColumn(positioned!, i + 1, ourX, nextX, maxContinuationLines);
        if (found.length > 0) {
          return {
            first: foundField(found[0]!, "medium", line),
            rest:
              found.length > 1
                ? foundField(found.slice(1).join(", "), "medium", line)
                : notFound("no continuation lines found below the name in this column"),
          };
        }
      }
    }

    const collected: string[] = [];
    for (let j = i + 1; j < lines.length && collected.length < maxContinuationLines; j++) {
      const candidateLine = lines[j]!;
      if (candidateLine.trim().length === 0) break;
      const candidateRanges = segmentRanges(candidateLine);
      let text: string;
      if (candidateRanges.length > column) {
        text = candidateLine.slice(candidateRanges[column]!.start, candidateRanges[column]!.end).trim();
      } else if (column === 0) {
        // A single un-tabbed run starts at the left, so it belongs to the
        // leftmost column. For any other column we cannot tell, so we stop
        // rather than guess.
        text = candidateLine.trim();
      } else {
        break;
      }
      if (looksLikeColumnHeader(text)) break;
      if (text.length === 0) continue;
      collected.push(text);
    }

    if (collected.length === 0) continue;
    return {
      first: foundField(collected[0]!, "medium", lines[i]!),
      rest:
        collected.length > 1
          ? foundField(collected.slice(1).join(", "), "medium", lines[i]!)
          : notFound("no continuation lines found below the name in this column"),
    };
  }

  return {
    first: notFound("no line matched an expected label for this field"),
    rest: notFound("no line matched an expected label for this field"),
  };
}

/**
 * Pick the value belonging to *our* label when several same-shaped values sit
 * on one row below several same-kind labels.
 *
 * The TRACES identity row is exactly this shape:
 *   "PAN of the Deductor\tTAN of the Deductor\tPAN of the Employee"
 *   "AABCD9761D HYDD01619C ATOPM4017E"
 * A plain next-line PAN search returns the *deductor's* PAN for both PAN
 * fields — a confidently-wrong critical identifier. Counting which PAN-shaped
 * label ours is (0th or 1st) and taking the value at the same ordinal fixes
 * it; if the counts don't line up we report low confidence rather than guess.
 */
export function findOrdinalLabeledValue(
  lines: string[],
  labelPatterns: RegExp[],
  siblingLabelPattern: RegExp,
  valuePattern: RegExp
): ExtractedField<string> {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const label = matchAnyLabel(line, labelPatterns);
    if (!label) continue;
    const labelEnd = (label.index ?? 0) + label[0].length;

    const sameLine = line.slice(labelEnd).replace(/^[:\-\s]+/, "").match(valuePattern);
    if (sameLine) return foundField(sameLine[1] ?? sameLine[0], "high", line);

    const siblings = [...line.matchAll(new RegExp(siblingLabelPattern.source, "gi"))];
    const ordinal = siblings.findIndex((s) => (s.index ?? -1) >= (label.index ?? 0));
    const next = nextNonEmptyIndex(lines, i);
    if (next < 0) continue;

    const values = [...lines[next]!.matchAll(new RegExp(valuePattern.source, "g"))];
    if (values.length === 0) continue;
    if (ordinal >= 0 && siblings.length === values.length) {
      const chosen = values[ordinal]!;
      return foundField(chosen[1] ?? chosen[0], "medium", lines[next]!);
    }
    if (ordinal >= 0 && ordinal < values.length) {
      const chosen = values[ordinal]!;
      return foundField(chosen[1] ?? chosen[0], "low", lines[next]!);
    }
  }
  return notFound("no line matched an expected label for this field");
}

/**
 * Like `findLabeledValue`, but multi-pass: every line is tried for a same-line
 * match before any line is tried for a next-line match, and so on outward.
 * This matters because a real TRACES Part A prints "Assessment Year" as a bare
 * column header on page 1 (value four rows down, interleaved with the CIT
 * address) and again as "Assessment Year: 2022-23" in the page-2 continuation
 * banner — the second is far more trustworthy, and a single-pass scan would
 * never reach it. Confidence degrades with distance.
 */
export function findLabeledValueAhead(
  lines: string[],
  labelPatterns: RegExp[],
  valuePattern: RegExp,
  maxLookahead = 4
): ExtractedField<string> {
  for (const line of lines) {
    const label = matchAnyLabel(line, labelPatterns);
    if (!label) continue;
    const after = line.slice((label.index ?? 0) + label[0].length).replace(/^[:\-\s]+/, "");
    const match = after.match(valuePattern);
    if (match) return foundField(match[1] ?? match[0], "high", line);
  }

  for (let distance = 1; distance <= maxLookahead; distance++) {
    for (let i = 0; i < lines.length; i++) {
      if (!matchAnyLabel(lines[i]!, labelPatterns)) continue;
      const target = lines[i + distance];
      if (!target || target.trim().length === 0) continue;
      const match = target.match(valuePattern);
      if (match) {
        return foundField(match[1] ?? match[0], distance === 1 ? "medium" : "low", target);
      }
    }
  }

  return notFound("no line matched an expected label for this field");
}

/**
 * Document-wide fallback: find the first line anywhere matching
 * `valuePattern`, with no label requirement at all. Always "low" confidence
 * (or "medium" if `mediumConfidence` is passed) since there's no label
 * context confirming what the value actually represents — only ever use
 * this after a labeled search has already failed.
 */
export function findFirstMatchAnywhere(
  lines: string[],
  valuePattern: RegExp,
  confidence: "low" | "medium" = "low"
): ExtractedField<string> {
  for (const line of lines) {
    const match = line.match(valuePattern);
    if (match) {
      return foundField(match[1] ?? match[0], confidence, line);
    }
  }
  return notFound("no line anywhere matched the value pattern");
}
