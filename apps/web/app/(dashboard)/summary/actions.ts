"use server";

import { revalidatePath } from "next/cache";
import { computeFullTaxLiability } from "@cleartax/tax-engine";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { loadFullIncomeInputForProfile, loadTdsCredit } from "@/lib/loadFullIncomeInput";
import { TAX_REGIME_FROM_ENGINE } from "@/lib/mapping/enumMaps";
import { mapFullTaxLiabilityToTaxComputation } from "@/lib/mapping/taxComputationMapping";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * Version of `@cleartax/tax-engine` this computation was run against —
 * `TaxComputation.engineVersion`'s stated purpose (see `schema.prisma`) is
 * so a later session can tell which engine revision produced a stored
 * figure if the engine's numbers ever change. Kept as a plain constant
 * (matching `packages/tax-engine/package.json`'s `"version"` at the time
 * this phase was built) rather than importing the JSON file at runtime —
 * that package is consumed as TypeScript source directly (no build step;
 * see PROGRESS.md's "Turbopack .js extension" note), and importing its
 * `package.json` alongside would be an easy way to reintroduce exactly that
 * class of resolution issue for no real benefit over a constant that's
 * trivial to bump by hand if the engine's version ever changes.
 */
const TAX_ENGINE_VERSION = "0.0.1";

/** Computes the full tax liability for the given regime and persists it as a new `TaxComputation` row (a frozen snapshot — see `schema.prisma`'s doc comment on why history is kept rather than updating in place). */
export async function computeAndSaveTaxComputation(regime: "old" | "new"): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  if (!profile.pan || !profile.fullName) {
    return { ok: false, error: "Complete your profile (PAN, name, date of birth) before computing tax." };
  }

  const { age, fullIncomeInput } = await loadFullIncomeInputForProfile(profile.id, profile.dateOfBirth);
  const result = computeFullTaxLiability(fullIncomeInput, regime, age);
  const tdsCredit = await loadTdsCredit(profile.id);
  const mapped = mapFullTaxLiabilityToTaxComputation(result, tdsCredit);

  const created = await prisma.taxComputation.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      regime: TAX_REGIME_FROM_ENGINE[regime],
      inputSnapshotJson: { fullIncomeInput, regime, age } as object,
      grossTotalIncome: mapped.grossTotalIncome,
      totalDeductions: mapped.totalDeductions,
      taxableIncome: mapped.taxableIncome,
      taxBeforeRebate: mapped.taxBeforeRebate,
      capitalGainsTax: mapped.capitalGainsTax,
      rebate: mapped.rebate,
      taxAfterRebate: mapped.taxAfterRebate,
      surcharge: mapped.surcharge,
      marginalRelief: mapped.marginalRelief,
      cess: mapped.cess,
      totalTaxLiability: mapped.totalTaxLiability,
      tdsCredit: mapped.tdsCredit,
      netPayableOrRefund: mapped.netPayableOrRefund,
      engineVersion: TAX_ENGINE_VERSION,
    },
  });

  revalidatePath("/summary");
  revalidatePath("/filing");
  return { ok: true, data: { id: created.id } };
}
