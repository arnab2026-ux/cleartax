import { describe, expect, it } from "vitest";
import { TAX_ENGINE_PACKAGE } from "../src/index.js";

describe("tax-engine package scaffold", () => {
  it("exposes a package identifier", () => {
    expect(TAX_ENGINE_PACKAGE).toBe("@cleartax/tax-engine");
  });
});
