import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * How confident a heuristic extractor is in a field it pulled out of a
 * Form 16 PDF's reconstructed text. This is a *safety* property, not a nice-
 * to-have: nothing produced by this package is ever meant to be trusted
 * blindly. A mandatory human review/edit UI (Phase 5) sits between this
 * output and anything that feeds the tax engine.
 *
 * - "high"   — matched right next to its expected label, and the captured
 *              value's shape was validated (e.g. a PAN/TAN regex match).
 * - "medium" — matched a plausible pattern, but either the label wasn't
 *              directly adjacent, or the value's shape wasn't fully
 *              validated, or more than one candidate was found and the
 *              "best" one was picked heuristically.
 * - "low"    — a weak/ambiguous fallback match (e.g. the only numeric value
 *              found near a keyword, with no shape validation at all).
 */
export type Confidence = "high" | "medium" | "low";

/**
 * The result of trying to extract a single field from a Form 16 PDF's text.
 * Deliberately a discriminated union on `found` so callers can never
 * accidentally treat "not found" as a present-but-empty value: TypeScript
 * forces a check of `found` before `value`/`confidence`/`sourceText` are
 * accessible.
 */
export type ExtractedField<T> =
  | {
      found: true;
      value: T;
      confidence: Confidence;
      /** The raw line(s) of reconstructed text the value was pulled from, for audit/debugging in the review UI. */
      sourceText?: string;
    }
  | {
      found: false;
      /** Why nothing was found — e.g. "no line matched the expected label pattern". Purely diagnostic. */
      reason?: string;
    };

export function foundField<T>(
  value: T,
  confidence: Confidence,
  sourceText?: string
): ExtractedField<T> {
  return { found: true, value, confidence, sourceText };
}

