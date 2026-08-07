/**
 * Phase 11 — Schedule FA / FSI / TR mapping. The load-bearing tests here are
 * the end-to-end ones that push a real, engine-computed foreign-asset profile
 * all the way through `mapToItr2` and validate the result against the REAL
 * vendored government schema via ajv — the same standard every other mapper
 * in this package is held to.
 */
import { describe, expect, it } from "vitest";
import { mapToItr2 } from "../../src/ay2026-27/itr2Mapper";
import { assertValidItr2 } from "../../src/validate";
import {
  buildScheduleFa,
  buildScheduleFsi,
  buildScheduleTr1,
  mustFileScheduleFa,
  residentialStatusToSchemaCode,
} from "../../src/ay2026-27/scheduleFa";
import { COUNTRY_CODE_UNITED_STATES, FOREIGN_COUNTRY_OPTIONS, foreignCountryName, isValidForeignCountryCode } from "../../src/ay2026-27/countries";
import { ItrMappingError, type ItrForeignAssetInput, type ItrResidentialStatus } from "../../src/types";
import { buildForeignRsuInput, RSU_BROKERAGE_ACCOUNT, RSU_SHARES } from "../fixtures";

const FIXED_GENERATION_DATE = new Date(Date.UTC(2026, 6, 30));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const itr2Of = (payload: unknown) => (payload as any).ITR.ITR2;

describe("country codebook (parsed from the vendored schema, not hand-copied)", () => {
  it("parses a large country list out of the schema's own enum description", () => {
    expect(FOREIGN_COUNTRY_OPTIONS.length).toBeGreaterThan(200);
  });

  it("uses ISD dialling codes, not ISO codes — the US is \"2\"", () => {
    expect(foreignCountryName(COUNTRY_CODE_UNITED_STATES)).toBe("UNITED STATES OF AMERICA");
    expect(foreignCountryName("44")).toBe("UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND");
  });

  it("excludes India (91) — this enum is CountryCodeExcludingIndia", () => {
    expect(isValidForeignCountryCode("91")).toBe(false);
  });

  it("throws on an unrecognised code rather than returning a placeholder", () => {
    expect(() => foreignCountryName("US")).toThrow(/Unrecognised foreign country code/);
  });

  it("every parsed code is accepted by its own validator", () => {
    for (const option of FOREIGN_COUNTRY_OPTIONS) {
      expect(isValidForeignCountryCode(option.code)).toBe(true);
    }
  });
});

describe("residential status", () => {
  const cases: Array<[ItrResidentialStatus, "RES" | "NOR" | "NRI", boolean]> = [
    ["ROR", "RES", true],
    ["RNOR", "NOR", false],
    ["NR", "NRI", false],
  ];

  it.each(cases)("%s maps to schema code %s and mustFileScheduleFa=%s", (status, code, mustFile) => {
    expect(residentialStatusToSchemaCode(status)).toBe(code);
    expect(mustFileScheduleFa(status)).toBe(mustFile);
  });
});

