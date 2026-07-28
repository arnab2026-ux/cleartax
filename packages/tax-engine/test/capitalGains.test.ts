import { describe, expect, it } from "vitest";
import {
  LTCG_EQUITY_EXEMPTION,
  LTCG_EQUITY_RATE_PERCENT,
  LTCG_OTHER_RATE_PERCENT,
  LTCG_OTHER_WITH_INDEXATION_RATE_PERCENT,
  STCG_EQUITY_RATE_PERCENT,
  classifyHoldingPeriod,
  computeCapitalGains,
} from "../src/ay2026-27/capitalGains.js";

describe("classifyHoldingPeriod", () => {
  it("listed equity/equity MF: 12-month boundary — exactly 12 is short, 13 is long", () => {
    expect(classifyHoldingPeriod("listedEquityOrEquityMF", 12)).toBe("short");
    expect(classifyHoldingPeriod("listedEquityOrEquityMF", 13)).toBe("long");
  });

  it("non-equity assets: 24-month boundary — exactly 24 is short, 25 is long", () => {
    for (const assetType of ["unlistedShares", "immovableProperty", "gold", "otherAsset"] as const) {
      expect(classifyHoldingPeriod(assetType, 24)).toBe("short");
      expect(classifyHoldingPeriod(assetType, 25)).toBe("long");
    }
  });

  it("debt mutual funds (Section 50AA specified mutual fund): always short-term regardless of holding period", () => {
    expect(classifyHoldingPeriod("debtMutualFund", 1)).toBe("short");
    expect(classifyHoldingPeriod("debtMutualFund", 120)).toBe("short");
  });
});

describe("STCG on listed equity/equity MF — Section 111A", () => {
  it("flat 20% rate, no exemption", () => {
    expect(STCG_EQUITY_RATE_PERCENT).toBe(20);
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 100_000, holdingPeriodMonths: 6 },
    ]);
    expect(result.stcgEquityNetGain).toBe(100_000);
    expect(result.stcgEquityTax).toBe(20_000);
  });

  it("nets multiple short-term equity transactions before taxing", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 150_000, holdingPeriodMonths: 3 },
      { assetType: "listedEquityOrEquityMF", gainAmount: -50_000, holdingPeriodMonths: 9 },
    ]);
    expect(result.stcgEquityNetGain).toBe(100_000);
    expect(result.stcgEquityTax).toBe(20_000);
  });

  it("net short-term equity loss floors tax at 0", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: -50_000, holdingPeriodMonths: 3 },
    ]);
    expect(result.stcgEquityNetGain).toBe(0);
    expect(result.stcgEquityTax).toBe(0);
  });
});

describe("LTCG on listed equity/equity MF — Section 112A", () => {
  it("exemption is 1,25,000/year, 12.5% on the excess", () => {
    expect(LTCG_EQUITY_EXEMPTION).toBe(125_000);
    expect(LTCG_EQUITY_RATE_PERCENT).toBe(12.5);
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 500_000, holdingPeriodMonths: 24 },
    ]);
    expect(result.ltcgEquityTaxableGain).toBe(375_000);
    expect(result.ltcgEquityTax).toBeCloseTo(46_875, 2);
  });

  it("boundary: gain exactly at the 1,25,000 exemption owes zero tax", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 125_000, holdingPeriodMonths: 24 },
    ]);
    expect(result.ltcgEquityTaxableGain).toBe(0);
    expect(result.ltcgEquityTax).toBe(0);
  });

  it("boundary: gain at 1,25,001 owes tax on exactly 1 rupee", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 125_001, holdingPeriodMonths: 24 },
    ]);
    expect(result.ltcgEquityTaxableGain).toBe(1);
    // 1 * 12.5% = 0.125, rounded to the nearest paisa (2dp, round-half-up) = 0.13.
    expect(result.ltcgEquityTax).toBeCloseTo(0.13, 2);
  });
});

describe("STCG on other assets (non-equity, or debt MF): taxed at slab rate, not by this module", () => {
  it("debt mutual fund gain flows into stcgOtherSlabRateIncome regardless of holding period", () => {
    const result = computeCapitalGains([
      { assetType: "debtMutualFund", gainAmount: 80_000, holdingPeriodMonths: 40 },
    ]);
    expect(result.stcgOtherSlabRateIncome).toBe(80_000);
    expect(result.totalSpecialRateTax).toBe(0);
  });

  it("short-term gold/unlisted-shares/property gains also flow into stcgOtherSlabRateIncome", () => {
    const result = computeCapitalGains([
      { assetType: "gold", gainAmount: 20_000, holdingPeriodMonths: 10 },
      { assetType: "unlistedShares", gainAmount: 30_000, holdingPeriodMonths: 12 },
      { assetType: "immovableProperty", gainAmount: 40_000, holdingPeriodMonths: 24 },
    ]);
    expect(result.stcgOtherSlabRateIncome).toBe(90_000);
  });
});

