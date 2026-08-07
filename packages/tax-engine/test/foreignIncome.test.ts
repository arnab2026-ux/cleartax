/**
 * Phase 11 — foreign-source income + Sections 90/90A/91 + Rule 128 foreign
 * tax credit. Table-driven and boundary-heavy, matching the established
 * testing style of `lotteryIncome.test.ts` / `capitalGains.test.ts`.
 *
 * Every end-to-end figure below was hand-derived from the slab tables BEFORE
 * running the code (see the arithmetic spelled out in each test's comments),
 * not read off the implementation's output.
 */
import { describe, expect, it } from "vitest";
import {
  ForeignIncomeInputError,
  assertForeignSourceIncomesAreWellFormed,
  computeForeignTaxCredit,
  sumForeignSlabRateIncome,
  type ForeignSourceIncomeInput,
} from "../src/ay2026-27/foreignIncome";
import { computeFullTaxLiability } from "../src/ay2026-27/computeTaxFull";
import { computeFullTaxableIncome, type FullIncomeInput } from "../src/ay2026-27/fullIncome";
import { compareRegimes } from "../src/ay2026-27/regimeCompare";

/** A US dividend row: gross ₹1,00,000, 25% withheld under Article 10(2)(b) of the India-US DTAA. */
function usDividend(overrides: Partial<ForeignSourceIncomeInput> = {}): ForeignSourceIncomeInput {
  return {
    countryCode: "2",
    countryName: "UNITED STATES OF AMERICA",
    taxIdentificationNumber: "123-45-6789",
    head: "otherSources",
    incomeInr: 100_000,
    foreignTaxPaidInr: 25_000,
    dtaaRateCapPercent: 25,
    reliefSection: "90",
    alreadyIncludedInIndianIncome: false,
    ...overrides,
  };
}

function baseIncome(overrides: Partial<FullIncomeInput> = {}): FullIncomeInput {
  return {
    isSalaried: true,
    grossSalaryIncludingHra: 2_000_000,
    houseProperties: [],
    capitalGainTransactions: [],
    otherSourcesIncome: 0,
    ...overrides,
  };
}

describe("sumForeignSlabRateIncome", () => {
  const cases: Array<{ name: string; sources: ForeignSourceIncomeInput[]; expected: number }> = [
    { name: "no sources", sources: [], expected: 0 },
    { name: "one un-counted dividend", sources: [usDividend()], expected: 100_000 },
    {
      name: "two un-counted dividends are summed",
      sources: [usDividend(), usDividend({ incomeInr: 40_000 })],
      expected: 140_000,
    },
    {
      name: "already-counted rows contribute nothing (the RSU double-count guard)",
      sources: [usDividend({ alreadyIncludedInIndianIncome: true })],
      expected: 0,
    },
    {
      name: "already-counted capital gains contribute nothing",
      sources: [usDividend({ head: "capitalGains", alreadyIncludedInIndianIncome: true, incomeInr: 500_000 })],
      expected: 0,
    },
    {
      name: "already-counted salary perquisite contributes nothing",
      sources: [usDividend({ head: "salary", alreadyIncludedInIndianIncome: true, incomeInr: 1_200_000 })],
      expected: 0,
    },
    {
      name: "negative income is floored at 0",
      sources: [usDividend({ incomeInr: -5_000 })],
      expected: 0,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(sumForeignSlabRateIncome(c.sources)).toBe(c.expected);
    });
  }
});

describe("assertForeignSourceIncomesAreWellFormed", () => {
  it("accepts other-sources income that is not already counted", () => {
    expect(() => assertForeignSourceIncomesAreWellFormed([usDividend()])).not.toThrow();
  });

  it.each(["salary", "houseProperty", "capitalGains"] as const)(
    "rejects %s-head income flagged as NOT already counted (would be mis-taxed at slab rates)",
    (head) => {
      expect(() => assertForeignSourceIncomesAreWellFormed([usDividend({ head, alreadyIncludedInIndianIncome: false })])).toThrow(
        ForeignIncomeInputError,
      );
    },
  );

  it.each(["salary", "houseProperty", "capitalGains"] as const)("accepts %s-head income flagged as already counted", (head) => {
    expect(() => assertForeignSourceIncomesAreWellFormed([usDividend({ head, alreadyIncludedInIndianIncome: true })])).not.toThrow();
  });

  it("names the offending index in the error message", () => {
    expect(() =>
      assertForeignSourceIncomesAreWellFormed([usDividend(), usDividend({ head: "capitalGains", alreadyIncludedInIndianIncome: false })]),
    ).toThrow(/foreignSourceIncomes\[1\]/);
  });
});

