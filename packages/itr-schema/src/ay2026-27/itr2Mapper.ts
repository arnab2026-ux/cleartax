/**
 * Maps `ItrExportInput` to the real ITR-2 JSON structure for AY 2026-27,
 * validated against the vendored government schema (`schema/itr2-
 * schema.json`) before being returned — see `validate.ts`. This is the
 * form most users of this app's income-head coverage will actually need,
 * given `packages/tax-engine` supports capital gains and multiple house
 * properties (ITR-1 cannot, beyond its own narrow AY 2026-27 exceptions —
 * see `eligibility.ts`).
 *
 * SCOPE LIMITATIONS — read before trusting this output (see PROGRESS.md's
 * Phase 6 section for the full confidence assessment):
 *
 *  1. **`ScheduleCYLA`/`ScheduleBFLA` (intra-head/inter-head current-year
 *     and brought-forward loss set-off) are populated with the schema's
 *     minimal-valid SKELETON ONLY — structurally present and schema-valid,
 *     but numerically all zero.** `packages/tax-engine` already nets
 *     house-property losses against other income heads internally (see
 *     `houseProperty.ts`'s `housePropertyContributionToGrossTotalIncome`)
 *     before this package ever sees a `FullTaxLiabilityResult` — but it
 *     does not expose the department's own category-by-category CYLA/BFLA
 *     apportionment breakdown (which head's income absorbed how much of
 *     which other head's loss) needed to populate this schedule
 *     faithfully. This means the headline income/tax figures elsewhere in
 *     the generated JSON (`PartB-TI`, `PartB_TTI`) are correct end-to-end,
 *     but this specific schedule is a structurally-valid placeholder, not
 *     a faithful reproduction of the department's internal computation.
 *     **This is the single largest ITR-2 confidence gap in this package.**
 *  2. **Schedule 112A / scrip-wise capital-gains detail is NOT populated**
 *     — same reason as `itr1Mapper.ts`: this app's data model only ever
 *     carries a pre-derived net gain per transaction, never a per-scrip
 *     sale-consideration/cost-of-acquisition/ISIN breakdown. Capital gains
 *     are reported at the AGGREGATE bucket level (`ScheduleCGFor23`,
 *     `PartB-TI.CapGain`) that `packages/tax-engine`'s `capitalGains.ts`
 *     actually computes, which is what feeds the tax liability — but not
 *     as an itemized per-asset schedule.
 *  3. **FIXED in the Phase 6 adversarial review (2026-07-30)**: this used to
 *     say `packages/tax-engine` had no Section 115BB (lottery/game-show/
 *     race-horse winnings) implementation at all, and that this mapper
 *     reported such income at face value inside ordinary slab-rate
 *     "other sources income" as a result. That engine gap is now fixed
 *     (`computeTaxFull.ts` computes a flat 30% tax on
 *     `FullIncomeInput.lotteryOrGameWinningsIncome`, excluded from slab
 *     income, non-rebatable, surcharge capped at 15% — see that file's
 *     header) and this mapper now reports it correctly: `ScheduleOS.
 *     IncFrmLottery` carries the real amount (in the real schema's
 *     `DateRangeType` quarterly-breakdown shape — see `buildLotteryDateRange`
 *     below for the one remaining judgment call, since this app doesn't
 *     track WHEN in the year such income was received), `PartB-TI.IncFromOS.
 *     IncChargblSplRate` carries it as special-rate income (previously
 *     hardcoded 0 — a second, related bug this same fix corrects), and
 *     `ScheduleSI`/`PartB-TI.IncChargeTaxSplRate111A112`/`PartB_TTI`'s tax,
 *     surcharge, and cess totals all now include the 115BB tax alongside
 *     capital-gains tax. `FromOwnRaceHorse` still reports 0 unconditionally
 *     — this app's `OtherSourceType.LOTTERY_OR_GAME_WINNINGS` enum value
 *     doesn't distinguish race-horse-ownership income (a narrow, separate
 *     115BB sub-category) from ordinary lottery/game winnings, so
 *     everything is attributed to the general 115BB bucket rather than
 *     guessed into the wrong line.
 *  4. Every Chapter VI-A section `packages/tax-engine` doesn't implement,
 *     AMT (Schedule AMT/AMTC), foreign assets/income (ScheduleFA/FSI/TR1),
 *     ESOP deferral, ScheduleSPI (income clubbing) — all report as 0/absent
 *     structurally-valid skeleton, matching the engine's own documented
 *     scope boundary (see PROGRESS.md's Phase 1/2 "Not modeled" sections).
 */
