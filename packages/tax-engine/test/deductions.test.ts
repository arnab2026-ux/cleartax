import { describe, expect, it } from "vitest";
import {
  SECTION_80C_CAP,
  SECTION_80CCD_1B_CAP,
  SECTION_80D_PARENTS_CAP_SENIOR,
  SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR,
  SECTION_80D_SELF_FAMILY_CAP_SENIOR,
  SECTION_80TTA_CAP,
  SECTION_80TTB_CAP,
  computeChapterVIA,
  type ChapterVIAInput,
} from "../src/ay2026-27/deductions.js";

const baseOldRegimeInput: ChapterVIAInput = {
  regime: "old",
  age: "below60",
  section80C: 0,
  section80D: {
    selfAndFamilyPremium: 0,
    selfOrFamilyHasSenior: false,
    parentsPremium: 0,
    parentsHaveSenior: false,
    preventiveHealthCheckup: 0,
  },
  section80CCD1B: 0,
  section80CCD2: { employerContribution: 0, salary: 0, employmentType: "other" },
  interestIncomeForTtaOrTtb: 0,
};

describe("Section 80C", () => {
  it("caps at 1,50,000", () => {
    expect(SECTION_80C_CAP).toBe(150_000);
    const result = computeChapterVIA({ ...baseOldRegimeInput, section80C: 200_000 });
    expect(result.section80C).toBe(150_000);
  });

  it("boundary: exactly at the cap is allowed in full", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, section80C: 150_000 });
    expect(result.section80C).toBe(150_000);
  });

  it("below cap: allowed in full", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, section80C: 90_000 });
    expect(result.section80C).toBe(90_000);
  });

  it("new regime: forced to 0 regardless of input", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, regime: "new", section80C: 150_000 });
    expect(result.section80C).toBe(0);
  });
});

describe("Section 80D", () => {
  it("self+family non-senior cap 25,000; parents non-senior cap 25,000", () => {
    expect(SECTION_80D_SELF_FAMILY_CAP_NON_SENIOR).toBe(25_000);
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      section80D: {
        selfAndFamilyPremium: 30_000,
        selfOrFamilyHasSenior: false,
        parentsPremium: 30_000,
        parentsHaveSenior: false,
        preventiveHealthCheckup: 0,
      },
    });
    expect(result.section80D).toBe(25_000 + 25_000);
  });

  it("senior citizen self+family raises cap to 50,000; senior parents raises their cap to 50,000", () => {
    expect(SECTION_80D_SELF_FAMILY_CAP_SENIOR).toBe(50_000);
    expect(SECTION_80D_PARENTS_CAP_SENIOR).toBe(50_000);
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      section80D: {
        selfAndFamilyPremium: 60_000,
        selfOrFamilyHasSenior: true,
        parentsPremium: 60_000,
        parentsHaveSenior: true,
        preventiveHealthCheckup: 0,
      },
    });
    expect(result.section80D).toBe(50_000 + 50_000);
    expect(result.section80D).toBe(100_000); // documented combined max case
  });

  it("preventive health checkup is folded into the self/family bucket, capped at 5,000", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      section80D: {
        selfAndFamilyPremium: 20_000,
        selfOrFamilyHasSenior: false,
        parentsPremium: 0,
        parentsHaveSenior: false,
        preventiveHealthCheckup: 10_000, // should be capped at 5,000 before adding
      },
    });
    // 20,000 + min(10,000, 5,000) = 25,000, exactly at the non-senior cap
    expect(result.section80D).toBe(25_000);
  });

  it("new regime: forced to 0", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      regime: "new",
      section80D: {
        selfAndFamilyPremium: 25_000,
        selfOrFamilyHasSenior: false,
        parentsPremium: 25_000,
        parentsHaveSenior: false,
        preventiveHealthCheckup: 0,
      },
    });
    expect(result.section80D).toBe(0);
  });
});

