"use server";

import { revalidatePath } from "next/cache";
import { isEligibleForItr1, mapToItr1, mapToItr2, type ItrEligibilityResult } from "@cleartax/itr-schema";
import { mockFilingProvider, type EVerifyMethod, type FilingStatusEvent, type FilingStatusValue } from "@cleartax/filing-provider";
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

// ---------------------------------------------------------------------------
// Phase 7: mock filing submission
//
// Fixed project-wide boundary (see PROGRESS.md's Phase 7 section and
// `packages/filing-provider/src/types.ts`'s file header): this app NEVER
// attempts real ERI/GSP submission. Every function below calls
// `mockFilingProvider` — the only `FilingProvider` implementation this
// codebase contains, which makes zero network calls anywhere — and every
// result it produces is written straight into a `FilingAttempt` row.
// `FilingStatusValue` (from `@cleartax/filing-provider`) is, by design,
// the exact same string union as `schema.prisma`'s `FilingStatus` enum, so
// no enum-translation table is needed here (see that package's `types.ts`
// header for why).
// ---------------------------------------------------------------------------

/** Defensively narrows a `FilingAttempt.statusHistoryJson` value back into `FilingStatusEvent[]`, discarding anything that doesn't match the expected shape rather than blindly casting — same "don't trust JSON at runtime" pattern as `lib/loadItrExportInput.ts`'s `parseInputSnapshot`. */
function parseStatusHistory(value: unknown): FilingStatusEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FilingStatusEvent =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).status === "string" &&
      typeof (item as Record<string, unknown>).at === "string" &&
      typeof (item as Record<string, unknown>).detail === "string",
  );
}

export interface SubmitFilingAttemptResult {
  filingAttemptId: string;
  status: FilingStatusValue;
  acknowledgementNumber: string;
}

/**
 * Simulates submitting a previously-generated `ItrJsonArtifact` via the mock
 * filing provider and persists the result as a new `FilingAttempt` row.
 * Every artifact can be "submitted" more than once (each call creates a new
 * `FilingAttempt` row) — this mirrors `generateItrJson` allowing repeat
 * generation, and keeps this action simple rather than trying to enforce a
 * one-attempt-per-artifact invariant the schema itself doesn't enforce.
 */
export async function submitFilingAttempt(itrJsonArtifactId: string): Promise<ActionResult<SubmitFilingAttemptResult>> {
  await requireSession();

  const artifact = await prisma.itrJsonArtifact.findUnique({ where: { id: itrJsonArtifactId } });
  if (!artifact) {
    return { ok: false, error: "ITR JSON artifact not found." };
  }

  let submission;
  try {
    submission = await mockFilingProvider.submitReturn(artifact.jsonPayload, {
      assessmentYear: artifact.assessmentYear,
      itrType: artifact.itrType === "ITR1" ? "ITR1" : "ITR2",
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Mock submission failed." };
  }

  const attempt = await prisma.filingAttempt.create({
    data: {
      taxpayerProfileId: artifact.taxpayerProfileId,
      assessmentYear: artifact.assessmentYear,
      itrJsonArtifactId: artifact.id,
      provider: "MOCK",
      status: submission.status,
      acknowledgementNumber: submission.acknowledgementNumber,
      statusHistoryJson: submission.statusHistory as unknown as object,
    },
  });

  revalidatePath("/filing");
  return {
    ok: true,
    data: { filingAttemptId: attempt.id, status: submission.status, acknowledgementNumber: submission.acknowledgementNumber },
  };
}

export interface FilingStatusActionResult {
  status: FilingStatusValue;
  event: FilingStatusEvent;
}

/**
 * Polls the mock provider's simulated status for an existing
 * `FilingAttempt` and appends the result to its `statusHistoryJson`.
 * Deliberately never lets a check REGRESS an already-`VERIFIED` attempt —
 * `mockFilingProvider.checkStatus` can only ever return SUBMITTED/
 * ACKNOWLEDGED/FAILED (VERIFIED only ever comes from an explicit
 * `eVerify` call), so without this guard a stale check after verification
 * could otherwise appear to undo it.
 */
export async function checkFilingAttemptStatus(filingAttemptId: string): Promise<ActionResult<FilingStatusActionResult>> {
  await requireSession();

  const attempt = await prisma.filingAttempt.findUnique({ where: { id: filingAttemptId } });
  if (!attempt) {
    return { ok: false, error: "Filing attempt not found." };
  }
  if (!attempt.acknowledgementNumber) {
    return { ok: false, error: "This filing attempt has no acknowledgement number yet." };
  }

  const result = await mockFilingProvider.checkStatus(attempt.acknowledgementNumber);
  const nextStatus: FilingStatusValue = attempt.status === "VERIFIED" ? "VERIFIED" : result.status;

  await prisma.filingAttempt.update({
    where: { id: attempt.id },
    data: {
      status: nextStatus,
      statusHistoryJson: [...parseStatusHistory(attempt.statusHistoryJson), result.event] as unknown as object,
    },
  });

  revalidatePath("/filing");
  return { ok: true, data: { status: nextStatus, event: result.event } };
}

export interface EVerifyActionResult extends FilingStatusActionResult {
  success: boolean;
}

/**
 * Simulates e-verification for an existing `FilingAttempt`. Only ever moves
 * the persisted status to `VERIFIED` when the mock provider reports
 * success (i.e. the simulated return has already reached `ACKNOWLEDGED`) —
 * a failed/too-soon attempt still appends an explanatory event to
 * `statusHistoryJson` (so the taxpayer sees why) but leaves `status`
 * unchanged.
 */
export async function eVerifyFilingAttempt(filingAttemptId: string, method: EVerifyMethod): Promise<ActionResult<EVerifyActionResult>> {
  await requireSession();

  if (method !== "AADHAAR_OTP" && method !== "NET_BANKING") {
    return { ok: false, error: "Invalid e-verification method." };
  }

  const attempt = await prisma.filingAttempt.findUnique({ where: { id: filingAttemptId } });
  if (!attempt) {
    return { ok: false, error: "Filing attempt not found." };
  }
  if (!attempt.acknowledgementNumber) {
    return { ok: false, error: "This filing attempt has no acknowledgement number yet." };
  }

  const result = await mockFilingProvider.eVerify(attempt.acknowledgementNumber, method);
  const nextStatus: FilingStatusValue = result.success ? result.status : attempt.status;

  await prisma.filingAttempt.update({
    where: { id: attempt.id },
    data: {
      status: nextStatus,
      statusHistoryJson: [...parseStatusHistory(attempt.statusHistoryJson), result.event] as unknown as object,
    },
  });

  revalidatePath("/filing");
  return { ok: true, data: { status: nextStatus, event: result.event, success: result.success } };
}