describe("computeForeignTaxCredit — Rule 128(5)(i) lower-of cap", () => {
  it("returns an all-zero result for no sources (and never divides by zero)", () => {
    const result = computeForeignTaxCredit({ sources: [], totalIncome: 0, grossTaxLiability: 0 });
    expect(result.totalCredit).toBe(0);
    expect(result.perSource).toEqual([]);
    expect(result.averageRateOfTaxPercent).toBe(0);
  });

  it("caps at the INDIAN tax when the foreign rate is higher (the classic US-dividend case)", () => {
    // Average rate 10%: Indian tax on ₹1,00,000 of foreign income = ₹10,000,
    // well below the ₹25,000 withheld in the US. ₹15,000 of US tax is simply
    // not creditable this year.
    const result = computeForeignTaxCredit({ sources: [usDividend()], totalIncome: 2_000_000, grossTaxLiability: 200_000 });
    expect(result.averageRateOfTaxPercent).toBe(10);
    expect(result.perSource[0]?.indianTaxOnThisIncome).toBe(10_000);
    expect(result.perSource[0]?.eligibleForeignTax).toBe(25_000);
    expect(result.perSource[0]?.creditAllowed).toBe(10_000);
    expect(result.perSource[0]?.limitedBy).toBe("indianTax");
    expect(result.totalCredit).toBe(10_000);
  });

  it("caps at the FOREIGN tax when the Indian rate is higher", () => {
    // Average rate 30%: Indian tax on ₹1,00,000 = ₹30,000 > ₹25,000 withheld.
    const result = computeForeignTaxCredit({ sources: [usDividend()], totalIncome: 2_000_000, grossTaxLiability: 600_000 });
    expect(result.perSource[0]?.indianTaxOnThisIncome).toBe(30_000);
    expect(result.perSource[0]?.creditAllowed).toBe(25_000);
    expect(result.perSource[0]?.limitedBy).toBe("foreignTax");
  });

  it("at the EXACT boundary (Indian tax == eligible foreign tax) credits the full amount", () => {
    // Average rate 25% -> Indian tax on ₹1,00,000 = ₹25,000 = the withheld tax.
    const result = computeForeignTaxCredit({ sources: [usDividend()], totalIncome: 2_000_000, grossTaxLiability: 500_000 });
    expect(result.perSource[0]?.indianTaxOnThisIncome).toBe(25_000);
    expect(result.perSource[0]?.creditAllowed).toBe(25_000);
    expect(result.perSource[0]?.limitedBy).toBe("indianTax");
  });

  it("one rupee either side of the boundary flips which limb binds", () => {
    const justBelow = computeForeignTaxCredit({ sources: [usDividend({ foreignTaxPaidInr: 24_999 })], totalIncome: 2_000_000, grossTaxLiability: 500_000 });
    expect(justBelow.perSource[0]?.limitedBy).toBe("foreignTax");
    expect(justBelow.totalCredit).toBe(24_999);

    // ₹25,001 withheld is above BOTH the Indian cap and the 25% treaty cap —
    // the treaty proviso bites first, then the Indian cap ties with it.
    const justAbove = computeForeignTaxCredit({ sources: [usDividend({ foreignTaxPaidInr: 25_001 })], totalIncome: 2_000_000, grossTaxLiability: 500_000 });
    expect(justAbove.perSource[0]?.eligibleForeignTax).toBe(25_000);
    expect(justAbove.perSource[0]?.limitedBy).toBe("indianTax");
    expect(justAbove.totalCredit).toBe(25_000);
  });

  it("ignores foreign tax above the treaty rate (proviso to Rule 128(5)(i))", () => {
    // 30% withheld because no W-8BEN was filed; the India-US treaty caps the
    // US's taxing right at 25%, so ₹5,000 is permanently lost.
    const result = computeForeignTaxCredit({
      sources: [usDividend({ foreignTaxPaidInr: 30_000 })],
      totalIncome: 2_000_000,
      grossTaxLiability: 600_000,
    });
    expect(result.perSource[0]?.foreignTaxPaid).toBe(30_000);
    expect(result.perSource[0]?.eligibleForeignTax).toBe(25_000);
    expect(result.perSource[0]?.foreignTaxIgnoredAboveTreatyRate).toBe(5_000);
    expect(result.perSource[0]?.creditAllowed).toBe(25_000);
  });

  it("applies no treaty cap when dtaaRateCapPercent is omitted (Section 91 unilateral relief)", () => {
    const result = computeForeignTaxCredit({
      sources: [usDividend({ dtaaRateCapPercent: undefined, foreignTaxPaidInr: 30_000, reliefSection: "91" })],
      totalIncome: 2_000_000,
      grossTaxLiability: 600_000,
    });
    expect(result.perSource[0]?.eligibleForeignTax).toBe(30_000);
    expect(result.perSource[0]?.foreignTaxIgnoredAboveTreatyRate).toBe(0);
    expect(result.creditUnderSection91).toBe(30_000);
    expect(result.creditUnderSection90).toBe(0);
  });

  it("computes each source separately and sums them (Rule 128(5))", () => {
    // Two countries, two very different withholding rates. Average rate 20%.
    const result = computeForeignTaxCredit({
      sources: [
        usDividend({ incomeInr: 100_000, foreignTaxPaidInr: 25_000 }), // Indian tax ₹20,000 < ₹25,000 -> credit ₹20,000
        usDividend({ countryCode: "44", countryName: "UNITED KINGDOM", incomeInr: 50_000, foreignTaxPaidInr: 5_000, dtaaRateCapPercent: 15 }), // Indian tax ₹10,000 > ₹5,000 -> credit ₹5,000
      ],
      totalIncome: 2_000_000,
      grossTaxLiability: 400_000,
    });
    expect(result.perSource.map((s) => s.creditAllowed)).toEqual([20_000, 5_000]);
    expect(result.totalCredit).toBe(25_000);
    // NOT min(total foreign tax ₹30,000, Indian tax on total foreign income
    // ₹30,000) = ₹30,000 — per-source computation genuinely gives a different
    // (lower) answer here, which is the whole point of Rule 128(5).
    expect(result.totalCredit).not.toBe(30_000);
  });

  it("caps total credit at the gross Indian tax liability", () => {
    // Contrived: foreign income far exceeds total income (e.g. large Chapter
    // VI-A deductions), so the per-source caps would exceed the tax owed.
    const result = computeForeignTaxCredit({
      sources: [usDividend({ incomeInr: 1_000_000, foreignTaxPaidInr: 250_000 })],
      totalIncome: 100_000,
      grossTaxLiability: 5_000,
    });
    expect(result.totalCreditBeforeOverallCap).toBe(50_000); // 5% average rate on ₹10L
    expect(result.totalCredit).toBe(5_000);
  });

  it("splits the capped total between Sections 90 and 91 proportionally so the two ITR lines always add up", () => {
    const result = computeForeignTaxCredit({
      sources: [
        usDividend({ incomeInr: 1_000_000, foreignTaxPaidInr: 250_000, reliefSection: "90" }),
        usDividend({ countryCode: "93", countryName: "AFGHANISTAN", incomeInr: 1_000_000, foreignTaxPaidInr: 250_000, dtaaRateCapPercent: undefined, reliefSection: "91" }),
      ],
      totalIncome: 200_000,
      grossTaxLiability: 10_000,
    });
    expect(result.creditUnderSection90 + result.creditUnderSection91).toBe(result.totalCredit);
    expect(result.creditUnderSection90).toBe(5_000);
    expect(result.creditUnderSection91).toBe(5_000);
  });

  it("treats Section 90A relief as part of the Section 90 bucket (the ITR has no separate 90A line)", () => {
    const result = computeForeignTaxCredit({
      sources: [usDividend({ reliefSection: "90A" })],
      totalIncome: 2_000_000,
      grossTaxLiability: 200_000,
    });
    expect(result.creditUnderSection90).toBe(10_000);
    expect(result.creditUnderSection91).toBe(0);
  });

  it("gives zero credit when total income is zero (no divide-by-zero, no phantom credit)", () => {
    const result = computeForeignTaxCredit({ sources: [usDividend()], totalIncome: 0, grossTaxLiability: 0 });
    expect(result.averageRateOfTaxPercent).toBe(0);
    expect(result.perSource[0]?.indianTaxOnThisIncome).toBe(0);
    expect(result.totalCredit).toBe(0);
  });

  it("floors negative income/tax inputs at 0 rather than producing a negative credit", () => {
    const result = computeForeignTaxCredit({
      sources: [usDividend({ incomeInr: -100_000, foreignTaxPaidInr: -5_000 })],
      totalIncome: 2_000_000,
      grossTaxLiability: 400_000,
    });
    expect(result.perSource[0]?.foreignIncome).toBe(0);
    expect(result.perSource[0]?.foreignTaxPaid).toBe(0);
    expect(result.totalCredit).toBe(0);
  });
});