describe("buildScheduleFa", () => {
  it("returns undefined when there are no foreign assets", () => {
    expect(buildScheduleFa([], "ROR")).toBeUndefined();
  });

  it.each(["RNOR", "NR"] as const)("returns undefined for a %s filer even WITH assets (they are exempt from Schedule FA)", (status) => {
    expect(buildScheduleFa([RSU_SHARES], status)).toBeUndefined();
  });

  it("puts the brokerage ACCOUNT in table A2 and the SHARES in table A3 — the RSU split", () => {
    const fa = buildScheduleFa([RSU_BROKERAGE_ACCOUNT, RSU_SHARES], "ROR");
    expect(fa).toBeDefined();
    const custodial = fa?.["DtlsForeignCustodialAcc"] as unknown[];
    const equity = fa?.["DtlsForeignEquityDebtInterest"] as Array<Record<string, unknown>>;
    expect(custodial).toHaveLength(1);
    expect(equity).toHaveLength(1);
    expect(equity[0]?.["NameOfEntity"]).toBe("Acme Global Inc.");
    // The shares are NOT in the depository (bank) table — A1 is for plain
    // foreign bank accounts, which this profile has none of.
    expect(fa?.["DetailsForiegnBank"]).toBeUndefined();
  });

  it("emits only the sub-tables that actually have rows", () => {
    const fa = buildScheduleFa([RSU_SHARES], "ROR");
    expect(Object.keys(fa ?? {})).toEqual(["DtlsForeignEquityDebtInterest"]);
  });

  it("reports the A3 peak and closing values verbatim, including a zero close for a fully-sold position", () => {
    const soldOut: ItrForeignAssetInput = { ...RSU_SHARES, peakValue: 3_300_000, closingValue: 0, grossProceeds: 3_100_000 };
    const fa = buildScheduleFa([soldOut], "ROR");
    const row = (fa?.["DtlsForeignEquityDebtInterest"] as Array<Record<string, unknown>>)[0];
    // Peak is measured across the WHOLE calendar year, not only up to the
    // sale date — a sold-out position still has a real peak and a zero close.
    expect(row?.["PeakBalanceDuringPeriod"]).toBe(3_300_000);
    expect(row?.["ClosingBalance"]).toBe(0);
    expect(row?.["TotGrossProceeds"]).toBe(3_100_000);
  });

  it("maps the A2 nature-of-amount enum to the schema's single-letter codes", () => {
    const natures = [
      ["INTEREST", "I"],
      ["DIVIDEND", "D"],
      ["SALE_PROCEEDS", "S"],
      ["OTHER", "O"],
      ["NONE", "N"],
    ] as const;
    for (const [nature, code] of natures) {
      const fa = buildScheduleFa([{ ...RSU_BROKERAGE_ACCOUNT, incomeNature: nature }], "ROR");
      const row = (fa?.["DtlsForeignCustodialAcc"] as Array<Record<string, unknown>>)[0];
      expect(row?.["NatureOfAmount"]).toBe(code);
    }
  });

  it("throws ItrMappingError — never substitutes a placeholder — when a required disclosure field is missing", () => {
    expect(() => buildScheduleFa([{ ...RSU_SHARES, entityName: undefined }], "ROR")).toThrow(ItrMappingError);
    expect(() => buildScheduleFa([{ ...RSU_SHARES, zipCode: "  " }], "ROR")).toThrow(/ZIP\/postal code/);
    expect(() => buildScheduleFa([{ ...RSU_SHARES, acquisitionDate: undefined }], "ROR")).toThrow(/date the interest was acquired/);
  });

  it("names the offending table and 1-based row in the error", () => {
    expect(() => buildScheduleFa([RSU_SHARES, { ...RSU_SHARES, entityAddress: undefined }], "ROR")).toThrow(/table A3 row 2/);
  });
});

