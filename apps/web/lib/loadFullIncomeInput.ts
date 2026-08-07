/**
 * DB-touching convenience wrapper around the pure mapping layer in
 * `lib/mapping/toTaxEngineInput.ts` — fetches every income/deduction row
 * for a taxpayer + assessment year and assembles the `FullIncomeInput` the
 * tax engine expects. Kept separate from `toTaxEngineInput.ts` itself so
 * that file stays Prisma-free and trivially unit-testable (see
 * `test/mapping/toTaxEngineInput.test.ts`); this file is the one place that
 * actually touches `prisma`, used by both `/regime-comparison` and
 * `/summary`.
 */
import type { FullIncomeInput } from "@cleartax/tax-engine";
import { CURRENT_ASSESSMENT_YEAR } from "./assessmentYear";
import { computeAgeForAssessmentYear } from "./dateMath";
import { prisma } from "./db";
import { buildFullIncomeInput, decimalToNumber } from "./mapping/toTaxEngineInput";

export interface LoadedIncome {
  age: number;
  fullIncomeInput: FullIncomeInput;
}

export async function loadFullIncomeInputForProfile(taxpayerProfileId: string, dateOfBirth: Date): Promise<LoadedIncome> {
  const [salaryIncomes, houseProperties, capitalGainAssets, otherSourceIncomes, deductions, foreignSourceIncomes] = await Promise.all([
    prisma.salaryIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.housePropertyIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.capitalGainAsset.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.deduction.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.foreignSourceIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
  ]);

  const age = computeAgeForAssessmentYear(dateOfBirth, CURRENT_ASSESSMENT_YEAR);

  const fullIncomeInput = buildFullIncomeInput({
    salaryIncomes: salaryIncomes.map((s) => ({
      grossSalary: decimalToNumber(s.grossSalary),
      basicSalary: decimalToNumber(s.basicSalary),
      hraReceived: decimalToNumber(s.hraReceived),
      rentPaid: decimalToNumber(s.rentPaid),
      isMetroCity: s.isMetroCity,
    })),
    houseProperties: houseProperties.map((h) => ({
      propertyType: h.propertyType,
      annualLetableValue: decimalToNumber(h.annualLetableValue),
      municipalTaxesPaid: decimalToNumber(h.municipalTaxesPaid),
      homeLoanInterest: decimalToNumber(h.homeLoanInterest),
    })),
    capitalGainAssets: capitalGainAssets.map((c) => ({
      assetType: c.assetType,
      acquisitionDate: c.acquisitionDate,
      saleDate: c.saleDate,
      acquisitionCost: decimalToNumber(c.acquisitionCost),
      saleValue: decimalToNumber(c.saleValue),
      expenses: decimalToNumber(c.expenses),
      acquiredBeforeRegimeChange: c.acquiredBeforeRegimeChange,
      indexedGainAmount: c.indexedGainAmount === null ? null : decimalToNumber(c.indexedGainAmount),
    })),
    otherSourceIncomes: otherSourceIncomes.map((o) => ({ sourceType: o.sourceType, amount: decimalToNumber(o.amount) })),
    deductions: deductions.map((d) => ({ section: d.section, amount: decimalToNumber(d.amount), metaJson: d.metaJson })),
    foreignSourceIncomes: foreignSourceIncomes.map((f) => ({
      countryCode: f.countryCode,
      countryName: f.countryName,
      taxIdentificationNumber: f.taxIdentificationNumber,
      head: f.head,
      incomeAmount: decimalToNumber(f.incomeAmount),
      foreignTaxPaid: decimalToNumber(f.foreignTaxPaid),
      // `?? null` preserves "no treaty cap" — `decimalToNumber` would turn a
      // null into 0, which the engine reads as "the treaty caps foreign tax
      // at 0%", wiping out the whole credit. See `toForeignSourceIncomeInput`.
      dtaaRateCapPercent: f.dtaaRateCapPercent === null ? null : decimalToNumber(f.dtaaRateCapPercent),
      reliefSection: f.reliefSection,
      alreadyIncludedInIndianIncome: f.alreadyIncludedInIndianIncome,
    })),
    age,
  });

  return { age, fullIncomeInput };
}

/** Sum of TDS already deducted (salary + other-sources) — feeds `TaxComputation.tdsCredit` (mapping-layer arithmetic over stored data, not an engine output — see `schema.prisma`'s `TaxComputation` doc comment). */
export async function loadTdsCredit(taxpayerProfileId: string): Promise<number> {
  const [salaryIncomes, otherSourceIncomes] = await Promise.all([
    prisma.salaryIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR }, select: { tdsDeducted: true } }),
    prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId, assessmentYear: CURRENT_ASSESSMENT_YEAR }, select: { tdsDeducted: true } }),
  ]);
  const salaryTds = salaryIncomes.reduce((sum, s) => sum + decimalToNumber(s.tdsDeducted), 0);
  const otherTds = otherSourceIncomes.reduce((sum, o) => sum + decimalToNumber(o.tdsDeducted), 0);
  return salaryTds + otherTds;
}
