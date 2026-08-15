import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __standardFontDataUrlForTest, decryptForm16Pdf, derivePanDobPassword } from "../src/decrypt.js";
import { FIXTURE_VALUES, buildSyntheticForm16Pdf } from "./fixtures.js";

describe("standard font data resolution (bundler safety)", () => {
  // Regression test for a production 500 on EVERY Form 16 upload. The binding
  // used to be named `require`, which bundlers pattern-match and rewrite into
  // their own resolver, returning a numeric module id — so dirname() threw
  // `The "path" argument must be of type string. Received type number (5102)`.
  // Nothing caught it before deployment: unbundled Node, vitest and
  // `next build` all resolve normally, and only the bundled runtime differs.
  it("resolves to a path string, never a bundler module id", () => {
    const resolved = __standardFontDataUrlForTest();
    expect(typeof resolved === "string" || resolved === undefined).toBe(true);
    if (typeof resolved === "string") {
      expect(resolved).toMatch(/standard_fonts\/$/);
      // A module id would stringify to a bare number.
      expect(Number.isNaN(Number(resolved))).toBe(true);
    }
  });

  it("degrades instead of throwing when resolution fails", () => {
    // The font metrics improve glyph accuracy but are not a prerequisite for
    // text extraction, so losing them must never cost the user their upload.
    expect(() => __standardFontDataUrlForTest()).not.toThrow();
  });
});

describe("derivePanDobPassword", () => {
  it("builds PAN(uppercase) + DOB(DDMMYYYY) from a lowercase PAN and a Date", () => {
    const dob = new Date(1990, 0, 28); // month is 0-indexed -> 28 Jan 1990
    expect(derivePanDobPassword("abcde1234f", dob)).toBe("ABCDE1234F28011990");
  });

  it("accepts a DOB already given as a DDMMYYYY string", () => {
    expect(derivePanDobPassword("ABCDE1234F", "28011990")).toBe("ABCDE1234F28011990");
  });

  it("accepts a DOB given as a parseable date string", () => {
    expect(derivePanDobPassword("ABCDE1234F", "1990-01-28")).toBe("ABCDE1234F28011990");
  });

  it("returns undefined when PAN is missing", () => {
    expect(derivePanDobPassword(undefined, "28011990")).toBeUndefined();
  });

  it("returns undefined when DOB is missing", () => {
    expect(derivePanDobPassword("ABCDE1234F", undefined)).toBeUndefined();
  });

  it("returns undefined for a malformed PAN", () => {
    expect(derivePanDobPassword("NOTAPAN", "28011990")).toBeUndefined();
  });

  it("returns undefined for an unparseable DOB string", () => {
    expect(derivePanDobPassword("ABCDE1234F", "not-a-date")).toBeUndefined();
  });

  it("accepts a leap-day DOB in an actual leap year", () => {
    expect(derivePanDobPassword("ABCDE1234F", "2000-02-29")).toBe("ABCDE1234F29022000");
  });

  it("rejects a leap-day DOB in a non-leap year instead of silently rolling over to March 1st", () => {
    // `new Date("2001-02-29")` does NOT throw or produce NaN -- it silently
    // normalizes to 1 Mar 2001, which would previously have derived a
    // confidently-wrong password ("ABCDE1234F01032001") with no error
    // anywhere in the chain. 2001 is not a leap year, so this DOB is invalid
    // and derivation must fail loudly (return undefined) instead.
    expect(derivePanDobPassword("ABCDE1234F", "2001-02-29")).toBeUndefined();
  });

  it("rejects an out-of-range day for a 30-day month instead of silently rolling over", () => {
    // April has 30 days; `new Date("2024-04-31")` silently becomes 1 May 2024.
    expect(derivePanDobPassword("ABCDE1234F", "2024-04-31")).toBeUndefined();
  });

  it("rejects a month outside 1-12 for an ISO-shaped DOB string", () => {
    expect(derivePanDobPassword("ABCDE1234F", "1990-13-01")).toBeUndefined();
  });
});

describe("decryptForm16Pdf — against real (unencrypted) PDFs", () => {
  it("opens an unencrypted PDF with no password needed", async () => {
    const bytes = await buildSyntheticForm16Pdf();
    const result = await decryptForm16Pdf(bytes);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.passwordUsed).toBe("none");
      await result.document.destroy();
    }
  });

  it("reports failure (not a password problem) for corrupt/non-PDF data", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = await decryptForm16Pdf(garbage);
    expect(result.status).toBe("failed");
  });
});

