import type { ExtractedField } from "./types";
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
