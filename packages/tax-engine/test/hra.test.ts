import { describe, expect, it } from "vitest";
import { computeHraExemption, getHraExemptionForRegime } from "../src/ay2026-27/hra.js";

describe("computeHraExemption — Section 10(13A), old regime formula", () => {
  it("metro city: exemption is the least of the three limbs (rent-driven case)", () => {
    // basic 6,00,000/yr, HRA received 3,00,000, rent paid 3,60,000, metro (50%)
    // limb1 actual HRA = 3,00,000
    // limb2 rent - 10% salary = 3,60,000 - 60,000 = 3,00,000
    // limb3 50% of salary = 3,00,000
    // all three tie at 3,00,000 in this crafted case; use a case where they differ instead.
    const result = computeHraExemption({
      basicSalary: 600_000,
      hraReceived: 300_000,
      rentPaid: 300_000,
      isMetro: true,
    });
    // limb1 = 300,000; limb2 = 300,000 - 60,000 = 240,000; limb3 = 300,000
    expect(result.exemptHra).toBe(240_000);
    expect(result.taxableHra).toBe(60_000);
  });

  it("non-metro city: 40% of salary limb applies instead of 50%", () => {
    const result = computeHraExemption({
      basicSalary: 600_000,
      hraReceived: 300_000,
      rentPaid: 300_000,
      isMetro: false,
    });
    // limb1 = 300,000; limb2 = 240,000; limb3 = 40% * 600,000 = 240,000
    expect(result.salaryPercentLimit).toBe(240_000);
    expect(result.exemptHra).toBe(240_000);
  });

  it("metro-vs-non-metro boundary: same inputs, only isMetro differs, produces different salaryPercentLimit", () => {
    const base = { basicSalary: 1_000_000, hraReceived: 200_000, rentPaid: 400_000 };
    const metro = computeHraExemption({ ...base, isMetro: true });
    const nonMetro = computeHraExemption({ ...base, isMetro: false });
    expect(metro.salaryPercentLimit).toBe(500_000);
    expect(nonMetro.salaryPercentLimit).toBe(400_000);
    // rent-based limb = 400,000 - 100,000 = 300,000 in both cases; actual HRA
    // received (200,000) is the binding (lowest) limb regardless of city.
    expect(metro.exemptHra).toBe(200_000);
    expect(nonMetro.exemptHra).toBe(200_000);
  });

  it("actual HRA received is the binding constraint when rent paid is low", () => {
    const result = computeHraExemption({
      basicSalary: 1_200_000,
      hraReceived: 150_000,
      rentPaid: 200_000,
      isMetro: true,
    });
    // limb1 = 150,000; limb2 = 200,000 - 120,000 = 80,000; limb3 = 600,000
    // actual least value is limb2 = 80,000, not limb1.
    expect(result.exemptHra).toBe(80_000);
  });

  it("rent paid exactly 10% of salary: rent-based limb is zero, so exemption is zero", () => {
    const result = computeHraExemption({
      basicSalary: 600_000,
      hraReceived: 100_000,
      rentPaid: 60_000,
      isMetro: true,
    });
    expect(result.rentPaidLessTenPercentSalary).toBe(0);
    expect(result.exemptHra).toBe(0);
    expect(result.taxableHra).toBe(100_000);
  });

  it("no rent paid: exemption is zero regardless of HRA received", () => {
    const result = computeHraExemption({
      basicSalary: 600_000,
      hraReceived: 100_000,
      rentPaid: 0,
      isMetro: true,
    });
    expect(result.exemptHra).toBe(0);
  });
});

describe("getHraExemptionForRegime — new regime has no HRA exemption at all", () => {
  it("new regime: exemptHra is always 0, full HRA received is taxable", () => {
    const result = getHraExemptionForRegime(
      { basicSalary: 600_000, hraReceived: 300_000, rentPaid: 300_000, isMetro: true },
      "new",
    );
    expect(result.exemptHra).toBe(0);
    expect(result.taxableHra).toBe(300_000);
  });

  it("old regime: delegates to computeHraExemption unchanged", () => {
    const direct = computeHraExemption({ basicSalary: 600_000, hraReceived: 300_000, rentPaid: 300_000, isMetro: true });
    const viaRegime = getHraExemptionForRegime(
      { basicSalary: 600_000, hraReceived: 300_000, rentPaid: 300_000, isMetro: true },
      "old",
    );
    expect(viaRegime).toEqual(direct);
  });
});