/**
 * There is no real encrypted-PDF fixture in this suite (see fixtures.ts for
 * why: pdf-lib can't write encrypted PDFs, and the alternative package that
 * can has a confirmed dependency bug). Instead, these tests mock pdfjs-dist's
 * `getDocument` to reject with the same shape `decrypt.ts`'s
 * `isPasswordException()` duck-type check looks for (`name:
 * "PasswordException"`, a `code` matching `PasswordResponses`) — note
 * `PasswordException` itself is NOT part of this build's exported surface
 * (only `PasswordResponses` is; confirmed by grepping the bundle's export
 * list), so a plain object is used rather than the real class. This
 * exercises `decryptForm16Pdf`'s branching logic faithfully without needing
 * a real encrypted file.
 */
function passwordError(code: number): { name: string; code: number } {
  return { name: "PasswordException", code };
}

describe("decryptForm16Pdf — password branching, via a mocked pdfjs-dist", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
  });

  it("returns needs-password when the PDF is encrypted and no PAN/DOB/override candidates are available", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const actual = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...actual,
        getDocument: () => ({
          promise: Promise.reject(passwordError(actual.PasswordResponses.NEED_PASSWORD)),
        }),
      };
    });
    const { decryptForm16Pdf: mockedDecrypt } = await import("../src/decrypt.js");
    const result = await mockedDecrypt(new Uint8Array([1, 2, 3]), {});
    expect(result.status).toBe("needs-password");
  });

  it("returns wrong-password (attempted: pan-dob) when a PAN+DOB candidate is tried and rejected", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const actual = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...actual,
        getDocument: (opts: { password?: string }) => ({
          promise: Promise.reject(
            passwordError(
              opts.password ? actual.PasswordResponses.INCORRECT_PASSWORD : actual.PasswordResponses.NEED_PASSWORD
            )
          ),
        }),
      };
    });
    const { decryptForm16Pdf: mockedDecrypt } = await import("../src/decrypt.js");
    const result = await mockedDecrypt(new Uint8Array([1, 2, 3]), {
      pan: FIXTURE_VALUES.employeePan,
      dob: FIXTURE_VALUES.employeeDob,
    });
    expect(result.status).toBe("wrong-password");
    if (result.status === "wrong-password") {
      expect(result.attempted).toEqual(["pan-dob"]);
    }
  });

  it("succeeds via the PAN+DOB candidate when it's the correct password", async () => {
    const correctPassword = `${FIXTURE_VALUES.employeePan}${FIXTURE_VALUES.employeeDob}`;
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const actual = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...actual,
        getDocument: (opts: { password?: string }) => ({
          promise:
            opts.password === correctPassword
              ? Promise.resolve({ destroy: () => Promise.resolve() })
              : Promise.reject(
                  passwordError(
                    opts.password ? actual.PasswordResponses.INCORRECT_PASSWORD : actual.PasswordResponses.NEED_PASSWORD
                  )
                ),
        }),
      };
    });
    const { decryptForm16Pdf: mockedDecrypt } = await import("../src/decrypt.js");
    const result = await mockedDecrypt(new Uint8Array([1, 2, 3]), {
      pan: FIXTURE_VALUES.employeePan,
      dob: FIXTURE_VALUES.employeeDob,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.passwordUsed).toBe("pan-dob");
    }
  });

  it("falls through to the override password when PAN+DOB is wrong but the override is correct", async () => {
    const overridePassword = "custom-secret";
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const actual = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...actual,
        getDocument: (opts: { password?: string }) => ({
          promise:
            opts.password === overridePassword
              ? Promise.resolve({ destroy: () => Promise.resolve() })
              : Promise.reject(
                  passwordError(
                    opts.password ? actual.PasswordResponses.INCORRECT_PASSWORD : actual.PasswordResponses.NEED_PASSWORD
                  )
                ),
        }),
      };
    });
    const { decryptForm16Pdf: mockedDecrypt } = await import("../src/decrypt.js");
    const result = await mockedDecrypt(new Uint8Array([1, 2, 3]), {
      pan: FIXTURE_VALUES.employeePan,
      dob: FIXTURE_VALUES.employeeDob, // wrong password for this test's mock
      overridePassword,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.passwordUsed).toBe("override");
    }
  });

  it("returns wrong-password listing both candidates when neither PAN+DOB nor override is correct", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const actual = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...actual,
        getDocument: (opts: { password?: string }) => ({
          promise: Promise.reject(
            passwordError(
              opts.password ? actual.PasswordResponses.INCORRECT_PASSWORD : actual.PasswordResponses.NEED_PASSWORD
            )
          ),
        }),
      };
    });
    const { decryptForm16Pdf: mockedDecrypt } = await import("../src/decrypt.js");
    const result = await mockedDecrypt(new Uint8Array([1, 2, 3]), {
      pan: FIXTURE_VALUES.employeePan,
      dob: FIXTURE_VALUES.employeeDob,
      overridePassword: "still-wrong",
    });
    expect(result.status).toBe("wrong-password");
    if (result.status === "wrong-password") {
      expect(result.attempted).toEqual(["pan-dob", "override"]);
    }
  });
});