describe("LTCG on other assets (Section 112) — 12.5% no indexation, default rule", () => {
  it("flat 12.5%, no indexation, for assets with no grandfathering eligibility", () => {
    expect(LTCG_OTHER_RATE_PERCENT).toBe(12.5);
    const result = computeCapitalGains([
      { assetType: "gold", gainAmount: 200_000, holdingPeriodMonths: 30 },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(25_000, 2);
    expect(result.ltcgOtherTaxableGainEquivalent).toBe(200_000);
  });

  it("unlisted shares held long-term: same 12.5% no-indexation default (no grandfathering — property-only option)", () => {
    const result = computeCapitalGains([
      { assetType: "unlistedShares", gainAmount: 100_000, holdingPeriodMonths: 30 },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(12_500, 2);
  });

  it("net long-term loss in this bucket floors tax at 0", () => {
    const result = computeCapitalGains([
      { assetType: "gold", gainAmount: -50_000, holdingPeriodMonths: 30 },
    ]);
    expect(result.ltcgOtherTax).toBe(0);
  });
});

describe("LTCG on immovable property — transitional grandfathering option (pre-23-Jul-2024 acquisition)", () => {
  it("uses 12.5% no-indexation when it is lower than 20% with indexation", () => {
    expect(LTCG_OTHER_WITH_INDEXATION_RATE_PERCENT).toBe(20);
    // No-indexation gain 1,000,000 -> tax 125,000 @ 12.5%
    // Indexed gain 500,000 -> tax 100,000 @ 20% (lower — should be used)
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: true,
        indexedGainAmount: 500_000,
      },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(100_000, 2);
  });

  it("uses 12.5% no-indexation when indexation would produce MORE tax", () => {
    // No-indexation gain 1,000,000 -> 125,000 @ 12.5%
    // Indexed gain 900,000 -> 180,000 @ 20% (higher — should NOT be used)
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: true,
        indexedGainAmount: 900_000,
      },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(125_000, 2);
  });

  it("property acquired AFTER the regime-change date is not eligible for the indexation option, even if indexedGainAmount is supplied", () => {
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: false,
        indexedGainAmount: 100_000, // would be far lower, but must be ignored
      },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(125_000, 2);
    expect(result.perTransaction[0]?.indexationOptionUsed).toBe("notApplicable");
  });

  it("no indexedGainAmount supplied for an eligible property: falls back to the 12.5% default", () => {
    const result = computeCapitalGains([
      {
        assetType: "immovableProperty",
        gainAmount: 1_000_000,
        holdingPeriodMonths: 60,
        acquiredBeforeRegimeChange: true,
      },
    ]);
    expect(result.ltcgOtherTax).toBeCloseTo(125_000, 2);
  });
});

describe("totalSpecialRateTax / totalSpecialRateTaxableIncome", () => {
  it("sums across all three special-rate buckets and excludes stcgOtherSlabRateIncome", () => {
    const result = computeCapitalGains([
      { assetType: "listedEquityOrEquityMF", gainAmount: 200_000, holdingPeriodMonths: 3 }, // STCG 111A: 40,000 tax
      { assetType: "listedEquityOrEquityMF", gainAmount: 325_000, holdingPeriodMonths: 24 }, // LTCG 112A: (325,000-125,000)*12.5% = 25,000
      { assetType: "gold", gainAmount: 100_000, holdingPeriodMonths: 30 }, // LTCG 112: 12,500
      { assetType: "debtMutualFund", gainAmount: 50_000, holdingPeriodMonths: 6 }, // slab-rate, not special
    ]);
    expect(result.totalSpecialRateTax).toBeCloseTo(40_000 + 25_000 + 12_500, 2);
    expect(result.totalSpecialRateTaxableIncome).toBe(200_000 + 200_000 + 100_000);
    expect(result.stcgOtherSlabRateIncome).toBe(50_000);
  });

  it("empty transaction list produces all-zero result without crashing", () => {
    const result = computeCapitalGains([]);
    expect(result.totalSpecialRateTax).toBe(0);
    expect(result.totalSpecialRateTaxableIncome).toBe(0);
    expect(result.stcgOtherSlabRateIncome).toBe(0);
  });
});
