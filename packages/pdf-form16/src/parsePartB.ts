import type { ChapterViaDeductionLine, ExtractedDocumentText, Form16PartB } from "./types";
import { foundField } from "./types";
import { AMOUNT_REGEX, findLabeledAmount, parseIndianAmount } from "./parseUtils";

/**
 * Chapter VI-A section codes we look for, e.g. "80C", "80CCD(1B)", "80D".
 * Deliberately uses a negative lookahead instead of a trailing `\b`: `\b`
 * requires a word/non-word *transition*, which fails right after a closing
 * paren when the following character is also non-word (e.g. a space or
 * tab) — that silently truncated "80CCD(1B)" down to just "80CCD" whenever
 * whitespace followed the parenthetical. The lookahead only asserts "not
 * immediately followed by another alphanumeric character", which is what we
 * actually want here.
 */
const CHAPTER_VIA_SECTION_REGEX = /\b(80[A-Z]{1,4}(?:\(\d[A-Z]?\))?)(?![A-Za-z0-9])/;

/**
 * Heuristically extract Part B (salary breakup & tax computation) fields
 * from a Form 16's reconstructed text. Every field is an `ExtractedField`,
 * never a bare value — this output is meant for a mandatory human
 * review/edit step, not direct use in tax computation.
 */
export function parsePartB(text: ExtractedDocumentText): Form16PartB {
  const lines = text.fullText.split("\n");

  const grossSalary = findLabeledAmount(lines, [/gross\s*salary/i]);
  const salarySection17_1 = findLabeledAmount(lines, [/salary\s*as\s*per\s*(?:section|sec\.?)\s*17\s*\(?1\)?/i]);
  const perquisitesSection17_2 = findLabeledAmount(lines, [
    /value\s*of\s*perquisites.*17\s*\(?2\)?/i,
    /perquisites.*u\/s\s*17\s*\(?2\)?/i,
  ]);
  const profitsInLieuSection17_3 = findLabeledAmount(lines, [
    /profits?\s*in\s*lieu.*17\s*\(?3\)?/i,
  ]);

  const exemptionHra = findLabeledAmount(lines, [
    /house\s*rent\s*allowance/i,
    /\bhra\b.*exempt/i,
    /exempt.*\bhra\b/i,
  ]);
  const exemptionLta = findLabeledAmount(lines, [
    /leave\s*travel\s*(?:allowance|concession)/i,
    /\blta\b/i,
  ]);
  const exemptionTransport = findLabeledAmount(lines, [
    /transport\s*allowance/i,
    /conveyance\s*allowance/i,
  ]);

  const standardDeduction = findLabeledAmount(lines, [/standard\s*deduction/i]);
  const professionalTax = findLabeledAmount(lines, [
    /tax\s*on\s*employment/i,
    /professional\s*tax/i,
  ]);

  const incomeChargeableUnderSalaries = findLabeledAmount(lines, [
    /income\s*chargeable\s*under\s*(?:the\s*)?head\s*['"]?salaries['"]?/i,
  ]);

  const chapterViaDeductions = parseChapterViaDeductions(lines);

  const totalChapterViaDeductions = findLabeledAmount(lines, [
    /(?:aggregate|total)\s*(?:amount\s*)?(?:of\s*)?deductions?\s*(?:under\s*)?chapter\s*vi[\s-]?a/i,
  ]);

  const grossTotalIncome = findLabeledAmount(lines, [/gross\s*total\s*income/i]);
  const totalTaxableIncome = findLabeledAmount(lines, [
    // "taxable income" first (specific, unambiguous). A bare
    // /total\s*(?:taxable\s*)?income/i pattern would also match inside
    // "Gross Total Income" (a real, confirmed bug during testing: it
    // matched "Total ... Income" embedded in the *gross* income line,
    // which appears earlier in the document, and silently returned the
    // gross figure instead of the taxable one). The lookbehind fallback
    // below keeps some flexibility for forms that just say "Total Income"
    // without the word "taxable", while still excluding the gross-income line.
    /taxable\s*income/i,
    /(?<!gross\s*)total\s*income/i,
  ]);

  const totalTaxByEmployer = findLabeledAmount(lines, [
    /tax\s*payable/i,
    /total\s*tax\s*(?:on\s*income|deducted\s*and\s*deposited|liability)/i,
    /net\s*tax\s*payable/i,
  ]);

  return {
    grossSalary,
    salarySection17_1,
    perquisitesSection17_2,
    profitsInLieuSection17_3,
    exemptionHra,
    exemptionLta,
    exemptionTransport,
    standardDeduction,
    professionalTax,
    incomeChargeableUnderSalaries,
    chapterViaDeductions,
    totalChapterViaDeductions,
    grossTotalIncome,
    totalTaxableIncome,
    totalTaxByEmployer,
  };
}

function parseChapterViaDeductions(lines: string[]): ChapterViaDeductionLine[] {
  const result: ChapterViaDeductionLine[] = [];
  let inChapterViaSection = false;

  for (const line of lines) {
    if (/chapter\s*vi[\s-]?a/i.test(line)) {
      inChapterViaSection = true;
    }
    if (/gross\s*total\s*income/i.test(line)) {
      // Chapter VI-A deduction lines always come before gross total income
      // on a Form 16; stop scanning once we've passed it to avoid picking
      // up unrelated "80-something" mentions later in the document.
      inChapterViaSection = false;
    }
    if (!inChapterViaSection) continue;

    const sectionMatch = line.match(CHAPTER_VIA_SECTION_REGEX);
    if (!sectionMatch || !sectionMatch[1]) continue;

    const afterSection = line.slice((sectionMatch.index ?? 0) + sectionMatch[0].length);
    const amountMatch = afterSection.match(AMOUNT_REGEX);
    const section = foundField(sectionMatch[1], "high" as const, line);

    if (amountMatch && amountMatch[1]) {
      const amount = parseIndianAmount(amountMatch[1]);
      result.push({
        section,
        amount:
          amount === undefined
            ? { found: false, reason: "matched text did not parse as a number" }
            : foundField(amount, "high", line),
      });
    } else {
      result.push({
        section,
        amount: { found: false, reason: "no amount found on the same line as the section code" },
      });
    }
  }

  return result;
}
