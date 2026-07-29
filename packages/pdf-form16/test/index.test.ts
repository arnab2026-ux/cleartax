import { describe, expect, it } from "vitest";
import { parseForm16Pdf } from "../src/index.js";
import { FIXTURE_VALUES, buildNoTextLayerPdf, buildSyntheticForm16Pdf } from "./fixtures.js";

describe("parseForm16Pdf — end-to-end pipeline", () => {
  it("decrypts (no-op for an unencrypted PDF), extracts, and parses both parts in one call", async () => {
    const bytes = await buildSyntheticForm16Pdf();
    const result = await parseForm16Pdf(bytes);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.passwordUsed).toBe("none");
    expect(result.partA.employerTan).toMatchObject({ found: true, value: FIXTURE_VALUES.employerTan });
    expect(result.partB.grossSalary).toMatchObject({ found: true, value: FIXTURE_VALUES.grossSalary });
  });

  it("surfaces the no-text-layer case (scanned/image-only PDF) instead of returning empty/fabricated fields", async () => {
    const bytes = await buildNoTextLayerPdf();
    const result = await parseForm16Pdf(bytes);
    expect(result.status).toBe("no-text-layer");
  });

  it("surfaces a failure for corrupt/non-PDF input", async () => {
    const result = await parseForm16Pdf(new Uint8Array([9, 9, 9, 9]));
    expect(result.status).toBe("failed");
  });
});