describe("end-to-end: foreign dividend through computeFullTaxLiability", () => {
  it("taxes a foreign dividend at slab rates and reduces tax by the Rule 128 credit", () => {
    // Hand-derived, new regime, age 30:
    //   salary ₹20,00,000 - ₹75,000 standard deduction = ₹19,25,000
    //   + ₹1,00,000 foreign dividend                   = ₹20,25,000 slab income
    //   slab tax: 4L@5%=20,000 + 4L@10%=40,000 + 4L@15%=60,000
    //             + 4L@20%=80,000 + 25,000@25%=6,250  = ₹2,06,250
    //   no rebate (>₹12L), no surcharge (<₹50L), cess 4% = ₹8,250
    //   gross liability                                 = ₹2,14,500
    //   average rate = 2,14,500 / 20,25,000 = 10.592592...%
    //   Indian tax on the foreign ₹1,00,000 = ₹10,592.59 < ₹25,000 withheld
    //   net liability = 2,14,500 - 10,592.59 = ₹2,03,907.41 -> ₹2,03,910 (288B)
    const result = computeFullTaxLiability(baseIncome({ foreignSourceIncomes: [usDividend()] }), "new", 30);

    expect(result.income.foreignSlabRateIncome).toBe(100_000);
    expect(result.income.otherSourcesIncome).toBe(100_000);
    expect(result.income.slabTaxableIncome).toBe(2_025_000);
    expect(result.slabTaxBeforeRebate).toBe(206_250);
    expect(result.cess.cess).toBe(8_250);
    expect(result.totalTaxLiability).toBe(214_500);
    expect(result.totalTaxLiabilityRounded).toBe(214_500);

    expect(result.foreignTaxCredit.averageRateOfTaxPercent).toBeCloseTo(10.59, 2);
    expect(result.foreignTaxCredit.perSource[0]?.indianTaxOnThisIncome).toBeCloseTo(10_592.59, 2);
    expect(result.foreignTaxCredit.totalCredit).toBeCloseTo(10_592.59, 2);
    expect(result.foreignTaxCredit.creditUnderSection90).toBeCloseTo(10_592.59, 2);
    expect(result.netTaxLiabilityAfterRelief).toBeCloseTo(203_907.41, 2);
    expect(result.netTaxLiabilityAfterReliefRounded).toBe(203_910);
  });

  it("leaves every pre-Phase-11 figure untouched when there is no foreign income", () => {
    const without = computeFullTaxLiability(baseIncome(), "new", 30);
    const withEmpty = computeFullTaxLiability(baseIncome({ foreignSourceIncomes: [] }), "new", 30);

    expect(withEmpty.totalTaxLiabilityRounded).toBe(without.totalTaxLiabilityRounded);
    expect(without.foreignTaxCredit.totalCredit).toBe(0);
    // The new net figure is identical to the gross one by construction.
    expect(without.netTaxLiabilityAfterReliefRounded).toBe(without.totalTaxLiabilityRounded);
    expect(without.income.foreignSlabRateIncome).toBe(0);
    expect(without.income.foreignSourceIncomes).toEqual([]);
  });

  it("does NOT double-count an RSU vesting perquisite already inside gross salary", () => {
    // The RSU perquisite (₹5,00,000) is part of the ₹20,00,000 Form 16 gross
    // salary. Recording it as a foreign SALARY source for Schedule FSI/FTC
    // purposes must not change taxable income by a single rupee.
    const withoutForeignRow = computeFullTaxLiability(baseIncome(), "new", 30);
    const withForeignRow = computeFullTaxLiability(
      baseIncome({
        foreignSourceIncomes: [
          usDividend({ head: "salary", incomeInr: 500_000, foreignTaxPaidInr: 0, dtaaRateCapPercent: undefined, alreadyIncludedInIndianIncome: true }),
        ],
      }),
      "new",
      30,
    );

    expect(withForeignRow.income.slabTaxableIncome).toBe(withoutForeignRow.income.slabTaxableIncome);
    expect(withForeignRow.income.totalIncome).toBe(withoutForeignRow.income.totalIncome);
    expect(withForeignRow.totalTaxLiabilityRounded).toBe(withoutForeignRow.totalTaxLiabilityRounded);
    // Zero foreign tax paid -> zero credit, but the row still appears in the
    // per-source breakdown so Schedule FSI can report it.
    expect(withForeignRow.foreignTaxCredit.perSource).toHaveLength(1);
    expect(withForeignRow.netTaxLiabilityAfterReliefRounded).toBe(withoutForeignRow.totalTaxLiabilityRounded);
  });

  it("does NOT double-count an RSU sale already entered as a capital-gain transaction", () => {
    const capitalGainTransactions = [
      // Foreign shares are `unlistedShares` for Indian holding-period
      // purposes: 30 months > 24 -> long term -> Section 112 @ 12.5%.
      { assetType: "unlistedShares" as const, gainAmount: 400_000, holdingPeriodMonths: 30 },
    ];
    const withoutForeignRow = computeFullTaxLiability(baseIncome({ capitalGainTransactions }), "new", 30);
    const withForeignRow = computeFullTaxLiability(
      baseIncome({
        capitalGainTransactions,
        foreignSourceIncomes: [
          usDividend({ head: "capitalGains", incomeInr: 400_000, foreignTaxPaidInr: 0, dtaaRateCapPercent: undefined, alreadyIncludedInIndianIncome: true }),
        ],
      }),
      "new",
      30,
    );

    expect(withoutForeignRow.capitalGainsTaxBeforeSurcharge).toBe(50_000); // 12.5% of ₹4,00,000
    expect(withForeignRow.income.totalIncome).toBe(withoutForeignRow.income.totalIncome);
    expect(withForeignRow.totalTaxLiabilityRounded).toBe(withoutForeignRow.totalTaxLiabilityRounded);
  });

  it("throws rather than silently taxing an un-counted capital gain at slab rates", () => {
    expect(() =>
      computeFullTaxableIncome(
        baseIncome({ foreignSourceIncomes: [usDividend({ head: "capitalGains", alreadyIncludedInIndianIncome: false })] }),
        "new",
        30,
      ),
    ).toThrow(ForeignIncomeInputError);
  });

  it("gives no credit to a taxpayer whose Indian liability is fully rebated under Section 87A", () => {
    // ₹8,00,000 salary, new regime: ₹7,25,000 taxable -> slab tax ₹16,250,
    // fully wiped out by the ₹60,000 87A rebate. Zero Indian tax means the
    // Rule 128 cap binds at zero: the US withholding is unrecoverable.
    const result = computeFullTaxLiability(
      { ...baseIncome({ grossSalaryIncludingHra: 800_000 }), foreignSourceIncomes: [usDividend({ incomeInr: 0, foreignTaxPaidInr: 25_000 })] },
      "new",
      30,
    );
    expect(result.totalTaxLiability).toBe(0);
    expect(result.foreignTaxCredit.totalCredit).toBe(0);
    expect(result.netTaxLiabilityAfterReliefRounded).toBe(0);
  });

  it("never lets the credit push net liability below zero", () => {
    const result = computeFullTaxLiability(
      baseIncome({ grossSalaryIncludingHra: 900_000, foreignSourceIncomes: [usDividend({ incomeInr: 800_000, foreignTaxPaidInr: 200_000 })] }),
      "new",
      30,
    );
    expect(result.netTaxLiabilityAfterRelief).toBeGreaterThanOrEqual(0);
    expect(result.foreignTaxCredit.totalCredit).toBeLessThanOrEqual(result.totalTaxLiability);
  });
});

