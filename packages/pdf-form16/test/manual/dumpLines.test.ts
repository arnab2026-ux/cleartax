/**
 * Dumps the reconstructed text lines of a real Form 16 so extraction problems
 * can be diagnosed against what the parser actually sees. Skipped unless
 * FORM16_PATH is set — see realForm16.test.ts for usage.
 *
 * Set FORM16_GREP to filter to matching lines (case-insensitive).
 */
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { decryptForm16Pdf } from "../../src/decrypt";
import { extractText } from "../../src/extractText";

const pdfPath = process.env.FORM16_PATH;
const password = process.env.FORM16_PASSWORD;
const grep = process.env.FORM16_GREP;

describe.skipIf(!pdfPath)("real Form 16 line dump", () => {
  it("prints reconstructed lines", async () => {
    const bytes = new Uint8Array(readFileSync(pdfPath as string));
    const dec = await decryptForm16Pdf(bytes, password ? { overridePassword: password } : {});
    if (dec.status !== "success") {
      console.log(`decrypt failed: ${dec.status}`);
      return;
    }
    try {
      const ext = await extractText(dec.document);
      if (ext.status !== "success") {
        console.log(`extract failed: ${ext.status}`);
        return;
      }
      const pattern = grep ? new RegExp(grep, "i") : null;
      ext.document.pages.forEach((page, p) => {
        page.lines.forEach((line, i) => {
          if (pattern && !pattern.test(line.text)) return;
          console.log(`p${p}:${String(i).padStart(3)} | ${line.text}`);
        });
      });
    } finally {
      await dec.document.destroy();
    }
  });
});