describe("buildScheduleFsi / buildScheduleTr1", () => {
  const emptyFtc = {
    averageRateOfTaxPercent: 0,
    perSource: [],
    totalForeignIncome: 0,
    totalForeignTaxPaid: 0,
    totalCreditBeforeOverallCap: 0,
    totalCredit: 0,
    creditUnderSection90: 0,
    creditUnderSection91: 0,
  };

  it("both return undefined when there is no foreign-source income", () => {
    expect(buildScheduleFsi(emptyFtc)).toBeUndefined();
    expect(buildScheduleTr1(emptyFtc)).toBeUndefined();
  });

  it("groups FSI rows by (country, TIN) and breaks them out by head", () => {
    const input = buildForeignRsuInput();
    const fsi = buildScheduleFsi(input.computation.foreignTaxCredit);
    const rows = fsi?.["ScheduleFSIDtls"] as Array<Record<string, unknown>>;
    // Two sources, one country, one TIN -> ONE country row with two heads populated.
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, Record<string, number>>;
    expect(row["IncOthSrc"]?.["IncFrmOutsideInd"]).toBe(48_000);
    expect(row["IncCapGain"]?.["IncFrmOutsideInd"]).toBe(260_000);
    // Heads with no income are still emitted, all-zero (the real schema
    // requires all four).
    expect(row["IncFromSal"]).toEqual({ IncFrmOutsideInd: 0, TaxPaidOutsideInd: 0, TaxPayableinInd: 0, TaxReliefinInd: 0 });
    expect(row["TotalCountryWise"]?.["IncFrmOutsideInd"]).toBe(308_000);
  });

  it("FSI column (e) equals the engine's Rule 128 credit for each head", () => {
    const input = buildForeignRsuInput();
    const ftc = input.computation.foreignTaxCredit;
    const rows = buildScheduleFsi(ftc)?.["ScheduleFSIDtls"] as Array<Record<string, Record<string, number>>>;
    const othSrc = rows[0]?.["IncOthSrc"] as Record<string, number>;
    const dividendSource = ftc.perSource.find((s) => s.head === "otherSources");
    expect(othSrc["TaxReliefinInd"]).toBe(dividendSource?.creditAllowed);
    expect(othSrc["TaxReliefinInd"]).toBe(Math.min(othSrc["TaxPaidOutsideInd"] as number, othSrc["TaxPayableinInd"] as number));
  });

  it("TR totals reconcile with the engine's own Section 90/91 split", () => {
    const ftc = buildForeignRsuInput().computation.foreignTaxCredit;
    const tr = buildScheduleTr1(ftc) as Record<string, number>;
    expect(tr["TotalTaxReliefOutsideIndia"]).toBe(ftc.totalCredit);
    expect((tr["TaxReliefOutsideIndiaDTAA"] as number) + (tr["TaxReliefOutsideIndiaNotDTAA"] as number)).toBe(ftc.totalCredit);
    expect(tr["TaxReliefOutsideIndiaDTAA"]).toBe(ftc.creditUnderSection90);
  });
});

