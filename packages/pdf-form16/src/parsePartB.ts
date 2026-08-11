import type { ChapterViaDeductionLine, ExtractedDocumentText, ExtractedField, Form16PartB } from "./types";
import { foundField, notFound } from "./types";
import {
  collectAmountsAfter,
  collectAmountsInValueColumns,
  findLabeledAmountColumnAware,
  isAmountsOnlyLine,
  parseIndianAmount,
} from "./parseUtils";

/**
 * Try each pattern *group* in priority order, searching the WHOLE document
 * for each group before moving to the next. This differs from just passing
 * all patterns to a single labelled-amount call: that helper returns on the
 * first LINE (top to bottom) that matches ANY of its patterns, so a
 * broad/generic pattern listed first can still lose to a line further down
 * that a later, more specific pattern would have preferred — it never gets
 * the chance, because the loop already returned. Chaining separate calls
 * like this instead lets a specific pattern "win" globally over a broader
 * one, even when the broad pattern's match appears earlier in the document.
 */
function findFirstFoundAmount(lines: string[], patternGroups: RegExp[][]): ExtractedField<number> {
  let last: ExtractedField<number> = notFound("no line matched an expected label for this field");
  for (const patterns of patternGroups) {
    const result = findLabeledAmountColumnAware(lines, patterns);
    if (result.found) return result;
    last = result;
  }
  return last;
}

/**
 * Chapter VI-A section codes we look for, e.g. "80C", "80CCD(1B)", "80D".
 *
 * Deliberately uses a negative lookahead instead of a trailing `\b`: `\b`
 * requires a word/non-word *transition*, which fails right after a closing
 * paren when the following character is also non-word (e.g. a space or
 * tab) — that silently truncated "80CCD(1B)" down to just "80CCD" whenever
 * whitespace followed the parenthetical. The lookahead only asserts "not
 * immediately followed by another alphanumeric character", which is what we
 * actually want here.
 *
 * The `\s*` before the parenthetical is new: the official revised Part B and
 * real TRACES certificates print these codes *with* a space — "80CCD (1)",
 * "80CCD (1B)", "80CCD (2)" — which without it collapse to an
 * indistinguishable "80CCD" three times over. The captured text is whitespace-
 * normalised so both spellings yield the same "80CCD(1B)".
 */
const CHAPTER_VIA_SECTION_REGEX = /\b(80[A-Z]{1,4}\s*(?:\(\d[A-Z]?\))?)(?![A-Za-z0-9])/;

/**
 * Rows inside the Chapter VI-A block that are sub-totals rather than
 * individual deductions. Real Part Bs carry "(d) Total deduction under
 * section 80C, 80CCC and 80CCD(1)", which otherwise reads as a second,
 * duplicate 80C line at the same amount.
 */
const CHAPTER_VIA_SUBTOTAL_REGEX =
  /total\s+deduction\s+under\s+section|aggregate\s+of\s+deductible|total\s+of\s+amount\s+deductible|total\s+amount\s+u\/s/i;

/**
 * Heuristically extract Part B (salary breakup & tax computation) fields
 * from a Form 16's reconstructed text. Every field is an `ExtractedField`,
 * never a bare value — this output is meant for a mandatory human
 * review/edit step, not direct use in tax computation.
 */
