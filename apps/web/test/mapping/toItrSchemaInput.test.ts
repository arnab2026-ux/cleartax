import { computeFullTaxLiability, type FullIncomeInput } from "@cleartax/tax-engine";
import { describe, expect, it } from "vitest";
import {
  buildItrExportInput,
  checkItrProfileCompleteness,
  type OtherSourceIncomeRowForItr,
  type TaxpayerProfileRowForItr,
} from "../../lib/mapping/toItrSchemaInput";
import type { OtherSourceType as PrismaOtherSourceType } from "../../generated/prisma/enums";

const COMPLETE_PROFILE: TaxpayerProfileRowForItr = {
  fullName: "Arjun Kumar Mehta",
  pan: "ABCPM1234F",
  dateOfBirth: new Date(Date.UTC(1990, 5, 15)),
  fatherName: "Ramesh Mehta",
  email: "arjun.mehta@example.com",
  mobileNumber: "9876543210",
  addressLine1: "Flat 402, Sunrise Apartments",
  addressLine2: "MG Road",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  bankAccountNumber: "1234567890123",
  bankIfsc: "HDFC0001234",
  bankName: "HDFC Bank",
  residentialStatus: "ROR",
};

const EMPTY_FULL_INCOME_INPUT: FullIncomeInput = {
  isSalaried: true,
  grossSalaryIncludingHra: 1_000_000,
  houseProperties: [],
  capitalGainTransactions: [],
  otherSourcesIncome: 0,
};

function buildParams(overrides: Partial<TaxpayerProfileRowForItr> = {}) {
  const profile = { ...COMPLETE_PROFILE, ...overrides };
  const computation = computeFullTaxLiability(EMPTY_FULL_INCOME_INPUT, "new", 30);
  return {
    assessmentYear: "2026-27",
    profile,
    regime: "new" as const,
    age: computation.income.ageCategory,
    fullIncomeInput: EMPTY_FULL_INCOME_INPUT,
    computation,
    tdsCredit: 50_000,
    otherSourceIncomes: [] as OtherSourceIncomeRowForItr[],
  };
}

describe("checkItrProfileCompleteness", () => {
  it("returns complete: true with no missing fields for a fully-populated profile", () => {
    expect(checkItrProfileCompleteness(COMPLETE_PROFILE)).toEqual({ complete: true, missingFields: [] });
  });

  it.each([
    ["fatherName", "Father's name"],
    ["email", "Email address"],
    ["mobileNumber", "Mobile number"],
    ["addressLine1", "Address line 1"],
    ["city", "City"],
    ["state", "State"],
    ["pincode", "Pincode"],
  ] as const)("flags a missing %s as %s", (field, label) => {
    const result = checkItrProfileCompleteness({ ...COMPLETE_PROFILE, [field]: null });
    expect(result.complete).toBe(false);
    expect(result.missingFields).toEqual([label]);
  });

  it("lists every missing field when several are absent at once", () => {
    const result = checkItrProfileCompleteness({ ...COMPLETE_PROFILE, fatherName: null, email: null, mobileNumber: null });
    expect(result.complete).toBe(false);
    expect(result.missingFields).toEqual(["Father's name", "Email address", "Mobile number"]);
  });

  it("does NOT flag bank details as missing (they're optional on the real schema — see BankAccountDtls's own doc comment in the schema)", () => {
    const result = checkItrProfileCompleteness({ ...COMPLETE_PROFILE, bankAccountNumber: null, bankIfsc: null, bankName: null });
    expect(result).toEqual({ complete: true, missingFields: [] });
  });

  it("does NOT flag addressLine2 as missing (optional on ItrAddress)", () => {
    const result = checkItrProfileCompleteness({ ...COMPLETE_PROFILE, addressLine2: null });
    expect(result).toEqual({ complete: true, missingFields: [] });
  });
});

describe("buildItrExportInput", () => {
  it("throws a clear error listing every missing field when the profile is incomplete", () => {
    const params = buildParams({ fatherName: null, email: null });
    expect(() => buildItrExportInput(params)).toThrow(/Father's name/);
    expect(() => buildItrExportInput(params)).toThrow(/Email address/);
  });

  it("maps a complete profile's fields onto ItrTaxpayerProfileInput exactly", () => {
    const result = buildItrExportInput(buildParams());
    expect(result.profile).toEqual({
      fullName: "Arjun Kumar Mehta",
      fatherName: "Ramesh Mehta",
      pan: "ABCPM1234F",
      dateOfBirth: COMPLETE_PROFILE.dateOfBirth,
      email: "arjun.mehta@example.com",
      mobileNumber: "9876543210",
      address: {
        addressLine1: "Flat 402, Sunrise Apartments",
        addressLine2: "MG Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      bankAccountNumber: "1234567890123",
      bankIfsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
  });

  it("maps null addressLine2/bank fields to undefined, not null (ItrTaxpayerProfileInput's optional fields, not nullable ones)", () => {
    const result = buildItrExportInput(buildParams({ addressLine2: null, bankAccountNumber: null, bankIfsc: null, bankName: null }));
    expect(result.profile.address.addressLine2).toBeUndefined();
    expect(result.profile.bankAccountNumber).toBeUndefined();
    expect(result.profile.bankIfsc).toBeUndefined();
    expect(result.profile.bankName).toBeUndefined();
  });

  it("passes assessmentYear, regime, age, fullIncomeInput, computation, and tdsCredit through unchanged", () => {
    const params = buildParams();
    const result = buildItrExportInput(params);
    expect(result.assessmentYear).toBe("2026-27");
    expect(result.regime).toBe("new");
    expect(result.age).toBe(params.age);
    expect(result.fullIncomeInput).toBe(params.fullIncomeInput);
    expect(result.computation).toBe(params.computation);
    expect(result.tdsCredit).toBe(50_000);
  });

  it("maps every OtherSourceType value to the identically-named ItrOtherSourceType (exhaustive check)", () => {
    const allTypes: PrismaOtherSourceType[] = [
      "SAVINGS_INTEREST",
      "FIXED_DEPOSIT_INTEREST",
      "RECURRING_DEPOSIT_INTEREST",
      "DIVIDEND",
      "FAMILY_PENSION",
      "LOTTERY_OR_GAME_WINNINGS",
      "GIFT",
      "OTHER",
    ];
    const params = buildParams();
    const result = buildItrExportInput({
      ...params,
      otherSourceIncomes: allTypes.map((sourceType, i) => ({ sourceType, amount: (i + 1) * 1000 })),
    });
    expect(result.otherSourceIncomes).toEqual(allTypes.map((sourceType, i) => ({ sourceType, amount: (i + 1) * 1000 })));
  });

  it("returns an empty otherSourceIncomes array when none are given", () => {
    const result = buildItrExportInput(buildParams());
    expect(result.otherSourceIncomes).toEqual([]);
  });
});
