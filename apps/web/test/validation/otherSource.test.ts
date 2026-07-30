import { describe, expect, it } from "vitest";
import { otherSourceIncomeSchema } from "../../lib/validation/otherSource";

describe("otherSourceIncomeSchema", () => {
  it("accepts a valid row", () => {
    const result = otherSourceIncomeSchema.safeParse({
      sourceType: "SAVINGS_INTEREST",
      amount: 8_000,
      tdsDeducted: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid sourceType", () => {
    const result = otherSourceIncomeSchema.safeParse({ sourceType: "CRYPTO_GAINS", amount: 1000, tdsDeducted: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = otherSourceIncomeSchema.safeParse({ sourceType: "DIVIDEND", amount: -1, tdsDeducted: 0 });
    expect(result.success).toBe(false);
  });

  it("treats an empty description as omitted", () => {
    const result = otherSourceIncomeSchema.safeParse({
      sourceType: "GIFT",
      description: "",
      amount: 5000,
      tdsDeducted: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeUndefined();
  });
});