import itr2Schema from "./schema/itr2-schema.json";
import type { JsonSchemaDefinitions } from "../jsonSchemaTypes";
import { buildRequiredSkeleton, compact, deepMergeOverlay, roundNumbersDeep } from "../schemaSkeleton";
import type { CapitalGainsResult } from "@cleartax/tax-engine";
import { assertValidItr2 } from "../validate";
import type { ItrExportInput, MappedItrResult } from "../types";
import {
  COUNTRY_CODE_INDIA,
  ITR_FILING_DUE_DATE,
  RETURN_FILE_SECTION,
  SCHEMA_ASSESSMENT_YEAR,
  SCHEMA_FORM_VERSION,
  SOFTWARE_VENDOR_CODE,
  splitName,
  stateNameToCode,
  toIsoDateString,
} from "./constants";

const ITR2_DEFINITIONS = itr2Schema.definitions as unknown as JsonSchemaDefinitions;

export function mapToItr2(input: ItrExportInput, generatedAt: Date = new Date()): MappedItrResult {
  const { profile, computation, fullIncomeInput } = input;
  const name = splitName(profile.fullName);
  const cg = computation.income.capitalGains;
  const deductions = computation.income.deductions;
  const claimed = fullIncomeInput.deductions;

  const skeleton = buildRequiredSkeleton(ITR2_DEFINITIONS, { $ref: "#/definitions/ITR2" }) as Record<string, unknown>;

  const shortTerm20Per = cg.stcgEquityTax;
  const totalShortTerm = shortTerm20Per;
  const longTerm12_5Per = cg.ltcgEquityTax + cg.ltcgOtherTax;
  const totalLongTerm = longTerm12_5Per;
  const shortTermLongTermTotal = totalShortTerm + totalLongTerm;
  const totalCapGains = shortTermLongTermTotal;

  // `otherSourcesIncome` no longer includes lottery/game-winnings income
  // (see toTaxEngineInput.ts's `sumOtherSourcesIncome` — Phase 6 adversarial
  // review fix), so this is genuinely just the slab-rate portion now, and
  // `IncChargblSplRateOS` below is the Section 115BB special-rate portion —
  // together they reproduce the real schedule's OtherSrcThanOwnRaceHorse /
  // IncChargblSplRate / FromOwnRaceHorse / TotIncFromOS breakdown.
  const otherSrcThanOwnRaceHorse = computation.income.otherSourcesIncome;
  const incChargblSplRateOS = computation.income.lotteryOrGameWinningsIncome;
  const fromOwnRaceHorse = 0; // not distinguished from other 115BB income by this app's data model — see file header
  const totIncFromOS = otherSrcThanOwnRaceHorse + incChargblSplRateOS + fromOwnRaceHorse;

  const salaries = computation.income.salaryTaxable;
  const incomeFromHP = computation.income.housePropertyContribution;
  const totalTI = salaries + incomeFromHP + totalCapGains + totIncFromOS;
  // Combined special-rate taxable income across capital gains (111A/112/112A)
  // AND lottery/game-winnings (115BB) — both are "chargeable to tax at
  // special rates" per Schedule SI's own description, so both belong in this
  // total (see ScheduleSI/PartB-TI.IncChargeTaxSplRate111A112 below).
  const specialRateTaxableIncome = cg.totalSpecialRateTaxableIncome + incChargblSplRateOS;

  const usrDeductions = {
    Section80C: claimed?.section80C ?? 0,
    Section80CCC: 0,
    Section80CCDEmployeeOrSE: 0,
    Section80CCD1B: claimed?.section80CCD1B ?? 0,
    Section80CCDEmployer: claimed?.section80CCD2.employerContribution ?? 0,
    Section80D: (claimed?.section80D.selfAndFamilyPremium ?? 0) + (claimed?.section80D.parentsPremium ?? 0) + (claimed?.section80D.preventiveHealthCheckup ?? 0),
    Section80DD: 0,
    Section80DDBUsrType: undefined,
    NameOfSpecDisease80DDB: undefined,
    Section80DDB: 0,
    Section80E: 0,
    Section80EE: 0,
    Section80EEA: 0,
    Section80EEB: 0,
    Section80G: 0,
    Section80GG: 0,
    Form10BAAckNum: undefined,
    Section80GGA: 0,
    Section80GGC: 0,
    Section80U: 0,
    Section80TTA: 0,
    Section80TTB: 0,
    AnyOthSec80CCH: 0,
    TotalChapVIADeductions:
      (claimed?.section80C ?? 0) +
      (claimed?.section80CCD1B ?? 0) +
      (claimed?.section80CCD2.employerContribution ?? 0) +
      (claimed?.section80D.selfAndFamilyPremium ?? 0) +
      (claimed?.section80D.parentsPremium ?? 0) +
      (claimed?.section80D.preventiveHealthCheckup ?? 0),
  };

  const allowedDeductions = {
    Section80C: deductions.section80C,
    Section80CCC: 0,
    Section80CCDEmployeeOrSE: 0,
    Section80CCD1B: deductions.section80CCD1B,
    Section80CCDEmployer: deductions.section80CCD2,
    Section80D: deductions.section80D,
    Section80DD: 0,
    Section80DDB: 0,
    Section80E: 0,
    Section80EE: 0,
    Section80EEA: 0,
    Section80EEB: 0,
    Section80G: 0,
    Section80GG: 0,
    Section80GGA: 0,
    Section80GGC: 0,
    Section80U: 0,
    Section80TTA: deductions.section80TTA,
    Section80TTB: deductions.section80TTB,
    AnyOthSec80CCH: 0,
    TotalChapVIADeductions: deductions.totalDeduction,
  };

  const taxAtNormalRates = computation.slabTaxBeforeRebate;
  // Special-rate tax now includes Section 115BB (lottery) tax alongside
  // capital-gains tax, matching specialRateTaxableIncome above.
  const taxAtSpecialRates = computation.capitalGainsTaxBeforeSurcharge + computation.lotteryTaxBeforeSurcharge;
  const taxPayableOnTotInc = taxAtNormalRates + taxAtSpecialRates;
  const totalSurcharge = computation.slabSurcharge.surchargeAfterRelief + computation.capitalGainsSurcharge + computation.lotterySurcharge;
  const taxAfterRebate = computation.slabTaxAfterRebate + taxAtSpecialRates;
  const grossTaxLiability = computation.totalTaxLiabilityRounded;

  const totalTaxesPaid = (input.advanceTaxPaid ?? 0) + input.tdsCredit + (input.selfAssessmentTaxPaid ?? 0);
  const totTaxPlusIntrstPay = grossTaxLiability; // interest u/234A-C not modeled — see file header
  const balTaxPayable = Math.max(0, totTaxPlusIntrstPay - totalTaxesPaid);
  const refundDue = Math.max(0, totalTaxesPaid - totTaxPlusIntrstPay);

  // Bug fix (Phase 6 adversarial review, Priority 3 skeleton-fabrication
  // audit): the real schema's `BankAccountDtls.BankDtlsFlag` is REQUIRED
  // and carries the schema's own `"default": "Y"`. This code used to never
  // set it explicitly — when a taxpayer has no bank details on file (the
  // `: {}` branch below), `deepMergeOverlay` left the skeleton's default
  // `BankDtlsFlag: "Y"` completely untouched (merging `{}` into an object
  // changes nothing), so the generated JSON would falsely claim "yes, bank
  // details are provided" for every taxpayer who never entered any — a
  // real, non-obvious, plausible-looking-but-wrong value slipping through
  // the skeleton, exactly the failure mode this review's Priority 3 was
  // checking for. Now set explicitly in both branches so it always
  // reflects the actual data, never the schema's own default.
  const bankAccountDtls =
    profile.bankAccountNumber && profile.bankIfsc && profile.bankName
      ? {
          BankDtlsFlag: "Y",
          AddtnlBankDetails: [
            {
              IFSCCode: profile.bankIfsc,
              BankName: profile.bankName,
              BankAccountNo: profile.bankAccountNumber,
              AccountType: "SB",
              UseForRefund: "true",
            },
          ],
        }
      : { BankDtlsFlag: "N" };

  const overlay = {
    CreationInfo: {
      SWVersionNo: "1.0",
      SWCreatedBy: SOFTWARE_VENDOR_CODE,
      JSONCreatedBy: SOFTWARE_VENDOR_CODE,
      JSONCreationDate: toIsoDateString(generatedAt),
      IntermediaryCity: profile.address.city,
      Digest: "-",
    },
    Form_ITR2: {
      FormName: "ITR-2",
      Description: "Indian Income Tax Return Form-2",
      AssessmentYear: SCHEMA_ASSESSMENT_YEAR,
      SchemaVer: SCHEMA_FORM_VERSION,
      FormVer: SCHEMA_FORM_VERSION,
    },
    PartA_GEN1: {
      PersonalInfo: {
        AssesseeName: {
          FirstName: name.firstName,
          MiddleName: name.middleName,
          SurNameOrOrgName: name.surname,
        },
        PAN: profile.pan,
        Address: {
          ResidenceNo: profile.address.addressLine1,
          ResidenceName: profile.address.addressLine2,
          LocalityOrArea: profile.address.addressLine2 ?? profile.address.city,
          CityOrTownOrDistrict: profile.address.city,
          StateCode: stateNameToCode(profile.address.state),
          CountryCode: COUNTRY_CODE_INDIA,
          PinCode: Number(profile.address.pincode),
          CountryCodeMobile: Number(profile.countryCodeMobile ?? "91"),
          MobileNo: Number(profile.mobileNumber),
          EmailAddress: profile.email,
        },
        SecondaryAdd: "N",
        DOB: toIsoDateString(profile.dateOfBirth),
        Status: "I", // Individual — the only status this app models (see packages/tax-engine's resident-individual scope note)
      },
      FilingStatus: {
        ReturnFileSec: input.filingSection ?? RETURN_FILE_SECTION.ON_OR_BEFORE_DUE_DATE,
        OptOutNewTaxRegime: input.regime === "old" ? "Y" : "N",
        SeventhProvisio139: "N",
        ResidentialStatus: "RES", // resident — this app assumes resident individual throughout (packages/tax-engine Phase 1 scope note); NRI/RNOR taxpayers are out of scope
        FiiFpiFlag: "N",
        HeldUnlistedEqShrPrYrFlg: "N",
        ItrFilingDueDate: ITR_FILING_DUE_DATE,
      },
    },
    ScheduleS:
      fullIncomeInput.isSalaried
        ? {
            TotalGrossSalary: fullIncomeInput.grossSalaryIncludingHra,
            AllwncExtentExemptUs10: computation.income.hra?.exemptHra ?? 0,
            NetSalary: fullIncomeInput.grossSalaryIncludingHra - (computation.income.hra?.exemptHra ?? 0),
            DeductionUS16: computation.income.standardDeduction,
            DeductionUnderSection16ia: computation.income.standardDeduction,
            EntertainmntalwncUs16ii: 0,
            ProfessionalTaxUs16iii: 0,
            TotIncUnderHeadSalaries: computation.income.salaryTaxable,
          }
        : undefined,
    ScheduleHP:
      fullIncomeInput.houseProperties.length > 0
        ? {
            TotalIncomeChargeableUnHP: computation.income.housePropertyContribution,
          }
        : undefined,
    ScheduleCGFor23: fullIncomeInput.capitalGainTransactions.length > 0 ? buildScheduleCGFor23(ITR2_DEFINITIONS, cg) : undefined,
    ScheduleOS:
      input.otherSourceIncomes.length > 0
        ? {
            // Bug fix (Phase 6 adversarial review): EVERY field in this
            // block below except `IncChargeable` is a `DateRangeType`
            // (quarterly-breakdown object, see `buildDateRange` below) in
            // the real schema, NOT a plain number — assigning bare numbers
            // (including literal 0s) here used to be a schema-shape
            // mismatch across all 8 fields that no existing test caught
            // (every prior test fixture had an empty `otherSourceIncomes`
            // list, so this whole branch was never exercised against the
            // real schema until this review added one that does).
            // `DividendIncUs115*`/`DividendDTAA`/`NOT89A` are all non-
            // resident/foreign-asset-specific dividend/DTAA categories this
            // app has no data model for at all (resident-individual-only
            // scope, see Phase 1) — zero is not a placeholder here, it's
            // actually correct: this app never has anything to report in
            // them. Only `IncFrmLottery` carries a real, non-zero figure.
            IncFrmLottery: buildDateRange(incChargblSplRateOS),
            DividendIncUs115BBDA: buildDateRange(0),
            DividendIncUs115BBDAaiii: buildDateRange(0),
            DividendIncUs115A1ai: buildDateRange(0),
            DividendIncUs115AC: buildDateRange(0),
            DividendIncUs115ACA: buildDateRange(0),
            DividendIncUs115AD1i: buildDateRange(0),
            DividendDTAA: buildDateRange(0),
            NOT89A: buildDateRange(0),
            IncChargeable: totIncFromOS,
          }
        : undefined,
    ScheduleVIA: {
      UsrDeductUndChapVIA: usrDeductions,
      DeductUndChapVIA: allowedDeductions,
    },
    ScheduleSI:
      specialRateTaxableIncome > 0
        ? {
            TotSplRateInc: specialRateTaxableIncome,
            TotSplRateIncTax: taxAtSpecialRates,
          }
        : undefined,
    ScheduleCYLA: buildScheduleCyla(ITR2_DEFINITIONS),
    ScheduleBFLA: buildScheduleBfla(ITR2_DEFINITIONS, totalTI),
    "PartB-TI": {
      Salaries: salaries,
      IncomeFromHP: incomeFromHP,
      CapGain: {
        ShortTerm: {
          ShortTerm20Per: shortTerm20Per,
          ShortTerm30Per: 0,
          ShortTermAppRate: cg.stcgOtherSlabRateIncome,
          ShortTermSplRateDTAA: 0,
          TotalShortTerm: totalShortTerm + cg.stcgOtherSlabRateIncome,
        },
        LongTerm: {
          LongTerm12_5Per: longTerm12_5Per,
          LongTermSplRateDTAA: 0,
          TotalLongTerm: totalLongTerm,
        },
        ShortTermLongTermTotal: shortTermLongTermTotal + cg.stcgOtherSlabRateIncome,
        CapGains30Per115BBH: 0,
        TotalCapGains: totalCapGains + cg.stcgOtherSlabRateIncome,
      },
      IncFromOS: {
        OtherSrcThanOwnRaceHorse: otherSrcThanOwnRaceHorse,
        // Bug fix (Phase 6 adversarial review): used to be hardcoded 0
        // regardless of actual lottery income — see file header.
        IncChargblSplRate: incChargblSplRateOS,
        FromOwnRaceHorse: fromOwnRaceHorse,
        TotIncFromOS: totIncFromOS,
      },
      TotalTI: totalTI,
      CurrentYearLoss: 0,
      BalanceAfterSetoffLosses: totalTI,
      BroughtFwdLossesSetoff: 0,
      GrossTotalIncome: totalTI,
      IncChargeTaxSplRate111A112: specialRateTaxableIncome,
      DeductionsUnderScheduleVIA: deductions.totalDeduction,
      TotalIncome: computation.income.totalIncome,
      IncChargeableTaxSplRates: specialRateTaxableIncome,
      NetAgricultureIncomeOrOtherIncomeForRate: 0,
      AggregateIncome: computation.income.totalIncome,
      LossesOfCurrentYearCarriedFwd: 0,
      DeemedIncomeUs115JC: 0,
    },
    PartB_TTI: {
      TaxPayDeemedTotIncUs115JC: 0,
      Surcharge: totalSurcharge,
      HealthEduCess: computation.cess.cess,
      TotalTaxPayablDeemedTotInc: 0,
      ComputationOfTaxLiability: {
        TaxPayableOnTI: {
          TaxAtNormalRatesOnAggrInc: taxAtNormalRates,
          TaxAtSpecialRates: taxAtSpecialRates,
          RebateOnAgriInc: 0,
          TaxPayableOnTotInc: taxPayableOnTotInc,
        },
        Rebate87A: computation.rebate.rebateApplied,
        TaxPayableOnRebate: taxAfterRebate,
        Surcharge25ofSI: 0,
        SurchargeOnAboveCrore: 0,
        Surcharge25ofSIBeforeMarginal: 0,
        SurchargeOnAboveCroreBeforeMarginal: 0,
        TotalSurcharge: totalSurcharge,
        EducationCess: computation.cess.cess,
        GrossTaxLiability: grossTaxLiability,
        GrossTaxPayable: grossTaxLiability,
        GrossTaxPay: { TaxInc17: grossTaxLiability, TaxDeferred17: 0, TaxDeferredPayableCY: 0 },
        CreditUS115JD: 0,
        TaxPayAfterCreditUs115JD: grossTaxLiability,
        TaxRelief: { TotTaxRelief: 0 },
        NetTaxLiability: grossTaxLiability,
        IntrstPay: { IntrstPayUs234A: 0, IntrstPayUs234B: 0, IntrstPayUs234C: 0, LateFilingFee234F: 0, TotalIntrstPay: 0 },
        AggregateTaxInterestLiability: grossTaxLiability,
      },
      TaxPaid: {
        TaxesPaid: {
          AdvanceTax: input.advanceTaxPaid ?? 0,
          TDS: input.tdsCredit,
          TCS: 0,
          SelfAssessmentTax: input.selfAssessmentTaxPaid ?? 0,
          TotalTaxesPaid: totalTaxesPaid,
        },
        BalTaxPayable: balTaxPayable,
      },
      Refund: {
        RefundDue: refundDue,
        BankAccountDtls: bankAccountDtls,
      },
      AssetOutIndiaFlag: "NO",
    },
    Verification: {
      Declaration: {
        AssesseeVerName: profile.fullName,
        FatherName: profile.fatherName,
        AssesseeVerPAN: profile.pan,
      },
      Capacity: "S",
      Place: profile.address.city,
    },
  };

  const itr2 = deepMergeOverlay(skeleton, roundNumbersDeep(compact(overlay)));
  const payload = { ITR: { ITR2: itr2 } };
  assertValidItr2(payload);

  return { itrType: "ITR2", schemaVersion: SCHEMA_FORM_VERSION, payload };
}

