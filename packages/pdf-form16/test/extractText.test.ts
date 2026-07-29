import { describe, expect, it } from "vitest";
import { extractText, reconstructLines } from "../src/extractText.js";
import { decryptForm16Pdf } from "../src/decrypt.js";
import type { PositionedTextItem } from "../src/types.js";
import { buildNoTextLayerPdf, buildSyntheticForm16Pdf } from "./fixtures.js";

function item(text: string, x: number, y: number, opts: Partial<PositionedTextItem> = {}): PositionedTextItem {
  return { text, x, y, width: text.length * 5, height: 10, fontName: "F1", ...opts };
}

describe("reconstructLines", () => {
  it("returns an empty array for no items", () => {
    expect(reconstructLines([])).toEqual([]);
  });

  it("groups items with the same y into a single line, ordered left-to-right regardless of input order", () => {
    // Deliberately out of reading order and out of x-order, to prove both the
    // row-clustering (by y) and the within-row ordering (by x) are doing real work.
    const items = [item("World", 60, 100), item("Hello", 0, 100)];
    const lines = reconstructLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain("Hello");
    expect(lines[0]!.text.indexOf("Hello")).toBeLessThan(lines[0]!.text.indexOf("World"));
  });

  it("splits items into separate lines when y differs beyond tolerance", () => {
    const items = [item("Line one", 0, 200), item("Line two", 0, 180)];
    const lines = reconstructLines(items);
    expect(lines).toHaveLength(2);
  });

  it("orders lines top-to-bottom (higher y first, since PDF y increases upward)", () => {
    const items = [item("Bottom", 0, 100), item("Top", 0, 200)];
    const lines = reconstructLines(items);
    expect(lines[0]!.text).toBe("Top");
    expect(lines[1]!.text).toBe("Bottom");
  });

  it("inserts a tab between items separated by a wide (column-like) gap", () => {
    // item at x=0 width=20 ends at x=20; next item starts at x=60 -> gap of 40, well past the 12-unit column threshold.
    const items = [item("Label", 0, 100, { width: 20 }), item("Value", 60, 100)];
    const line = reconstructLines(items)[0]!;
    expect(line.text).toContain("Label\tValue");
  });

  it("inserts a plain space between items separated by a normal word-like gap", () => {
    const items = [item("Hello", 0, 100, { width: 20 }), item("World", 23, 100)]; // gap = 3, below the column threshold, above the touching threshold
    const line = reconstructLines(items)[0]!;
    expect(line.text).toBe("Hello World");
  });

  it("joins directly-touching glyph runs with no separator (mid-word split runs)", () => {
    const items = [item("Hel", 0, 100, { width: 15 }), item("lo", 15.1, 100)]; // gap ~0.1, below the touching threshold
    const line = reconstructLines(items)[0]!;
    expect(line.text).toBe("Hello");
  });

  it("filters out zero-length text items", () => {
    const items = [item("", 0, 100), item("Real", 10, 100)];
    const lines = reconstructLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("Real");
  });
});

describe("extractText — end-to-end against a real PDF", () => {
  it("extracts multi-page text with reconstructed lines from the synthetic Form 16 fixture", async () => {
    const bytes = await buildSyntheticForm16Pdf();
    const dec = await decryptForm16Pdf(bytes);
    expect(dec.status).toBe("success");
    if (dec.status !== "success") return;

    try {
      const result = await extractText(dec.document);
      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(result.document.pages).toHaveLength(2);
      expect(result.document.pages[0]!.lines.length).toBeGreaterThan(5);
      expect(result.document.fullText).toContain("Acme Software Private Limited");
      expect(result.document.fullText).toContain("PART A");
      expect(result.document.fullText).toContain("PART B");
    } finally {
      await dec.document.destroy();
    }
  });

  it("reports no-text-layer for a PDF with no extractable text (scanned/image-only simulation)", async () => {
    const bytes = await buildNoTextLayerPdf();
    const dec = await decryptForm16Pdf(bytes);
    expect(dec.status).toBe("success");
    if (dec.status !== "success") return;

    try {
      const result = await extractText(dec.document);
      expect(result.status).toBe("no-text-layer");
      if (result.status === "no-text-layer") {
        expect(result.message.toLowerCase()).toContain("manual");
      }
    } finally {
      await dec.document.destroy();
    }
  });
});