export function parsePartB(text: ExtractedDocumentText): Form16PartB {
  const lines = text.fullText.split("\n");

  const grossSalary = parseGrossSalary(lines);

  const salarySection17_1 = findLabeledAmountColumnAware(lines, [
    // The official revised wording is "Salary as per provisions contained in
    // section 17(1)" — the original pattern required "salary as per section
    // 17(1)" and so matched nothing on a real certificate.
    /salary\s*as\s*per\s*(?:provisions?\s*contained\s*in\s*)?(?:section|sec\.?|u\/s)\s*17\s*\(?\s*1\s*\)?/i,
    /(?:salary|pension)\s*as\s*per\s*.{0,40}17\s*\(\s*1\s*\)/i,
  ]);
  const perquisitesSection17_2 = findLabeledAmountColumnAware(lines, [
    /value\s*of\s*perquisites.*17\s*\(?\s*2\s*\)?/i,
    /perquisites.*u\/s\s*17\s*\(?\s*2\s*\)?/i,
  ]);
  const profitsInLieuSection17_3 = findLabeledAmountColumnAware(lines, [
    /profits?\s*in\s*lieu.*17\s*\(?\s*3\s*\)?/i,
  ]);

  // An employer-generated Part B lists HRA TWICE: once as a gross salary
  // component ("House Rent Allowance  Rs. 5,40,000") and again as the exempt
  // portion ("HRA Exemption u/s 10(13A)  Rs. 3,84,000"). The gross line comes
  // first, so a single label list returns the gross figure as if it were the
  // exemption — inflating the exemption by whatever the unexempt balance is.
  // Search the whole document for an explicitly exemption-qualified label
  // first, and only fall back to the bare allowance name if there isn't one.
  const exemptionHra = findFirstFoundAmount(lines, [
    [
      /hra\s*exemption/i,
      /house\s*rent\s*allowance.{0,30}(?:exempt|10\s*\(\s*13\s*a)/i,
      // Bounded gap (not a bare `.*`, which matches anything and can span an
      // entire line): a real, constructed collision case is a combined
      // exemptions line like "Amount exempt under section 10 including HRA and
      // LTA 45000" — `.*` would match all the way from "exempt" to "HRA"
      // across that unrelated phrase and return the *combined* figure as if it
      // were HRA's own amount. Genuine "HRA"/"exempt" pairings are always close
      // together ("HRA - Exempt", "Exempt HRA amount").
      /\bhra\b.{0,20}exempt/i,
      /exempt.{0,20}\bhra\b/i,
    ],
    [/house\s*rent\s*allowance/i],
  ]);
  const exemptionLta = findFirstFoundAmount(lines, [
    [
      /lta\s*exemption/i,
      /leave\s*travel\s*(?:allowance|concession).{0,30}(?:exempt|10\s*\(\s*5\s*\))/i,
      // The official label is "Travel concession or assistance under section
      // 10(5)" — it never says "leave" or "LTA" at all.
      /travel\s*concession\s*or\s*assistance/i,
      // Previously a bare /\blta\b/i, flagged in the Phase 3 review as able to
      // fire on any line that merely mentions LTA in passing and return a
      // spurious number at high confidence. Now it must sit next to a word
      // that makes it an actual LTA figure.
      /\blta\b.{0,25}(?:exempt|claimed)/i,
      /(?:exempt|claimed).{0,25}\blta\b/i,
    ],
    [/leave\s*travel\s*(?:allowance|concession)/i],
  ]);
  const exemptionTransport = findLabeledAmountColumnAware(lines, [
    /transport\s*allowance/i,
    /conveyance\s*allowance/i,
  ]);

  // Item 2's retirement heads. Each is matched on its statutory NAME first
  // and its section code second, because the code alone is ambiguous under
  // the reference-masking rules: "10(10A)" is a prefix of "10(10AA)", so a
  // pattern for commuted pension would also fire on the leave-encashment row
  // unless the code patterns are anchored against a following "A".
  const exemptionGratuity = findLabeledAmountColumnAware(lines, [
    /gratuity/i,
    /(?:section|sec\.?|u\/s)\s*10\s*\(\s*10\s*\)/i,
  ]);
  const exemptionCommutedPension = findLabeledAmountColumnAware(lines, [
    /commuted\s*value\s*of\s*pension/i,
    /commut\w*.{0,30}pension/i,
    /(?:section|sec\.?|u\/s)\s*10\s*\(\s*10\s*A\s*\)(?![A-Za-z0-9])/i,
  ]);
  const exemptionLeaveEncashment = findLabeledAmountColumnAware(lines, [
    // "Cash equivalent of leave salary encashment under section 10(10AA)" is
    // the statutory label. Note it contains "leave" but NOT "leave travel",
    // so it cannot collide with the LTA patterns above.
    /leave\s*(?:salary\s*)?encashment/i,
    /encashment\s*of\s*(?:earned\s*)?leave/i,
    /cash\s*equivalent\s*of\s*leave/i,
    /(?:section|sec\.?|u\/s)\s*10\s*\(\s*10\s*AA\s*\)/i,
  ]);
  const exemptionVrs = findLabeledAmountColumnAware(lines, [
    /voluntary\s*retirement/i,
    /\bvrs\b/i,
    /(?:section|sec\.?|u\/s)\s*10\s*\(\s*10\s*C\s*\)/i,
  ]);
  // Must be tried in this order relative to the total below: the catch-all
  // says "any other exemption under section 10" and the total says "total
  // amount of exemption claimed under section 10". Neither pattern may be
  // loose enough to match the other, nor the item 2 section header ("Less:
  // Allowances to the extent exempt under section 10"), which carries no
  // amount of its own — a label search that matched the header would walk to
  // the next line and return item 2(a)'s figure instead.
  const exemptionOtherSection10 = findLabeledAmountColumnAware(lines, [
    /(?:amount\s*of\s*)?any\s*other\s*exemption\s*under\s*(?:section|sec\.?|u\/s)\s*10/i,
    /other\s*exemptions?\s*under\s*(?:section|sec\.?|u\/s)\s*10/i,
  ]);
  const totalSection10Exemption = findLabeledAmountColumnAware(lines, [
    /total\s*amount\s*of\s*exemption\s*claimed\s*under\s*(?:section|sec\.?|u\/s)\s*10/i,
    /total\s*(?:amount\s*of\s*)?exemptions?\s*(?:claimed\s*)?under\s*(?:section|sec\.?|u\/s)\s*10/i,
  ]);

  // Item 3. The "current" is load-bearing and the negative lookahead is not
  // paranoia: item 1(e) reads "Reported total amount of salary received from
  // OTHER employer(s)" and appears EARLIER in the document, so any pattern
  // loose enough to match both returns 1(e)'s figure (normally 0.00 for
  // someone who did not change jobs) as if it were salary after Section 10.
  const salaryAfterSection10 = findFirstFoundAmount(lines, [
    [/total\s*amount\s*of\s*salary\s*received\s*from\s*current\s*employer/i],
    [/salary\s*received\s*from\s*current\s*employer/i],
  ]);

  const standardDeduction = findLabeledAmountColumnAware(lines, [/standard\s*deduction/i]);
  const professionalTax = findLabeledAmountColumnAware(lines, [
    /tax\s*on\s*employment/i,
    /prof(?:essional)?\.?\s*tax/i,
  ]);

  const incomeChargeableUnderSalaries = findLabeledAmountColumnAware(lines, [
    // Real certificates use typographic quotes around "Salaries" (U+201C/D),
    // which the original `['"]?` character class does not cover — so this
    // field silently reported not-found on every genuine TRACES Part B.
    /income\s*chargeable\s*under\s*(?:the\s*)?head\s*["'‘’“”]?\s*salaries/i,
  ]);

  const chapterViaDeductions = parseChapterViaDeductions(lines);

  const totalChapterViaDeductions = findFirstFoundAmount(lines, [
    [/(?:aggregate|total)\s*(?:amount\s*)?(?:of\s*)?deductions?\s*(?:under\s*)?chapter\s*vi[\s-]?a/i],
    // The official wording is "Aggregate of deductible amount under Chapter
    // VI-A" — "deductible amount", not "deductions", so the pattern above
    // never matched a real certificate.
    [/aggregate\s*of\s*deductible\s*amount/i],
    [/total\s*(?:amount\s*)?deduction[s]?\s*(?:under\s*)?chapter\s*vi[\s-]?a/i],
  ]);

  const grossTotalIncome = findLabeledAmountColumnAware(lines, [/gross\s*total\s*income/i]);
  const totalTaxableIncome = findLabeledAmountColumnAware(lines, [
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

  // A real Form 16 Part B tax-computation block typically has *multiple*
  // lines containing the substring "tax payable" — e.g. "Tax payable (13+15+
  // 16-14)" (item 17, before section-89 relief) and "Net tax payable (17-18)"
  // (item 19, the final figure). A bare /tax\s*payable/i pattern matches the
  // first one it meets, and since the labelled-amount helpers return on the
  // first LINE (top-to-bottom) that matches ANY of their patterns, listing
  // /net\s*tax\s*payable/i later in the array doesn't help — the earlier line
  // already won. `findFirstFoundAmount` fixes this by searching the whole
  // document for the specific label FIRST, only falling back to the broader
  // pattern if that specific search fails everywhere.
  const totalTaxByEmployer = findFirstFoundAmount(lines, [
    [/net\s*tax\s*payable/i],
    // Employer/treasury-generated Part Bs end with "Total Income Tax for the
    // Year (17-18)" instead of "Net tax payable".
    [/total\s*income\s*tax\s*for\s*the\s*year/i],
    [/total\s*tax\s*(?:on\s*income|deducted\s*and\s*deposited|liability|payable)/i],
    [/tax\s*payable/i],
  ]);

  return {
    grossSalary,
    salarySection17_1,
    perquisitesSection17_2,
    profitsInLieuSection17_3,
    exemptionHra,
    exemptionLta,
    exemptionTransport,
    exemptionGratuity,
    exemptionCommutedPension,
    exemptionLeaveEncashment,
    exemptionVrs,
    exemptionOtherSection10,
    totalSection10Exemption,
    salaryAfterSection10,
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

/**
 * "Gross Salary" is a *section header* on every standard Part B, not a value
 * row: item 1 reads "1. Gross Salary   Rs." with the figure appearing three
 * rows down at "(d) Total". Taking the next line's amount — which is what a
 * generic label search does — yields item 1(a), salary under section 17(1),
 * which only coincidentally equals gross salary when perquisites and profits
 * in lieu are both nil.
 *
 * So: use an amount on the "Gross Salary" line itself if there is one (which
 * is how most employer-generated layouts print it), otherwise look ahead
 * within the block for its "(d) Total" / "Total" sub-total row, and otherwise
 * report not-found rather than return item 1(a) mislabelled as the total.
 */
function parseGrossSalary(lines: string[]): ExtractedField<number> {
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i]!.match(/gross\s*salary/i);
    if (!label) continue;

    const sameLine = collectAmountsAfter(lines[i]!, (label.index ?? 0) + label[0].length);
    if (sameLine.length > 0) {
      const chosen = sameLine[sameLine.length - 1]!;
      const parsed = parseIndianAmount(chosen.raw);
      if (parsed !== undefined) {
        return foundField(parsed, sameLine.length === 1 ? "high" : "medium", lines[i]!);
      }
    }

    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const totalRow = lines[j]!.match(/^\s*(?:\(\s*d\s*\)|d\s*\))?\s*total\b/i);
      if (!totalRow) continue;
      const candidates = collectAmountsAfter(lines[j]!, totalRow[0].length);
      if (candidates.length === 0) continue;
      const parsed = parseIndianAmount(candidates[candidates.length - 1]!.raw);
      if (parsed === undefined) continue;
      return foundField(parsed, "medium", lines[j]!);
    }

    return notFound(
      "the 'Gross Salary' line is a section header carrying no amount, and no " +
        "'(d) Total' sub-total row was found beneath it — reporting nothing rather " +
        "than returning the section 17(1) figure as if it were the gross total"
    );
  }
  return notFound("no line matched an expected label for this field");
}

function parseChapterViaDeductions(lines: string[]): ChapterViaDeductionLine[] {
  const result: ChapterViaDeductionLine[] = [];
  let inChapterViaSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/chapter\s*vi\s*[\s-]?\s*a/i.test(line)) {
      inChapterViaSection = true;
    }
    // Stop once the computation moves past the deductions block. The original
    // stop condition was "gross total income", which works on the *old* form
    // (item 8, before Chapter VI-A at item 9) but not the current one, where
    // gross total income is item 9 and Chapter VI-A is item 10 — there, it
    // fired before the block even started. "Total taxable income" / "tax on
    // total income" immediately follow the block on every layout examined.
    if (/total\s*taxable\s*income|tax\s*on\s*total\s*income/i.test(line)) {
      inChapterViaSection = false;
    }
    if (!inChapterViaSection) continue;
    if (CHAPTER_VIA_SUBTOTAL_REGEX.test(line)) continue;

    const sectionMatch = line.match(CHAPTER_VIA_SECTION_REGEX);
    if (!sectionMatch || !sectionMatch[1]) continue;

    // "80CCD (1B)" and "80CCD(1B)" are the same code printed two ways.
    const section = foundField(sectionMatch[1].replace(/\s+/g, ""), "high" as const, line);
    const afterSection = (sectionMatch.index ?? 0) + sectionMatch[0].length;

    const sameLine = collectAmountsAfter(line, afterSection);
    if (sameLine.length > 0) {
      const chosen = sameLine[sameLine.length - 1]!;
      const amount = parseIndianAmount(chosen.raw);
      result.push({
        section,
        amount:
          amount === undefined
            ? notFound("matched text did not parse as a number")
            : // Rightmost column: these rows are printed as Gross Amount /
              // [Qualifying Amount] / Deductible Amount, and it is the
              // deductible figure that belongs in a return.
              foundField(amount, sameLine.length === 1 ? "high" : "medium", line),
      });
      continue;
    }

    // The label of a real Chapter VI-A row is long enough to wrap, which puts
    // the amounts on their own line either just below or just above the line
    // carrying the section code:
    //   "Deduction in respect of life insurance premia, contributions to"
    //   "(a)\t150000.00\t150000.00"
    //   "provident fund etc. under section 80C"
    // Pair the section code with an adjacent amounts-only row when there is
    // one, at reduced confidence since the pairing is positional.
    const adjacent = [lines[i + 1], lines[i - 1]].find(
      (candidate): candidate is string => candidate !== undefined && isAmountsOnlyLine(candidate)
    );
    if (adjacent) {
      const candidates = collectAmountsInValueColumns(adjacent);
      const amount = parseIndianAmount(candidates[candidates.length - 1]!.raw);
      if (amount !== undefined) {
        result.push({ section, amount: foundField(amount, "medium", adjacent) });
        continue;
      }
    }

    result.push({
      section,
      amount: notFound("no amount found on the same line as the section code, or on an adjacent amounts-only row"),
    });
  }

  return result;
}