describe("end-to-end ITR-2 with foreign assets, validated against the REAL vendored government schema", () => {
  it("produces a schema-valid payload for the canonical US-RSU profile", () => {
    const { payload } = mapToItr2(buildForeignRsuInput(), FIXED_GENERATION_DATE);
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("emits ScheduleFA, ScheduleFSI and ScheduleTR1 with the right shape", () => {
    const { payload } = mapToItr2(buildForeignRsuInput(), FIXED_GENERATION_DATE);
    const itr2 = itr2Of(payload);
    expect(itr2.ScheduleFA.DtlsForeignCustodialAcc).toHaveLength(1);
    expect(itr2.ScheduleFA.DtlsForeignEquityDebtInterest).toHaveLength(1);
    expect(itr2.ScheduleFSI.ScheduleFSIDtls).toHaveLength(1);
    expect(itr2.ScheduleTR1.ScheduleTR).toHaveLength(1);
    expect(itr2.ScheduleTR1.ScheduleTR[0].ReliefClaimedUsSection).toBe("90");
  });

  it("sets AssetOutIndiaFlag to YES (it used to be hardcoded NO)", () => {
    const { payload } = mapToItr2(buildForeignRsuInput(), FIXED_GENERATION_DATE);
    expect(itr2Of(payload).PartB_TTI.AssetOutIndiaFlag).toBe("YES");
  });

  it("applies the foreign tax credit as TaxRelief, and NetTaxLiability is gross minus relief", () => {
    const input = buildForeignRsuInput();
    const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
    const cotl = itr2Of(payload).PartB_TTI.ComputationOfTaxLiability;
    const ftc = input.computation.foreignTaxCredit;
    expect(ftc.totalCredit).toBeGreaterThan(0);
    expect(cotl.TaxRelief.Section90).toBe(Math.round(ftc.creditUnderSection90));
    expect(cotl.TaxRelief.Section91).toBe(0);
    expect(cotl.TaxRelief.TotTaxRelief).toBe(Math.round(ftc.totalCredit));
    expect(cotl.NetTaxLiability).toBe(input.computation.netTaxLiabilityAfterReliefRounded);
    expect(cotl.NetTaxLiability).toBeLessThan(cotl.GrossTaxLiability);
  });

  it("includes the foreign dividend in slab-rate other-sources income (it is NOT special-rate)", () => {
    const input = buildForeignRsuInput();
    expect(input.computation.income.foreignSlabRateIncome).toBe(48_000);
    expect(input.computation.income.otherSourcesIncome).toBe(48_000);
    // ...and NOT in the special-rate bucket, which here holds only the
    // Section 112 capital gain.
    expect(input.computation.income.capitalGains.totalSpecialRateTaxableIncome).toBe(260_000);
  });

  it("reports the taxpayer's declared residential status instead of a hardcoded 'RES'", () => {
    const ror = mapToItr2(buildForeignRsuInput(), FIXED_GENERATION_DATE);
    expect(itr2Of(ror.payload).PartA_GEN1.FilingStatus.ResidentialStatus).toBe("RES");

    const rnorInput = { ...buildForeignRsuInput(), residentialStatus: "RNOR" as const };
    const rnor = mapToItr2(rnorInput, FIXED_GENERATION_DATE);
    const rnorItr2 = itr2Of(rnor.payload);
    expect(rnorItr2.PartA_GEN1.FilingStatus.ResidentialStatus).toBe("NOR");
    // An RNOR filer is exempt from Schedule FA...
    expect(rnorItr2.ScheduleFA).toBeUndefined();
    // ...but the "do you hold anything abroad" question is still answered
    // truthfully, and the payload still validates.
    expect(rnorItr2.PartB_TTI.AssetOutIndiaFlag).toBe("YES");
    expect(() => assertValidItr2(rnor.payload)).not.toThrow();
  });

  it("still validates a payload for every single Schedule FA sub-table at once", () => {
    const base = {
      countryCode: "2",
      countryName: "UNITED STATES OF AMERICA",
      entityName: "Test Entity",
      entityAddress: "1 Test Street, Testville",
      zipCode: "94085",
      natureOfEntity: "Company",
      accountNumber: "9876543210",
      ownership: "OWNER" as const,
      acquisitionDate: new Date(Date.UTC(2021, 0, 4)),
      initialValue: 100_000,
      peakValue: 200_000,
      closingValue: 150_000,
      incomeAccrued: 5_000,
      incomeNature: "OTHER" as const,
      grossProceeds: 0,
      incomeTaxableInIndia: 5_000,
    };
    const allTables: ItrForeignAssetInput[] = (["A1", "A2", "A3", "A4", "B", "C", "D", "E", "F", "G"] as const).map((table) => ({
      ...base,
      table,
    }));
    const input = { ...buildForeignRsuInput(), foreignAssets: allTables };
    const { payload } = mapToItr2(input, FIXED_GENERATION_DATE);
    const fa = itr2Of(payload).ScheduleFA;
    expect(Object.keys(fa)).toHaveLength(10);
    expect(() => assertValidItr2(payload)).not.toThrow();
  });

  it("omits ScheduleFA/FSI/TR1 entirely for a taxpayer with nothing foreign (no regression for every prior phase's profile)", () => {
    const input = { ...buildForeignRsuInput(), foreignAssets: [] };
    input.fullIncomeInput = { ...input.fullIncomeInput, foreignSourceIncomes: [] };
    // Recompute so the computation matches the (now foreign-free) input.
    const { payload } = mapToItr2(
      { ...input, computation: { ...input.computation, foreignTaxCredit: { ...input.computation.foreignTaxCredit, perSource: [] } } },
      FIXED_GENERATION_DATE,
    );
    const itr2 = itr2Of(payload);
    expect(itr2.ScheduleFA).toBeUndefined();
    expect(itr2.ScheduleFSI).toBeUndefined();
    expect(itr2.ScheduleTR1).toBeUndefined();
    expect(itr2.PartB_TTI.AssetOutIndiaFlag).toBe("NO");
    expect(() => assertValidItr2(payload)).not.toThrow();
  });
});
