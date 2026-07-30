"use server";

import { revalidatePath } from "next/cache";
import type { Form16PartA, Form16PartB } from "@cleartax/pdf-form16";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { needsReview } from "@/lib/form16Review";
import { salaryIncomeSchema } from "@/lib/validation/salaryIncome";

export interface CreateForm16UploadInput {
  fileHash: string;
  blobUrl: string;
  partA: Form16PartA;
  partB: Form16PartB;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * Persists a Form16Upload row from a *successful* `parseForm16Pdf()` result.
 * `rawExtractedJson` stores exactly `{ partA, partB }` — the
 * `Form16ParseResult` shape `schema.prisma`'s doc comment documents (NOT the
 * status-wrapper shape the API route returns, which also carries
 * `status`/`passwordUsed`). Idempotent on `[taxpayerProfileId, fileHash]`:
 * re-uploading the identical file (e.g. after a password retry that
 * re-stored a new blob) returns the existing row instead of erroring on the
 * unique constraint.
 */
export async function createForm16Upload(input: CreateForm16UploadInput): Promise<ActionResult<{ uploadId: string }>> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const existing = await prisma.form16Upload.findUnique({
    where: { taxpayerProfileId_fileHash: { taxpayerProfileId: profile.id, fileHash: input.fileHash } },
  });
  if (existing) {
    return { ok: true, data: { uploadId: existing.id } };
  }

  const employerName = input.partA.employerName.found ? input.partA.employerName.value : null;
  const employerTan = input.partA.employerTan.found ? input.partA.employerTan.value : null;

  const created = await prisma.form16Upload.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      employerName,
      employerTan,
      blobUrl: input.blobUrl,
      fileHash: input.fileHash,
      parseStatus: needsReview(input.partB) ? "NEEDS_REVIEW" : "PARSED",
      rawExtractedJson: { partA: input.partA, partB: input.partB } as object,
    },
  });

  revalidatePath("/form16");
  return { ok: true, data: { uploadId: created.id } };
}

/**
 * The mandatory review/edit step's confirm action — this is the ONLY path
 * by which parsed Form 16 data reaches `SalaryIncome` (see PROGRESS.md's
 * Phase 3 notes on why this gate is load-bearing, not optional). Writes
 * whatever the user reviewed/edited on the form, not the parser's raw
 * output directly.
 */
export async function confirmForm16Upload(uploadId: string, values: unknown): Promise<ActionResult<{ salaryIncomeId: string }>> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const upload = await prisma.form16Upload.findFirst({ where: { id: uploadId, taxpayerProfileId: profile.id } });
  if (!upload) {
    return { ok: false, error: "Form 16 upload not found" };
  }

  const parsed = salaryIncomeSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid salary data" };
  }
  const data = parsed.data;

  const existingSalaryIncome = await prisma.salaryIncome.findFirst({ where: { form16UploadId: uploadId } });

  const salaryIncome = existingSalaryIncome
    ? await prisma.salaryIncome.update({ where: { id: existingSalaryIncome.id }, data })
    : await prisma.salaryIncome.create({
        data: {
          taxpayerProfileId: profile.id,
          assessmentYear: upload.assessmentYear,
          form16UploadId: uploadId,
          ...data,
        },
      });

  await prisma.form16Upload.update({ where: { id: uploadId }, data: { parseStatus: "CONFIRMED" } });

  revalidatePath("/form16");
  revalidatePath(`/form16/review/${uploadId}`);
  return { ok: true, data: { salaryIncomeId: salaryIncome.id } };
}

/** Records a parse failure the user chose to abandon in favor of manual entry (`no-text-layer`/`failed`), so it still shows up in the upload history rather than silently vanishing. */
export async function recordFailedForm16Upload(fileHash: string, blobUrl: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const existing = await prisma.form16Upload.findUnique({
    where: { taxpayerProfileId_fileHash: { taxpayerProfileId: profile.id, fileHash } },
  });
  if (existing) return { ok: true };

  await prisma.form16Upload.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      blobUrl,
      fileHash,
      parseStatus: "FAILED",
    },
  });
  revalidatePath("/form16");
  return { ok: true };
}

/** Pure manual entry — no Form 16 at all (`form16UploadId: null`), e.g. for a scanned/no-text-layer PDF or a cash/informal employer. */
export async function createManualSalaryIncome(values: unknown): Promise<ActionResult<{ salaryIncomeId: string }>> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const parsed = salaryIncomeSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid salary data" };
  }

  const salaryIncome = await prisma.salaryIncome.create({
    data: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR, form16UploadId: null, ...parsed.data },
  });

  revalidatePath("/form16");
  return { ok: true, data: { salaryIncomeId: salaryIncome.id } };
}

export async function updateSalaryIncome(id: string, values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const row = await prisma.salaryIncome.findFirst({ where: { id, taxpayerProfileId: profile.id } });
  if (!row) return { ok: false, error: "Salary income row not found" };

  const parsed = salaryIncomeSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid salary data" };
  }

  await prisma.salaryIncome.update({ where: { id }, data: parsed.data });
  revalidatePath("/form16");
  return { ok: true };
}

/** Deletes a SalaryIncome row. If it came from a confirmed Form 16, resets that upload back to PARSED so it can be reviewed and confirmed again. */
export async function deleteSalaryIncome(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();

  const row = await prisma.salaryIncome.findFirst({ where: { id, taxpayerProfileId: profile.id } });
  if (!row) return { ok: false, error: "Salary income row not found" };

  await prisma.salaryIncome.delete({ where: { id } });
  if (row.form16UploadId) {
    await prisma.form16Upload.update({ where: { id: row.form16UploadId }, data: { parseStatus: "PARSED" } }).catch(() => {
      // Upload row may itself have been removed independently — non-fatal.
    });
  }
  revalidatePath("/form16");
  return { ok: true };
}
