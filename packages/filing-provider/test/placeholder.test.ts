import { describe, expect, it } from "vitest";
import { FILING_PROVIDER_PACKAGE } from "../src/index.js";

describe("filing-provider package scaffold", () => {
  it("exposes a package identifier", () => {
    expect(FILING_PROVIDER_PACKAGE).toBe("@cleartax/filing-provider");
  });
});
