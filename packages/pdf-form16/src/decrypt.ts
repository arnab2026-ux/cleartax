import { dirname, join } from "node:path";
import { createRequire } from "node:module";
// pdfjs-dist's own Node.js entry point warns "Please use the `legacy` build in
// Node.js environments" if you import the default (browser-oriented) build
// from Node — see pdfjs-dist/build/pdf.mjs's node_utils.js. The `legacy`
// build is functionally identical for our purposes (text extraction only, no
// canvas rendering) and avoids that warning.
import {
  getDocument,
  PasswordResponses,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DecryptOptions, DecryptResult, PasswordSource } from "./types";

// `DocumentInitParameters` isn't part of this build's exported type surface
// (only a curated subset of pdfjs-dist's internal types are re-exported), so
// we declare the small subset of fields this module actually passes to
// getDocument() ourselves instead of depending on an unexported type name.
interface BaseDocumentOptions {
  standardFontDataUrl: string;
  useSystemFonts: boolean;
  isEvalSupported: boolean;
  disableFontFace: boolean;
}

const require = createRequire(import.meta.url);

/**
 * Absolute path (with trailing slash) to pdfjs-dist's bundled standard font
 * metrics, needed so glyph/width lookups for non-embedded standard fonts
 * (very common in Form 16 PDFs, which are usually generated with plain
 * Helvetica/Times) resolve correctly instead of falling back to (less
 * accurate) recovery behavior. Resolved once per process.
 */
function standardFontDataUrl(): string {
  const pdfjsPackageJson = require.resolve("pdfjs-dist/package.json");
  const pdfjsRoot = dirname(pdfjsPackageJson);
  return join(pdfjsRoot, "standard_fonts").replace(/\\/g, "/") + "/";
}

/**
 * Options shared by every getDocument() call this module makes. `data` is
 * intentionally omitted here — pdfjs-dist takes ownership of (transfers) the
 * TypedArray it's given, so every attempt must pass its own fresh copy; see
 * openAttempt() below.
 */
function baseDocumentOptions(): BaseDocumentOptions {
  return {
    standardFontDataUrl: standardFontDataUrl(),
    // No network/DOM available server-side; keep pdfjs entirely offline.
    useSystemFonts: false,
    isEvalSupported: true,
    disableFontFace: true,
  };
}

const ISO_DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Last day of `month` (1-12) in `year`, via the "day 0 of next month" trick. */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** PAN(uppercase) + DOB(DDMMYYYY) — the very common (not universal) Form 16 PDF password convention. */
export function derivePanDobPassword(pan: string | undefined, dob: Date | string | undefined): string | undefined {
  if (!pan || !dob) return undefined;
  const panPart = pan.trim().toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panPart)) return undefined;

  let dobPart: string;
  if (typeof dob === "string") {
    if (/^\d{8}$/.test(dob)) {
      dobPart = dob;
    } else {
      const isoMatch = dob.match(ISO_DATE_ONLY_REGEX);
      if (isoMatch) {
        // Parse the numeric components directly rather than round-tripping
        // through `new Date(dob)` + local-timezone getters, which has two
        // footguns for a password-derivation function:
        //  1. JS silently *rolls over* invalid calendar dates instead of
        //     rejecting them — `new Date("2001-02-29")` (2001 isn't a leap
        //     year) doesn't throw or produce NaN, it quietly becomes 1 Mar
        //     2001. A typo'd/wrong DOB would then derive a confident-looking
        //     but wrong password, failing later as an opaque "wrong
        //     password" with no hint the DOB itself was invalid.
        //  2. Date-only ISO strings ("YYYY-MM-DD") parse as UTC midnight,
        //     but `Date.prototype.getDate()`/`getMonth()` read *local* time
        //     — in a negative UTC-offset timezone this can silently shift
        //     the derived day back by one, making the derived password
        //     depend on the server's local timezone. (Not a live issue on
        //     this app's actual Vercel deployment target, which runs in
        //     UTC, but a real landmine for local dev in the Americas and
        //     for portability if that ever changes.)
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
          return undefined;
        }
        dobPart = `${String(day).padStart(2, "0")}${String(month).padStart(2, "0")}${year}`;
      } else {
        const parsed = new Date(dob);
        if (Number.isNaN(parsed.getTime())) return undefined;
        dobPart = formatDdmmyyyy(parsed);
      }
    }
  } else {
    if (Number.isNaN(dob.getTime())) return undefined;
    dobPart = formatDdmmyyyy(dob);
  }

  return `${panPart}${dobPart}`;
}

function formatDdmmyyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

interface PdfErrorLike {
  name?: string;
  code?: number;
  message?: string;
}

function isPasswordException(err: unknown): err is PdfErrorLike & { name: "PasswordException" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as PdfErrorLike).name === "PasswordException"
  );
}

/** Result of a single getDocument() attempt, normalized so callers don't need to touch pdfjs-dist exceptions directly. */
type AttemptResult =
  | { outcome: "success"; document: PDFDocumentProxy }
  | { outcome: "need-password" }
  | { outcome: "incorrect-password" }
  | { outcome: "other-error"; message: string };

async function openAttempt(data: Uint8Array, password: string | undefined): Promise<AttemptResult> {
  // pdfjs-dist takes ownership of (and detaches) the buffer it's handed, so
  // every attempt gets its own copy — reusing `data` across calls would make
  // the 2nd+ attempt fail with an unrelated "detached ArrayBuffer" TypeError.
  const attemptData = data.slice();
  const loadingTask = getDocument({
    ...baseDocumentOptions(),
    data: attemptData,
    password,
  });
  try {
    const document = await loadingTask.promise;
    return { outcome: "success", document };
  } catch (err) {
    if (isPasswordException(err)) {
      if (err.code === PasswordResponses.INCORRECT_PASSWORD) {
        return { outcome: "incorrect-password" };
      }
      // NEED_PASSWORD, or (defensively) any other PasswordException code.
      return { outcome: "need-password" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { outcome: "other-error", message };
  }
  // On the success path the caller owns the returned `document` and is
  // responsible for eventually calling `document.destroy()`.
}

/**
 * Try to open a (possibly password-protected) Form 16 PDF.
 *
 * Order of attempts:
 *   1. No password (most PDFs aren't actually encrypted).
 *   2. A PAN+DOB-derived password, if both were supplied (the common — but
 *      not universal — Form 16 convention: PAN uppercase + DOB as DDMMYYYY).
 *   3. A user-supplied override password, if supplied.
 *
 * Never throws for expected "this PDF needs/rejects a password" cases —
 * callers (e.g. a later-phase upload/review UI) should drive a retry flow
 * off the returned status rather than catching exceptions.
 */
export async function decryptForm16Pdf(
  data: Uint8Array,
  options: DecryptOptions = {}
): Promise<DecryptResult> {
  const noPasswordAttempt = await openAttempt(data, undefined);
  if (noPasswordAttempt.outcome === "success") {
    return { status: "success", document: noPasswordAttempt.document, passwordUsed: "none" };
  }
  if (noPasswordAttempt.outcome === "other-error") {
    return { status: "failed", message: noPasswordAttempt.message };
  }
  // outcome is "need-password" or "incorrect-password" here; either way the
  // document is encrypted and we need a real password to proceed. (Passing
  // no `password` field to getDocument() always yields NEED_PASSWORD, never
  // INCORRECT_PASSWORD, but we branch on both defensively.)

  const candidates: Array<{ source: PasswordSource; password: string }> = [];
  const panDobPassword = derivePanDobPassword(options.pan, options.dob);
  if (panDobPassword) candidates.push({ source: "pan-dob", password: panDobPassword });
  if (options.overridePassword) {
    candidates.push({ source: "override", password: options.overridePassword });
  }

  if (candidates.length === 0) {
    return { status: "needs-password" };
  }

  const attempted: PasswordSource[] = [];
  for (const candidate of candidates) {
    const attempt = await openAttempt(data, candidate.password);
    if (attempt.outcome === "success") {
      return { status: "success", document: attempt.document, passwordUsed: candidate.source };
    }
    if (attempt.outcome === "other-error") {
      return { status: "failed", message: attempt.message };
    }
    attempted.push(candidate.source);
  }

  return { status: "wrong-password", attempted };
}
