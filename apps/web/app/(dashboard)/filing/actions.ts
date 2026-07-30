"use server";

import { revalidatePath } from "next/cache";
import { isEligibleForItr1, mapToItr1, mapToItr2, type ItrEligibilityResult } from "@cleartax/itr-schema";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { prisma } from "@/lib/db";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { checkItrProfileCompletenessForTaxpayer, loadItrExportInputForComputation } from "@/lib/loadItrExportInput";
import { requireSession } from "@/lib/session";
import { itrFilingDetailsSchema } from "@/lib/validation/itrFilingDetails";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Saves the small set of taxpayer details `/filing` collects that `/profile` doesn't (see `schema.prisma`'s `TaxpayerProfile.email`/`.mobileNumber`/`.fatherName` doc comment). */
export async function saveItrFilingDetails(values: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = itrFilingDetailsSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const profile = await getOrCreateTaxpayerProfile();
  await prisma.taxpayerProfile.update({
    where: { id: profile.id },
    data: {
      fatherName: parsed.data.fatherName,
      email: parsed.data.email,
      mobileNumber: parsed.data.mobileNumber,
    },
  });

  revalidatePath("/filing");
  return { ok: true };
}

export interface ItrEligibilityCheckResult {
  itr1: ItrEligibilityResult;
  profileComplete: boolean;
  missingProfileFields: string[];
}

/** Checks profile completeness + ITR-1 eligibility for a given saved `TaxComputation`, without generating or persisting anything — used by the `/filing` page to show the taxpayer their options before they click "Generate". */
export async function checkItrEligibility(taxComputationId: string): Promise<ActionResult<ItrEligibilityCheckResult>> {
  await requireSession();
  try {
    const completeness = await checkItrProfileCompletenessForTaxpayer(
      (await prisma.taxComputation.findUniqueOrThrow({ where: { id: taxComputationId } })).taxpayerProfileId,
    );
    if (!completeness.complete) {
      return { ok: true, data: { itr1: { eligible: false, reasons: [] }, profileComplete: false, missingProfileFields: completeness.missingFields } };
    }
    const input = await loadItrExportInputForComputation(taxComputationId);
    return {
      ok: true,
      data: { itr1: isEligibleForItr1(input), profileComplete: true, missingProfileFields: [] },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not check ITR eligibility" };
  }
}

export interface GenerateItrJsonResult {
  artifactId: string;
  itrType: "ITR1" | "ITR2";
}

/**
 * Generates the ITR JSON for a saved `TaxComputation`, validates it against
 * the real government schema (`@cleartax/itr-schema`'s mappers throw on any
 * validation failure — this action never persists an unvalidated payload),
 * and stores it as an `ItrJsonArtifact` row. `itrTypeOverride` lets the
 * taxpayer explicitly choose ITR-2 even when ITR-1-eligible (per the Phase
 * 6 brief: "ITR-1 if eligible, else ITR-2 — or let the user pick if both
 * are viable"); omitted, this defaults to ITR-1 when eligible, else ITR-2.
 * Choosing ITR-1 when ineligible is rejected with a clear error rather than
 * silently falling back to ITR-2.
 */
export async function generateItrJson(taxComputationId: string, itrTypeOverride?: "ITR1" | "ITR2"): Promise<ActionResult<GenerateItrJsonResult>> {
  await requireSession();

  const computationRow = await prisma.taxComputation.findUnique({ where: { id: taxComputationId } });
  if (!computationRow) {
    return { ok: false, error: "Tax computation not found." };
  }

  let input;
  try {
    input = await loadItrExportInputForComputation(taxComputationId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load data for ITR JSON generation." };
  }

  const eligibility = isEligibleForItr1(input);
  const itrType = itrTypeOverride ?? (eligibility.eligible ? "ITR1" : "ITR2");

  if (itrType === "ITR1" && !eligibility.eligible) {
    return { ok: false, error: `Not eligible for ITR-1: ${eligibility.reasons.join(" ")}` };
  }

  let mapped;
  try {
    mapped = itrType === "ITR1" ? mapToItr1(input) : mapToItr2(input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to generate a valid ITR JSON." };
  }

  const artifact = await prisma.itrJsonArtifact.create({
    data: {
      taxpayerProfileId: computationRow.taxpayerProfileId,
      assessmentYear: computationRow.assessmentYear ?? CURRENT_ASSESSMENT_YEAR,
      itrType: mapped.itrType === "ITR1" ? "ITR1" : "ITR2",
      schemaVersion: mapped.schemaVersion,
      jsonPayload: mapped.payload as object,
      taxComputationId: computationRow.id,
    },
  });

  revalidatePath("/filing");
  return { ok: true, data: { artifactId: artifact.id, itrType: mapped.itrType } };
}