/**
 * Several `ScheduleOS` fields (`IncFrmLottery`, every `DividendIncUs115*`/
 * `DividendDTAA`/`NOT89A` field) are `DateRangeType` in the real schema — a
 * quarterly breakdown (`Upto15Of6`/`Upto15Of9`/`Up16Of9To15Of12`/
 * `Up16Of12To15Of3`/`Up16Of3To31Of3`) used for Section 234C
 * advance-tax-shortfall-interest purposes, not a plain number. Bug found in
 * the Phase 6 adversarial review: this mapper used to assign bare numbers
 * (including literal 0s) to these fields, a schema-shape mismatch that no
 * existing test caught (every prior test fixture had an empty
 * `otherSourceIncomes` list, so `ScheduleOS` itself was never exercised
 * against the real schema).
 *
 * For an all-zero field (every Dividend/DTAA/NOT89A field above — this app
 * has no data model for any of them, resident-individual-only scope, see
 * Phase 1), `buildDateRange(0)` is unambiguously correct, not a placeholder.
 *
 * For `IncFrmLottery`, `totalAmount` is real, non-zero income — but this
 * app's `OtherSourceIncome` rows only ever carry a lump annual amount, with
 * no receipt-date tracking, so there's no way to correctly attribute WHICH
 * quarter the winnings actually landed in. Rather than either (a) silently
 * dropping the amount into an all-zero object (which would understate real
 * income data — the same "never fabricate-looking-empty a real figure"
 * concern this review's Priority 3 raised, just in the opposite direction:
 * an unintentional zero can mislead just as much as a fabricated non-zero),
 * or (b) guessing a spread across quarters, the caller puts the FULL amount
 * in the last quarter (`Up16Of3To31Of3`, Jan-Mar) — a documented,
 * conservative judgment call. This app doesn't compute Section 234C
 * interest at all (see `TotIntrstPay: 0` above), so this placement doesn't
 * feed into an actual interest figure either way, only the schedule's own
 * internal consistency. Flagged here and in PROGRESS.md as a real, narrow
 * scope limitation, not a silent guess.
 */
