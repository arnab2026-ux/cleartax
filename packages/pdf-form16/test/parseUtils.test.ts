import { describe, expect, it } from "vitest";
import {
  AMOUNT_REGEX,
  BSR_CODE_REGEX,
  PAN_REGEX,
  TAN_REGEX,
  findFirstMatchAnywhere,
  findLabeledAmount,
  findLabeledValue,
  parseIndianAmount,
} from "../src/parseUtils.js";

describe("parseIndianAmount", () => {
  it("parses a plain integer", () => {
    expect(parseIndianAmount("1500000")).toBe(1500000);
  });

  it("parses comma-grouped amounts regardless of grouping style", () => {
    expect(parseIndianAmount("15,00,000")).toBe(1500000); // Indian grouping
    expect(parseIndianAmount("1,500,000")).toBe(1500000); // Western grouping
  });

  it("parses amounts with a currency prefix", () => {
    expect(parseIndianAmount("Rs. 25,000")).toBe(25000);
    expect(parseIndianAmount("₹25000")).toBe(25000);
    expect(parseIndianAmount("INR 25000")).toBe(25000);
  });

  it("parses decimals (paise)", () => {
    expect(parseIndianAmount("1234.56")).toBe(1234.56);
  });

  it("returns undefined for text with no numeric amount", () => {
    expect(parseIndianAmount("N/A")).toBeUndefined();
  });
});

describe("regex constants", () => {
  it("PAN_REGEX matches a well-formed PAN and rejects malformed ones", () => {
    expect(PAN_REGEX.test("ABCDE1234F")).toBe(true);
    expect(PAN_REGEX.test("abcde1234f")).toBe(false); // case-sensitive by design; callers uppercase first
    expect(PAN_REGEX.test("ABCD1234F")).toBe(false); // wrong shape
  });

  it("TAN_REGEX matches a well-formed TAN", () => {
    expect(TAN_REGEX.test("BLRA12345B")).toBe(true);
    expect(TAN_REGEX.test("ABCDE1234F")).toBe(false); // PAN shape, not TAN shape
  });

  it("BSR_CODE_REGEX matches exactly a 7-digit token, and does NOT match inside a longer unbroken digit run (word boundaries don't split digit-to-digit)", () => {
    expect(BSR_CODE_REGEX.test("1234567")).toBe(true);
    expect("123456".match(BSR_CODE_REGEX)).toBeNull();
    expect("123456789".match(BSR_CODE_REGEX)).toBeNull();
    // A genuinely separate 7-digit token (space-delimited) still matches.
    expect("BSR 1234567 done".match(BSR_CODE_REGEX)?.[1]).toBe("1234567");
  });

  it("AMOUNT_REGEX captures the numeric group without a currency symbol", () => {
    const match = "Rs. 1,50,000".match(AMOUNT_REGEX);
    expect(match?.[1]).toBe("1,50,000");
  });
});

describe("findLabeledValue", () => {
  it("finds a value on the same line right after the label", () => {
    const result = findLabeledValue(["PAN of the Employee: ABCDE1234F"], [/pan\s*of\s*the\s*employee/i], PAN_REGEX);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toBe("ABCDE1234F");
      expect(result.confidence).toBe("high");
    }
  });

  it("falls back to the next line when the label's own line has no usable value", () => {
    const result = findLabeledValue(
      ["Name of the Employee", "Rohan Sharma"],
      [/name\s*of\s*the\s*employee/i],
      /^(.+)$/
    );
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toBe("Rohan Sharma");
      expect(result.confidence).toBe("medium");
    }
  });

  it("falls back to a low-confidence whole-line match as a last resort", () => {
    // The label is at the END of the line (nothing usable after it), and the
    // next line is blank — so the only thing left to search is the label's
    // own line as a whole, which happens to contain a PAN-shaped substring
    // *before* the label text itself.
    const result = findLabeledValue(["ABCDE1234F Reference", ""], [/reference/i], PAN_REGEX);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toBe("ABCDE1234F");
      expect(result.confidence).toBe("low");
    }
  });

  it("returns not-found when no line matches any label pattern", () => {
    const result = findLabeledValue(["Some unrelated line"], [/pan\s*of\s*the\s*employee/i], PAN_REGEX);
    expect(result.found).toBe(false);
  });
});

describe("findLabeledAmount", () => {
  it("extracts and parses a labeled rupee amount", () => {
    const result = findLabeledAmount(["Gross Salary 18,00,000"], [/gross\s*salary/i]);
    expect(result.found).toBe(true);
    if (result.found) expect(result.value).toBe(1800000);
  });

  it("returns not-found (with a reason) if the label matches but no amount follows", () => {
    const result = findLabeledAmount(["Gross Salary: N/A", ""], [/gross\s*salary/i]);
    expect(result.found).toBe(false);
  });
});

describe("findFirstMatchAnywhere", () => {
  it("finds the first match anywhere with no label requirement, at low confidence by default", () => {
    const result = findFirstMatchAnywhere(["random text", "ABCDE1234F appears here"], PAN_REGEX);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toBe("ABCDE1234F");
      expect(result.confidence).toBe("low");
    }
  });

  it("honors an explicit medium-confidence override", () => {
    const result = findFirstMatchAnywhere(["ABCDE1234F"], PAN_REGEX, "medium");
    expect(result.found).toBe(true);
    if (result.found) expect(result.confidence).toBe("medium");
  });

  it("returns not-found when nothing matches anywhere", () => {
    const result = findFirstMatchAnywhere(["no pan here"], PAN_REGEX);
    expect(result.found).toBe(false);
  });
});
