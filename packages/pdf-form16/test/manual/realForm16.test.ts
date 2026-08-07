/**
 * Runs a REAL Form 16 PDF through the full pipeline and prints everything it
 * extracted, with confidence levels — the hands-on check Phase 10 could not
 * perform without a genuine document.
 *
 * SKIPPED unless you point it at a file, so it never runs in CI and no real
 * document, password, or figure is ever committed:
 *
 *   cd packages/pdf-form16
 *   FORM16_PATH="C:/path/Form16.pdf" FORM16_PASSWORD="secret" npx vitest run test/manual
 *
 * This is a diagnostic, not an assertion suite — it prints, it doesn't judge.
 * Compare the output against the actual PDF by eye.
 */
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseForm16Pdf } from "../../src/index";
import type { ExtractedField } from "../../src/types";

const pdfPath = process.env.FORM16_PATH;
const password = process.env.FORM16_PASSWORD;

function show(label: string, field: ExtractedField<unknown> | undefined): void {
  if (!field) {
    console.log(`  ${label.padEnd(34)} —`);
  } else if (!field.found) {
    console.log(`  ${label.padEnd(34)} NOT FOUND  (${field.reason})`);
  } else {
    console.log(`  ${label.padEnd(34)} [${field.confidence.toUpperCase().padEnd(6)}] ${String(field.value)}`);
  }
}

describe.skipIf(!pdfPath)("real Form 16 diagnostic", () => {
  it("prints every extracted field", async () => {
    const bytes = new Uint8Array(readFileSync(pdfPath as string));
    const result = await parseForm16Pdf(bytes, password ? { overridePassword: password } : {});

    console.log(`\nstatus: ${result.status}`);
    if (result.status !== "success") {
      if ("message" in result) console.log(`message: ${result.message}`);
      if ("attempted" in result) console.log(`attempted: ${result.attempted.join(", ")}`);
      return;
    }
    console.log(`passwordUsed: ${result.passwordUsed}`);

    console.log("\n=== PART A ===");
    const a = result.partA;
    for (const [key, value] of Object.entries(a)) {
      if (key === "quarterlyTds") continue;
      show(key, value as ExtractedField<unknown>);
    }
    console.log(`  quarterlyTds: ${a.quarterlyTds.length} row(s)`);
    a.quarterlyTds.forEach((row, i) => {
      console.log(`    --- row ${i} ---`);
      for (const [key, value] of Object.entries(row)) show(`    ${key}`, value as ExtractedField<unknown>);
    });

    console.log("\n=== PART B ===");
    const b = result.partB;
    for (const [key, value] of Object.entries(b)) {
      if (key === "chapterViaDeductions") continue;
      show(key, value as ExtractedField<unknown>);
    }
    console.log(`  chapterViaDeductions: ${b.chapterViaDeductions.length} line(s)`);
    b.chapterViaDeductions.forEach((line, i) => {
      const sec = line.section.found ? line.section.value : "?";
      const amt = line.amount.found ? String(line.amount.value) : `NOT FOUND (${line.amount.reason})`;
      console.log(`    [${i}] ${String(sec).padEnd(14)} ${amt}`);
    });
  });
});