export function notFound<T>(reason?: string): ExtractedField<T> {
  return { found: false, reason };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/** Which password (if any) was used to successfully open the document. */
export type PasswordSource = "none" | "pan-dob" | "override";

export interface DecryptOptions {
  /** Employee PAN, e.g. "ABCDE1234F". Compared case-insensitively; normalized to uppercase before use. */
  pan?: string;
  /** Employee date of birth. Accepts a Date or an already-formatted "DDMMYYYY" string. */
  dob?: Date | string;
  /** A user-supplied password to try if PAN+DOB doesn't work (or isn't available). */
  overridePassword?: string;
}

export type DecryptResult =
  | {
      status: "success";
      /** The opened pdfjs-dist document — hand this straight to extractText(). */
      document: PDFDocumentProxy;
      passwordUsed: PasswordSource;
    }
  | {
      /** The PDF is password-protected and none of the available candidate passwords (PAN+DOB / override) were even attempted, because none were supplied. Caller should prompt the user for a password. */
      status: "needs-password";
    }
  | {
      /** The PDF is password-protected and every candidate password that WAS tried was rejected. Caller should prompt for a (different) password. */
      status: "wrong-password";
      attempted: PasswordSource[];
    }
  | {
      /** Something else went wrong (corrupt/non-PDF data, unexpected pdfjs-dist error, etc). Not a password problem. */
      status: "failed";
      message: string;
    };

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

export interface PositionedTextItem {
  text: string;
  /** x position in unrotated PDF user-space units (from the item's transform matrix). */
  x: number;
  /** y position in unrotated PDF user-space units (increases upward). */
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface TextLine {
  /** Representative y-coordinate for the whole line (average of its items' y). */
  y: number;
  items: PositionedTextItem[];
  /** Items joined left-to-right with heuristic spacing that tries to preserve tabular/column gaps. */
  text: string;
}

export interface PageText {
  pageNumber: number;
  lines: TextLine[];
}

export interface ExtractedDocumentText {
  pages: PageText[];
  /** All lines from all pages, in reading order, newline-joined. Convenient for whole-document regex passes. */
  fullText: string;
}

export type ExtractTextResult =
  | { status: "success"; document: ExtractedDocumentText }
  | {
      /** No page in the document had any extractable text items — almost certainly a scanned/image-only PDF. OCR is out of scope; surface this to the user and direct them to manual entry. */
      status: "no-text-layer";
      message: string;
    }
  | { status: "failed"; message: string };

// ---------------------------------------------------------------------------
// Part A — TDS certificate details
// ---------------------------------------------------------------------------

export interface QuarterlyTds {
  /** "Q1" | "Q2" | "Q3" | "Q4" */
  quarter: ExtractedField<string>;
  /** Total TDS deposited for the quarter, in rupees. */
  amountDeposited: ExtractedField<number>;
  receiptNumber: ExtractedField<string>;
  bsrCode: ExtractedField<string>;
  depositDate: ExtractedField<string>;
}

export interface Form16PartA {
  employerName: ExtractedField<string>;
  employerAddress: ExtractedField<string>;
  employerTan: ExtractedField<string>;
  employerPan: ExtractedField<string>;
  employeeName: ExtractedField<string>;
  employeePan: ExtractedField<string>;
  assessmentYear: ExtractedField<string>;
  periodFrom: ExtractedField<string>;
  periodTo: ExtractedField<string>;
  quarterlyTds: QuarterlyTds[];
  totalTdsDeposited: ExtractedField<number>;
  /**
   * The TRACES certificate number printed at the top of Part A (and repeated
   * in every continuation-page banner), e.g. "SRXJVMA".
   *
   * Deliberately OPTIONAL: there is no database column for it and nothing
   * downstream consumes it, so making it required would break existing
   * callers that construct a `Form16PartA` literal. It is extracted anyway
   * because it is the single field that distinguishes a genuine
   * TRACES-issued Part A (the only kind with legal validity) from a
   * hand-typed one — cheap, useful provenance for the review screen if it is
   * ever wired up.
   */
  certificateNumber?: ExtractedField<string>;
}

// ---------------------------------------------------------------------------
// Part B — salary breakup & tax computation
// ---------------------------------------------------------------------------

export interface ChapterViaDeductionLine {
  /** Section code as printed, e.g. "80C", "80CCD(1B)", "80D". */
  section: ExtractedField<string>;
  amount: ExtractedField<number>;
}

export interface Form16PartB {
  grossSalary: ExtractedField<number>;
  /** Salary as per section 17(1), if separately stated. */
  salarySection17_1: ExtractedField<number>;
  perquisitesSection17_2: ExtractedField<number>;
  profitsInLieuSection17_3: ExtractedField<number>;
  exemptionHra: ExtractedField<number>;
  exemptionLta: ExtractedField<number>;
  exemptionTransport: ExtractedField<number>;
  /**
   * The Section 10 retirement heads listed under Part B item 2. These are
   * split out individually — rather than lumped into one "other exemptions"
   * figure — because the tax engine needs them separated by REGIME, not by
   * name: gratuity 10(10), commuted pension 10(10A), leave encashment
   * 10(10AA) and VRS compensation 10(10C) all survive the new regime, while
   * HRA 10(13A), LTA 10(5) and the 10(14) special allowances do not (see
   * `fullIncome.ts`'s `otherSection10Exemptions` doc comment for sources).
   *
   * Getting this split wrong is not cosmetic: a genuine AY 2026-27
   * certificate for a taxpayer who had NOT opted out of 115BAC still claimed
   * ₹3,51,000 of leave encashment, and treating that as old-regime-only
   * would have over-taxed them by roughly ₹1,09,512.
   */
  exemptionGratuity: ExtractedField<number>;
  exemptionCommutedPension: ExtractedField<number>;
  exemptionLeaveEncashment: ExtractedField<number>;
  exemptionVrs: ExtractedField<number>;
  /**
   * Item 2's catch-all line ("Amount of any other exemption under section
   * 10"). Its regime treatment is genuinely unknowable from the label alone —
   * it could be a surviving retirement head or a withdrawn allowance — so
   * consumers should treat it as old-regime-only, which over-taxes rather
   * than under-taxes, and surface it for the user to reclassify at review.
   */
  exemptionOtherSection10: ExtractedField<number>;
  /**
   * Item 2's own total ("Total amount of exemption claimed under section
   * 10"), as printed. Extracted for RECONCILIATION, not as the figure to
   * compute from: comparing it against the sum of the individually
   * identified heads above is what catches a head this parser did not
   * recognise, on a layout nobody has seen yet.
   */
  totalSection10Exemption: ExtractedField<number>;
  /**
   * Item 3, "Total amount of salary received from current employer"
   * (= item 1(d) less item 2). Also a reconciliation figure — it is the
   * certificate's own statement of salary after Section 10 but before
   * Section 16, which is exactly the intermediate the tax engine computes as
   * `FullTaxableIncomeResult.salaryAfterSection10`.
   */
  salaryAfterSection10: ExtractedField<number>;
  standardDeduction: ExtractedField<number>;
  professionalTax: ExtractedField<number>;
  incomeChargeableUnderSalaries: ExtractedField<number>;
  chapterViaDeductions: ChapterViaDeductionLine[];
  totalChapterViaDeductions: ExtractedField<number>;
  grossTotalIncome: ExtractedField<number>;
  totalTaxableIncome: ExtractedField<number>;
  /** The employer's own computed total tax liability / tax payable, as stated on the form — NOT recomputed by this package. */
  totalTaxByEmployer: ExtractedField<number>;
}

export interface Form16ParseResult {
  partA: Form16PartA;
  partB: Form16PartB;
}
