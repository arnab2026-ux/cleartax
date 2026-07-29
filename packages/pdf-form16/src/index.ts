export * from "./types";
export { decryptForm16Pdf, derivePanDobPassword } from "./decrypt";
export { extractText, reconstructLines } from "./extractText";
export { parsePartA } from "./parsePartA";
export { parsePartB } from "./parsePartB";

import { decryptForm16Pdf } from "./decrypt";
import { extractText } from "./extractText";
import { parsePartA } from "./parsePartA";
import { parsePartB } from "./parsePartB";
import type { DecryptOptions, Form16PartA, Form16PartB, PasswordSource } from "./types";

export type ParseForm16PdfResult =
  | { status: "success"; partA: Form16PartA; partB: Form16PartB; passwordUsed: PasswordSource }
  | { status: "needs-password" }
  | { status: "wrong-password"; attempted: PasswordSource[] }
  | { status: "no-text-layer"; message: string }
  | { status: "failed"; message: string };

/**
 * End-to-end convenience pipeline: decrypt (if needed) -> extract text ->
 * heuristically parse Part A + Part B. This is the single entry point most
 * callers (e.g. the upload API route) should use instead of wiring
 * decrypt/extractText/parsePartA/parsePartB together themselves.
 *
 * The result is still just heuristic, low-trust output — see
 * `ExtractedField` in types.ts. A mandatory human review/edit UI (Phase 5)
 * must sit between this and anything that feeds the tax engine.
 */
export async function parseForm16Pdf(
  data: Uint8Array,
  options: DecryptOptions = {}
): Promise<ParseForm16PdfResult> {
  const decryptResult = await decryptForm16Pdf(data, options);
  if (decryptResult.status !== "success") {
    return decryptResult;
  }

  try {
    const extractResult = await extractText(decryptResult.document);
    if (extractResult.status !== "success") {
      return extractResult;
    }

    const partA = parsePartA(extractResult.document);
    const partB = parsePartB(extractResult.document);
    return { status: "success", partA, partB, passwordUsed: decryptResult.passwordUsed };
  } finally {
    await decryptResult.document.destroy();
  }
}