function buildDateRange(totalAmount: number): unknown {
  return {
    DateRange: {
      Upto15Of6: 0,
      Upto15Of9: 0,
      Up16Of9To15Of12: 0,
      Up16Of12To15Of3: 0,
      Up16Of3To31Of3: totalAmount,
    },
  };
}

/** See this file's header, gap #1 — a documented, schema-valid-only placeholder. */
function buildScheduleCyla(defs: JsonSchemaDefinitions): unknown {
  return buildRequiredSkeleton(defs, { $ref: "#/definitions/ScheduleCYLA" });
}

/** Same caveat as `buildScheduleCyla`, except `IncomeOfCurrYrAftCYLABFLA` (required) is overlaid with the real post-set-off total income so at least this one headline figure in the schedule is accurate. */
function buildScheduleBfla(defs: JsonSchemaDefinitions, totalCurrentYearIncome: number): unknown {
  const skeleton = buildRequiredSkeleton(defs, { $ref: "#/definitions/ScheduleBFLA" }) as Record<string, unknown>;
  return { ...skeleton, IncomeOfCurrYrAftCYLABFLA: totalCurrentYearIncome, TotalBFLossSetOff: { TotBFLossSetoff: 0 } };
}

/**
 * `ScheduleCGFor23`'s two main sub-schedules (`ShortTermCapGainFor23`/
 * `LongTermCapGain23`) are among the most complex required structures in
 * either vendored schema — they require several NRI-specific/DTAA-specific
 * sub-objects even for a resident individual filer (confirmed by reading
 * the real schema; not assumed). Rather than hand-author that whole
 * structure (high risk of guessing a field name/shape wrong — exactly what
 * happened on the first attempt at this file, caught by `assertValidItr2`
 * during development, which is the validator doing its job), this builds
 * the full required-field skeleton for both sub-schedules (and their own
 * required `CurrYrLosses`/`AccruOrRecOfCG` siblings) and overlays only the
 * few aggregate totals this app's tax engine actually computes
 * (`TotalSTCG`/`TotalLTCG`) — see this file's header, gap #2, for the
 * itemized-detail limitation this implies.
 */
