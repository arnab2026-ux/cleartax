import { describe, expect, it } from "vitest";
import { ITR_SCHEMA_PACKAGE } from "../src/index.js";

describe("itr-schema package scaffold", () => {
  it("exposes a package identifier", () => {
    expect(ITR_SCHEMA_PACKAGE).toBe("@cleartax/itr-schema");
  });
});
