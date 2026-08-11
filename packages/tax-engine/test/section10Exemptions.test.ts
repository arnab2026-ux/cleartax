import { describe, expect, it } from "vitest";
import { computeFullTaxableIncome } from "../src/ay2026-27/fullIncome";
import {
  NEW_REGIME_STANDARD_DEDUCTION,
  OLD_REGIME_STANDARD_DEDUCTION,
} from "../src/ay2026-27/slabs";
import type { FullIncomeInput } from "../src/ay2026-27/fullIncome";

/**
 * Section 10 exemptions other than HRA, and the Section 16(iii) professional
 * tax deduction.
 *
 * These were missing entirely until Phase 12: only HRA was ever subtracted
 * from gross salary, so every other exemption a Form 16 reports under item 2
 * was silently ignored and the taxpayer over-taxed by that amount.
 *
 * Caught by running a GENUINE AY 2026-27 Form 16 through the parser — see the
 * first test below, whose figures are taken verbatim from that certificate.
 */

const BASE: FullIncomeInput = {
  isSalaried: true,
  grossSalaryIncludingHra: 0,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

describe("real AY 2026-27 certificate — leave encashment under section 10(10AA)", () => {
  // Verbatim from a real TRACES Part B (figures only, no identifying data):
  //   1(d) Total gross salary                                 3594489
  //   2(d) Leave encashment u/s 10(10AA)                       351000
  //   2(i) Total exemption claimed under section 10            351000
  //   3.   Total salary from current employer [1(d)-2(i)]     3243489
  //   4(a) Standard deduction u/s 16(ia)                        75000
  //   6.   Income chargeable under the head "Salaries"        3168489
  // The certificate states "Whether opting out of taxation u/s 115BAC(1A)? No"
  // — i.e. the taxpayer is on the NEW regime and STILL received this
  // exemption, which is exactly why leave encashment belongs in the
  // both-regimes bucket rather than the old-regime-only one.
  const input: FullIncomeInput = {
    ...BASE,
    grossSalaryIncludingHra: 3_594_489,
    otherSection10Exemptions: 351_000,
  };

  it("reproduces the certificate's own income-chargeable figure under the new regime", () => {
    const result = computeFullTaxableIncome(input, "new", 38);
    expect(result.totalSection10Exemptions).toBe(351_000);
    expect(result.salaryAfterSection10).toBe(3_243_489); // certificate item 3
    expect(result.standardDeduction).toBe(NEW_REGIME_STANDARD_DEDUCTION);
    expect(result.salaryTaxable).toBe(3_168_489); // certificate item 6
  });

  it("would have over-stated taxable salary by the full exemption before this fix", () => {
    // The pre-fix behaviour is what you get by simply not passing the field.
    const withoutExemption = computeFullTaxableIncome(
      { ...input, otherSection10Exemptions: undefined },
      "new",
      38,
    );
    expect(withoutExemption.salaryTaxable - 3_168_489).toBe(351_000);
  });
});

describe("regime treatment of the two exemption buckets", () => {
  const input: FullIncomeInput = {
    ...BASE,
    grossSalaryIncludingHra: 2_000_000,
    otherSection10Exemptions: 300_000, // retirement heads — both regimes
    oldRegimeOnlySection10Exemptions: 100_000, // LTA etc. — old regime only
  };

  it("allows retirement-head exemptions under BOTH regimes", () => {
    expect(computeFullTaxableIncome(input, "new", 40).totalSection10Exemptions).toBe(300_000);
    expect(computeFullTaxableIncome(input, "old", 40).totalSection10Exemptions).toBe(400_000);
  });

  it("withdraws the old-regime-only bucket under the new regime", () => {
    const newRegime = computeFullTaxableIncome(input, "new", 40);
    const oldRegime = computeFullTaxableIncome(input, "old", 40);
    // Difference is exactly the old-regime-only bucket, plus the standard
    // deduction difference between the two regimes.
    const stdDiff = NEW_REGIME_STANDARD_DEDUCTION - OLD_REGIME_STANDARD_DEDUCTION;
    expect(oldRegime.salaryAfterSection10 - newRegime.salaryAfterSection10).toBe(-100_000);
    expect(newRegime.standardDeduction - oldRegime.standardDeduction).toBe(stdDiff);
  });
});

describe("section 16(iii) professional tax", () => {
  const input: FullIncomeInput = {
    ...BASE,
    grossSalaryIncludingHra: 1_000_000,
    professionalTax: 2_400,
  };

  it("is deducted under the old regime", () => {
    const result = computeFullTaxableIncome(input, "old", 35);
    expect(result.professionalTaxAllowed).toBe(2_400);
    expect(result.salaryTaxable).toBe(1_000_000 - OLD_REGIME_STANDARD_DEDUCTION - 2_400);
  });

  it("is withdrawn under the new regime (only the standard deduction survives section 16)", () => {
    const result = computeFullTaxableIncome(input, "new", 35);
    expect(result.professionalTaxAllowed).toBe(0);
    expect(result.salaryTaxable).toBe(1_000_000 - NEW_REGIME_STANDARD_DEDUCTION);
  });
});

describe("defensive handling", () => {
  it("treats omitted fields as zero, leaving pre-Phase-12 callers unchanged", () => {
    const result = computeFullTaxableIncome(
      { ...BASE, grossSalaryIncludingHra: 1_200_000 },
      "new",
      30,
    );
    expect(result.totalSection10Exemptions).toBe(0);
    expect(result.professionalTaxAllowed).toBe(0);
    expect(result.salaryTaxable).toBe(1_200_000 - NEW_REGIME_STANDARD_DEDUCTION);
  });

  it("floors negative inputs at zero rather than inflating salary", () => {
    const result = computeFullTaxableIncome(
      {
        ...BASE,
        grossSalaryIncludingHra: 1_000_000,
        otherSection10Exemptions: -50_000,
        professionalTax: -2_400,
      },
      "old",
      35,
    );
    expect(result.totalSection10Exemptions).toBe(0);
    expect(result.professionalTaxAllowed).toBe(0);
  });

  it("never drives taxable salary below zero when exemptions exceed gross salary", () => {
    const result = computeFullTaxableIncome(
      { ...BASE, grossSalaryIncludingHra: 200_000, otherSection10Exemptions: 500_000 },
      "new",
      35,
    );
    expect(result.salaryAfterSection10).toBe(0);
    expect(result.salaryTaxable).toBe(0);
  });

  // Adversarial review (2026-08-11). The test above pinned the clamp but only
  // ever asserted salaryAfterSection10/salaryTaxable, so nothing noticed that
  // totalSection10Exemptions kept reporting the full CLAIMED figure — the same
  // shape of gap as the Phase 2 review's indexed-gain bug, where the existing
  // tests checked the tax but never the derived income figure beside it.
  it("reports the exemption ACTUALLY APPLIED, not the amount claimed, when it exceeds gross salary", () => {
    const result = computeFullTaxableIncome(
      { ...BASE, grossSalaryIncludingHra: 600_000, otherSection10Exemptions: 2_000_000 },
      "new",
      35,
    );
    expect(result.totalSection10Exemptions).toBe(600_000);
    expect(result.salaryAfterSection10).toBe(0);
    // The invariant that makes this field reconcilable against a certificate:
    // gross - total exemptions must always equal salary after section 10.
    expect(600_000 - result.totalSection10Exemptions).toBe(result.salaryAfterSection10);
  });

  it("keeps that invariant in the ordinary case too", () => {
    const result = computeFullTaxableIncome(
      { ...BASE, grossSalaryIncludingHra: 3_594_489, otherSection10Exemptions: 351_000 },
      "new",
      35,
    );
    expect(result.totalSection10Exemptions).toBe(351_000);
    expect(3_594_489 - result.totalSection10Exemptions).toBe(result.salaryAfterSection10);
  });

  // Documents a REAL GAP, not correct behaviour: no statutory ceiling is
  // enforced on any retirement head. The real caps are gratuity 10(10)
  // ₹20,00,000, leave encashment 10(10AA) ₹25,00,000 (a LIFETIME aggregate
  // across all employers), VRS 10(10C) ₹5,00,000, and commuted pension
  // 10(10A) one-third/one-half of the commuted value. An employer's Form 16
  // applies them, so a parsed certificate is safe — but manual entry, and
  // summing two employers' certificates after a job change, are not.
  // Direction of error is UNDERSTATED tax, which is the dangerous one.
  it("does NOT enforce any statutory ceiling on the retirement heads (known gap)", () => {
    const result = computeFullTaxableIncome(
      { ...BASE, grossSalaryIncludingHra: 10_000_000, otherSection10Exemptions: 9_000_000 },
      "new",
      35,
    );
    expect(result.totalSection10Exemptions).toBe(9_000_000);
    expect(result.salaryTaxable).toBe(10_000_000 - 9_000_000 - NEW_REGIME_STANDARD_DEDUCTION);
  });
});
