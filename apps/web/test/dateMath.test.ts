import { describe, expect, it } from "vitest";
import { computeAgeAsOf, computeAgeForAssessmentYear, financialYearEndDate, monthsBetween } from "../lib/dateMath";

describe("monthsBetween", () => {
  it("returns 0 for the same date", () => {
    expect(monthsBetween(new Date("2024-01-15T00:00:00Z"), new Date("2024-01-15T00:00:00Z"))).toBe(0);
  });

  it("counts exactly 12 completed months", () => {
    expect(monthsBetween(new Date("2023-01-15T00:00:00Z"), new Date("2024-01-15T00:00:00Z"))).toBe(12);
  });

  it("counts 11 completed months when one day short of 12", () => {
    expect(monthsBetween(new Date("2023-01-15T00:00:00Z"), new Date("2024-01-14T00:00:00Z"))).toBe(11);
  });

  it("counts exactly 24 completed months", () => {
    expect(monthsBetween(new Date("2022-07-23T00:00:00Z"), new Date("2024-07-23T00:00:00Z"))).toBe(24);
  });

  it("counts 23 completed months when one day short of 24", () => {
    expect(monthsBetween(new Date("2022-07-23T00:00:00Z"), new Date("2024-07-22T00:00:00Z"))).toBe(23);
  });

  it("handles a leap-year February correctly (29 Feb -> 28 Feb next year is 11 months, not 12)", () => {
    expect(monthsBetween(new Date("2024-02-29T00:00:00Z"), new Date("2025-02-28T00:00:00Z"))).toBe(11);
  });

  it("handles a leap-year February correctly (29 Feb -> 1 Mar next year is 12 months)", () => {
    expect(monthsBetween(new Date("2024-02-29T00:00:00Z"), new Date("2025-03-01T00:00:00Z"))).toBe(12);
  });

  it("returns 0 (not negative) when `to` is before `from`", () => {
    expect(monthsBetween(new Date("2024-01-15T00:00:00Z"), new Date("2023-01-15T00:00:00Z"))).toBe(0);
  });

  it("counts across a multi-year gap", () => {
    expect(monthsBetween(new Date("2015-06-01T00:00:00Z"), new Date("2024-07-23T00:00:00Z"))).toBe(109);
  });
});

describe("financialYearEndDate", () => {
  it("maps AY 2026-27 to 31 March 2026", () => {
    const d = financialYearEndDate("2026-27");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // March
    expect(d.getUTCDate()).toBe(31);
  });

  it("throws on a malformed assessment year", () => {
    expect(() => financialYearEndDate("2026")).toThrow();
    expect(() => financialYearEndDate("not-a-year")).toThrow();
    expect(() => financialYearEndDate("")).toThrow();
  });
});

describe("computeAgeAsOf", () => {
  it("computes a straightforward age", () => {
    expect(computeAgeAsOf(new Date("1990-06-15T00:00:00Z"), new Date("2026-03-31T00:00:00Z"))).toBe(35);
  });

  it("does not count the birthday if it hasn't occurred yet this year", () => {
    expect(computeAgeAsOf(new Date("1990-06-15T00:00:00Z"), new Date("2026-06-14T00:00:00Z"))).toBe(35);
  });

  it("counts the birthday on the exact day", () => {
    expect(computeAgeAsOf(new Date("1990-06-15T00:00:00Z"), new Date("2026-06-15T00:00:00Z"))).toBe(36);
  });

  it("crosses the senior-citizen boundary (60) correctly", () => {
    expect(computeAgeAsOf(new Date("1966-03-31T00:00:00Z"), new Date("2026-03-31T00:00:00Z"))).toBe(60);
    expect(computeAgeAsOf(new Date("1966-04-01T00:00:00Z"), new Date("2026-03-31T00:00:00Z"))).toBe(59);
  });

  it("never returns a negative age", () => {
    expect(computeAgeAsOf(new Date("2030-01-01T00:00:00Z"), new Date("2026-03-31T00:00:00Z"))).toBe(0);
  });
});

describe("computeAgeForAssessmentYear", () => {
  it("computes age as of the FY-end for AY 2026-27", () => {
    expect(computeAgeForAssessmentYear(new Date("1965-01-01T00:00:00Z"), "2026-27")).toBe(61);
  });
});
