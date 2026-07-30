import { describe, expect, it } from "vitest";
import {
  checkSection80CCap,
  checkSection80CCD1BCap,
  checkSection80DParentsCap,
  checkSection80DPreventiveCheckupCap,
  checkSection80DSelfFamilyCap,
  checkSection80TtaCap,
  checkSection80TtbCap,
} from "../lib/deductionCaps";

describe("checkSection80CCap", () => {
  it("flags no excess at exactly the cap", () => {
    const result = checkSection80CCap(150_000);
    expect(result.overCap).toBe(false);
    expect(result.excess).toBe(0);
  });

  it("flags the exact excess just over the cap", () => {
    const result = checkSection80CCap(150_001);
    expect(result.overCap).toBe(true);
    expect(result.excess).toBe(1);
  });

  it("reports no excess well under the cap", () => {
    const result = checkSection80CCap(50_000);
    expect(result.overCap).toBe(false);
    expect(result.excess).toBe(0);
  });
});

describe("checkSection80CCD1BCap", () => {
  it("uses the real ₹50,000 cap", () => {
    expect(checkSection80CCD1BCap(50_000).overCap).toBe(false);
    expect(checkSection80CCD1BCap(50_001).overCap).toBe(true);
  });
});

describe("checkSection80DSelfFamilyCap", () => {
  it("uses the non-senior ₹25,000 cap", () => {
    expect(checkSection80DSelfFamilyCap(25_000, false).overCap).toBe(false);
    expect(checkSection80DSelfFamilyCap(25_001, false).overCap).toBe(true);
  });

  it("uses the senior ₹50,000 cap", () => {
    expect(checkSection80DSelfFamilyCap(50_000, true).overCap).toBe(false);
    expect(checkSection80DSelfFamilyCap(50_001, true).overCap).toBe(true);
  });
});

describe("checkSection80DParentsCap", () => {
  it("uses the non-senior ₹25,000 cap", () => {
    expect(checkSection80DParentsCap(25_000, false).overCap).toBe(false);
  });

  it("uses the senior ₹50,000 cap", () => {
    expect(checkSection80DParentsCap(50_000, true).overCap).toBe(false);
    expect(checkSection80DParentsCap(50_001, true).overCap).toBe(true);
  });
});

describe("checkSection80DPreventiveCheckupCap", () => {
  it("uses the ₹5,000 sub-limit", () => {
    expect(checkSection80DPreventiveCheckupCap(5_000).overCap).toBe(false);
    expect(checkSection80DPreventiveCheckupCap(5_001).overCap).toBe(true);
    expect(checkSection80DPreventiveCheckupCap(5_001).excess).toBe(1);
  });
});

describe("checkSection80TtaCap / checkSection80TtbCap", () => {
  it("80TTA caps at ₹10,000", () => {
    expect(checkSection80TtaCap(10_000).overCap).toBe(false);
    expect(checkSection80TtaCap(10_001).overCap).toBe(true);
  });

  it("80TTB caps at ₹50,000", () => {
    expect(checkSection80TtbCap(50_000).overCap).toBe(false);
    expect(checkSection80TtbCap(50_001).overCap).toBe(true);
  });
});