function buildScheduleCGFor23(defs: JsonSchemaDefinitions, cg: CapitalGainsResult): unknown {
  const shortTermSkeleton = buildRequiredSkeleton(defs, { $ref: "#/definitions/ShortTermCapGainFor23" }) as Record<string, unknown>;
  const longTermSkeleton = buildRequiredSkeleton(defs, { $ref: "#/definitions/LongTermCapGain23" }) as Record<string, unknown>;
  const currYrLosses = buildRequiredSkeleton(defs, { $ref: "#/definitions/CurrYrLosses" });
  const accruOrRecOfCG = buildRequiredSkeleton(defs, { $ref: "#/definitions/AccruOrRecOfCG" });

  const totalStcg = cg.stcgEquityNetGain + cg.stcgOtherSlabRateIncome;
  const totalLtcg = cg.ltcgEquityTaxableGain + cg.ltcgOtherTaxableGainEquivalent;

  return {
    ShortTermCapGainFor23: { ...shortTermSkeleton, TotalSTCG: totalStcg },
    LongTermCapGain23: { ...longTermSkeleton, TotalLTCG: totalLtcg },
    SumOfCGIncm: totalStcg + totalLtcg,
    IncmFromVDATrnsf: 0,
    TotScheduleCGFor23: totalStcg + totalLtcg,
    CurrYrLosses: currYrLosses,
    AccruOrRecOfCG: accruOrRecOfCG,
  };
}
