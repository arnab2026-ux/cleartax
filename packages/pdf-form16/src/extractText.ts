import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ExtractedDocumentText,
  ExtractTextResult,
  PageText,
  PositionedTextItem,
  TextLine,
} from "./types";

const NO_TEXT_LAYER_MESSAGE =
  "No extractable text found in this PDF — it is likely a scanned/image-only " +
  "document. Automatic parsing is not possible (OCR is out of scope for this " +
  "tool); please enter the Form 16 details manually.";

/**
 * A "column break" gap, in PDF user-space units, beyond which we insert an
 * explicit tab between two text runs on the same line instead of a plain
 * space. Tuned for typical 9-12pt Form 16 body text; tables in these forms
 * tend to leave noticeably wider gaps between columns than between words.
 */
const COLUMN_GAP_THRESHOLD = 12;
/** Gaps below this are treated as "touching" (no separator at all) — pdfjs-dist commonly splits a single word into adjacent glyph runs with no space between them. */
const TOUCHING_GAP_THRESHOLD = 0.5;

/**
 * Reconstruct reading-order lines from pdfjs-dist's flat per-glyph-run item
 * list. Naive top-to-bottom concatenation of `item.str` scrambles
 * multi-column tabular data (exactly what Part A's quarterly TDS table and
 * Part B's salary breakup look like), so instead we cluster items by
 * y-coordinate (rows) and then order each row's items by x (columns).
 */
export function reconstructLines(items: PositionedTextItem[]): TextLine[] {
  const meaningful = items.filter((item) => item.text.length > 0);
  if (meaningful.length === 0) return [];

  // Reading order top-to-bottom: PDF y increases upward, so sort descending.
  // Tie-break left-to-right.
  const sorted = [...meaningful].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: PositionedTextItem[][] = [];
  let currentRow: PositionedTextItem[] = [];
  let anchorY = sorted[0]!.y;
  let anchorHeight = sorted[0]!.height;

  for (const item of sorted) {
    const tolerance = Math.max(2, (anchorHeight || item.height || 4) * 0.5);
    if (currentRow.length > 0 && Math.abs(item.y - anchorY) > tolerance) {
      rows.push(currentRow);
      currentRow = [];
      anchorHeight = item.height;
      anchorY = item.y;
    } else if (currentRow.length === 0) {
      anchorY = item.y;
      anchorHeight = item.height;
    }
    currentRow.push(item);
  }
  if (currentRow.length > 0) rows.push(currentRow);

  return rows.map((row) => buildLine(row));
}

function buildLine(rowItems: PositionedTextItem[]): TextLine {
  const items = [...rowItems].sort((a, b) => a.x - b.x);

  let text = "";
  let prevEndX: number | null = null;
  for (const item of items) {
    if (prevEndX !== null) {
      const gap = item.x - prevEndX;
      if (gap > COLUMN_GAP_THRESHOLD) {
        text += "\t";
      } else if (gap > TOUCHING_GAP_THRESHOLD) {
        text += " ";
      }
      // else: touching glyph runs, no separator — likely mid-word.
    }
    text += item.text;
    prevEndX = item.x + item.width;
  }

  const y = items.reduce((sum, it) => sum + it.y, 0) / items.length;
  return { y, items, text: text.trim() };
}

/**
 * Extract text (with reconstructed line/column structure) from every page of
 * an already-opened pdfjs-dist document. Detects the "no text layer at all"
 * case (scanned/image-only PDF) and reports it as a distinct, clearly-worded
 * result rather than silently returning an empty document — this must be
 * surfaced to the user as a manual-entry fallback, never attempted via OCR.
 */
export async function extractText(document: PDFDocumentProxy): Promise<ExtractTextResult> {
  try {
    const pages: PageText[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const items: PositionedTextItem[] = [];
        for (const raw of textContent.items) {
          if (!("str" in raw)) continue; // TextMarkedContent marker, not text
          if (raw.str.length === 0) continue;
          const transform = raw.transform;
          items.push({
            text: raw.str,
            x: transform[4] ?? 0,
            y: transform[5] ?? 0,
            width: raw.width,
            height: raw.height,
            fontName: raw.fontName,
          });
        }
        pages.push({ pageNumber, lines: reconstructLines(items) });
      } finally {
        page.cleanup();
      }
    }

    const fullText = pages
      .flatMap((p) => p.lines.map((l) => l.text))
      .join("\n");

    if (fullText.trim().length === 0) {
      return { status: "no-text-layer", message: NO_TEXT_LAYER_MESSAGE };
    }

    const result: ExtractedDocumentText = { pages, fullText };
    return { status: "success", document: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", message };
  }
}