describe("regimeCompare with foreign income", () => {
  it("compares the POST-credit liability, and is unchanged for a taxpayer with no foreign income", () => {
    const input = baseIncome({ deductions: { section80C: 150_000, section80D: { selfAndFamilyPremium: 25_000, selfOrFamilyHasSenior: false, parentsPremium: 0, parentsHaveSenior: false, preventiveHealthCheckup: 0 }, section80CCD1B: 50_000, section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" }, interestIncomeForTtaOrTtb: 0 } });
    const comparison = compareRegimes(input, 30);
    expect(comparison.savingsFromRecommendedRegime).toBe(
      Math.abs(comparison.old.totalTaxLiabilityRounded - comparison.new.totalTaxLiabilityRounded),
    );
    expect(comparison[comparison.recommendedRegime].netTaxLiabilityAfterReliefRounded).toBe(
      Math.min(comparison.old.netTaxLiabilityAfterReliefRounded, comparison.new.netTaxLiabilityAfterReliefRounded),
    );
  });

  it("recommends the regime with the lower NET liability once a foreign tax credit is in play", () => {
    const comparison = compareRegimes(baseIncome({ foreignSourceIncomes: [usDividend()] }), 30);
    expect(comparison[comparison.recommendedRegime].netTaxLiabilityAfterReliefRounded).toBeLessThanOrEqual(
      comparison[comparison.recommendedRegime === "old" ? "new" : "old"].netTaxLiabilityAfterReliefRounded,
    );
  });
});