describe("Section 80CCD(1B) — additional NPS", () => {
  it("caps at 50,000, on top of the 80C cap", () => {
    expect(SECTION_80CCD_1B_CAP).toBe(50_000);
    const result = computeChapterVIA({ ...baseOldRegimeInput, section80C: 150_000, section80CCD1B: 70_000 });
    expect(result.section80CCD1B).toBe(50_000);
    expect(result.totalDeduction).toBe(150_000 + 50_000);
  });

  it("new regime: forced to 0", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, regime: "new", section80CCD1B: 50_000 });
    expect(result.section80CCD1B).toBe(0);
  });
});

describe("Section 80CCD(2) — employer NPS contribution (available in BOTH regimes)", () => {
  it("new regime: 14% of salary cap for all employees", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      regime: "new",
      section80CCD2: { employerContribution: 200_000, salary: 1_000_000, employmentType: "other" },
    });
    expect(result.section80CCD2).toBe(140_000);
  });

  it("old regime, government employee: 14% cap", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      section80CCD2: { employerContribution: 200_000, salary: 1_000_000, employmentType: "government" },
    });
    expect(result.section80CCD2).toBe(140_000);
  });

  it("old regime, private/other employee: only 10% cap (does NOT get the 14% unification)", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      section80CCD2: { employerContribution: 200_000, salary: 1_000_000, employmentType: "other" },
    });
    expect(result.section80CCD2).toBe(100_000);
  });

  it("contribution below the cap is allowed in full", () => {
    const result = computeChapterVIA({
      ...baseOldRegimeInput,
      regime: "new",
      section80CCD2: { employerContribution: 50_000, salary: 1_000_000, employmentType: "other" },
    });
    expect(result.section80CCD2).toBe(50_000);
  });
});

describe("Section 80TTA / 80TTB — interest income", () => {
  it("below 60: 80TTA caps at 10,000, 80TTB is zero", () => {
    expect(SECTION_80TTA_CAP).toBe(10_000);
    const result = computeChapterVIA({ ...baseOldRegimeInput, age: "below60", interestIncomeForTtaOrTtb: 15_000 });
    expect(result.section80TTA).toBe(10_000);
    expect(result.section80TTB).toBe(0);
  });

  it("senior citizen: 80TTB caps at 50,000, 80TTA is zero (mutually exclusive)", () => {
    expect(SECTION_80TTB_CAP).toBe(50_000);
    const result = computeChapterVIA({ ...baseOldRegimeInput, age: "senior", interestIncomeForTtaOrTtb: 60_000 });
    expect(result.section80TTB).toBe(50_000);
    expect(result.section80TTA).toBe(0);
  });

  it("super senior citizen: also uses 80TTB, not 80TTA", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, age: "superSenior", interestIncomeForTtaOrTtb: 60_000 });
    expect(result.section80TTB).toBe(50_000);
    expect(result.section80TTA).toBe(0);
  });

  it("new regime: both forced to 0", () => {
    const result = computeChapterVIA({ ...baseOldRegimeInput, regime: "new", age: "senior", interestIncomeForTtaOrTtb: 60_000 });
    expect(result.section80TTA).toBe(0);
    expect(result.section80TTB).toBe(0);
  });
});

describe("new regime overall: only 80CCD(2) survives", () => {
  it("a taxpayer maxing out every old-regime section still gets only 80CCD(2) under the new regime", () => {
    const richOldInput: ChapterVIAInput = {
      regime: "new",
      age: "senior",
      section80C: 150_000,
      section80D: {
        selfAndFamilyPremium: 50_000,
        selfOrFamilyHasSenior: true,
        parentsPremium: 50_000,
        parentsHaveSenior: true,
        preventiveHealthCheckup: 5_000,
      },
      section80CCD1B: 50_000,
      section80CCD2: { employerContribution: 140_000, salary: 1_000_000, employmentType: "other" },
      interestIncomeForTtaOrTtb: 60_000,
    };
    const result = computeChapterVIA(richOldInput);
    expect(result.section80C).toBe(0);
    expect(result.section80D).toBe(0);
    expect(result.section80CCD1B).toBe(0);
    expect(result.section80TTA).toBe(0);
    expect(result.section80TTB).toBe(0);
    expect(result.section80CCD2).toBe(140_000);
    expect(result.totalDeduction).toBe(140_000);
  });
});
