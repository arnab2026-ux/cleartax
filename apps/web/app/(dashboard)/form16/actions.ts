"use server";

import { revalidatePath } from "next/cache";
import type { Form16PartA, Form16PartB } from "@cleartax/pdf-form16";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getCurrentTaxpayerProfile } from "@/lib/getCurrentTaxpayerProfile";
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
 * Digs the parser's "Total amount of exemption claimed under section 10"
 * (Part B item 2) out of a stored `rawExtractedJson`.
 *
 * Narrowed defensively at every level rather than cast: this column is
 * `Json?`, so its contents are whatever was written by a possibly-older
 * version of the parser — a row stored before the field existed simply has
 * no `totalSection10Exemption` key, and must read as null rather than throw.
 */
function readReportedSection10Total(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null || !("partB" in raw)) return null;
  const partB = (raw as { partB: unknown }).partB;
  if (typeof partB !== "object" || partB === null || !("totalSection10Exemption" in partB)) return null;
  const field = (partB as { totalSection10Exemption: unknown }).totalSection10Exemption;
  if (typeof field !== "object" || field === null || !("found" in field) || !("value" in field)) return null;
  const { found, value } = field as { found: unknown; value: unknown };
  return found === true && typeof value === "number" ? value : null;
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
  const profile = await getCurrentTaxpayerProfile();

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
 *
 * Uses `upsert` keyed on `SalaryIncome.form16UploadId` (made `@unique` in
 * schema.prisma specifically for this — see that field's doc comment),
 * rather than a find-then-create-or-update — the previous pattern had a real
 * race: two concurrent confirms of the same upload (a double-click, or a
 * client retry after a slow network response that looked like a failure)
 * could both run their `findFirst` before either committed a row, both see
 * "no existing SalaryIncome", and both INSERT — producing two SalaryIncome
 * rows for one Form16Upload. The mapping layer
 * (`lib/mapping/toTaxEngineInput.ts`) sums every SalaryIncome row for the AY
 * across employers by design (genuine multi-employer job-switch support),
 * with no dedup by form16UploadId, so a duplicate here would have silently
 * double-counted that employer's salary in every subsequent tax computation.
 * `upsert` resolves the conflict atomically at the database level (a single
 * `INSERT ... ON CONFLICT`), unlike wrapping the old find-then-branch in a
 * `$transaction`, which would still race under Postgres's default READ
 * COMMITTED isolation (both transactions could still see "no existing row").
 */
export async function confirmForm16Upload(uploadId: string, values: unknown): Promise<ActionResult<{ salaryIncomeId: string }>> {
  await requireSession();
  const profile = await getCurrentTaxpayerProfile();

  const upload = await prisma.form16Upload.findFirst({ where: { id: uploadId, taxpayerProfileId: profile.id } });
  if (!upload) {
    return { ok: false, error: "Form 16 upload not found" };
  }

  const parsed = salaryIncomeSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid salary data" };
  }
  // The certificate's own item 2 total, carried straight from the parse
  // rather than from the form: it is not user-editable (it records what the
  // document said, not what the user decided) and exists so a later
  // reconciliation can show that the heads applied fall short of what the
  // employer certified. Null when the certificate stated no such total.
  const reportedTotalSection10Exemption = readReportedSection10Total(upload.rawExtractedJson);

  const data = { ...parsed.data, reportedTotalSection10Exemption };

  const salaryIncome = await prisma.salaryIncome.upsert({
    where: { form16UploadId: uploadId },
    create: {
      taxpayerProfileId: profile.id,
      assessmentYear: upload.assessmentYear,
      form16UploadId: uploadId,
      ...data,
    },
    update: data,
  });

  await prisma.form16Upload.update({ where: { id: uploadId }, data: { parseStatus: "CONFIRMED" } });

  revalidatePath("/form16");
  revalidatePath(`/form16/review/${uploadId}`);
  return { ok: true, data: { salaryIncomeId: salaryIncome.id } };
}

/** Records a parse failure the user chose to abandon in favor of manual entry (`no-text-layer`/`failed`), so it still shows up in the upload history rather than silently vanishing. */
export async function recordFailedForm16Upload(fileHash: string, blobUrl: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getCurrentTaxpayerProfile();

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
  const profile = await getCurrentTaxpayerProfile();

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
  const profile = await getCurrentTaxpayerProfile();

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
  const profile = await getCurrentTaxpayerProfile();

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
