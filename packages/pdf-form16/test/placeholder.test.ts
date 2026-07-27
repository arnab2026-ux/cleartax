import { describe, expect, it } from "vitest";
import { PDF_FORM16_PACKAGE } from "../src/index.js";

describe("pdf-form16 package scaffold", () => {
  it("exposes a package identifier", () => {
    expect(PDF_FORM16_PACKAGE).toBe("@cleartax/pdf-form16");
  });
});
