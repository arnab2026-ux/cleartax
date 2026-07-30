"use server";

import { revalidatePath } from "next/cache";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { section80CCD2Schema, section80DSchema, simpleDeductionSchema } from "@/lib/validation/deduction";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Section 80C or 80CCD(1B): one row per instrument, added to a running list (mirrors `/income`'s add-a-line-item pattern). */
export async function createSimpleDeduction(section: "SECTION_80C" | "SECTION_80CCD_1B", values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = simpleDeductionSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await prisma.deduction.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      section,
      description: parsed.data.description ?? null,
      amount: parsed.data.amount,
    },
  });
  revalidatePath("/deductions");
  return { ok: true };
}

export async function deleteDeduction(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.deduction.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/deductions");
  return { ok: true };
}

/**
 * Section 80D is "one form describing the whole picture" rather than a
 * growing list — re-submitting replaces every existing `SECTION_80D` row
 * for this AY with the (up to three) rows implied by the new form values,
 * rather than accumulating duplicates. See `schema.prisma`'s
 * `Deduction.metaJson` doc comment for why three rows (self+family /
 * parents / preventive checkup), each carrying its own `isSenior` flag
 * where relevant.
 */
export async function saveSection80D(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = section80DSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  await prisma.$transaction([
    prisma.deduction.deleteMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR, section: "SECTION_80D" } }),
    prisma.deduction.create({
      data: {
        taxpayerProfileId: profile.id,
        assessmentYear: CURRENT_ASSESSMENT_YEAR,
        section: "SECTION_80D",
        description: "Self & family premium",
        amount: data.selfAndFamilyPremium,
        metaJson: { bucket: "selfFamily", isSenior: data.selfOrFamilyHasSenior },
      },
    }),
    prisma.deduction.create({
      data: {
        taxpayerProfileId: profile.id,
        assessmentYear: CURRENT_ASSESSMENT_YEAR,
        section: "SECTION_80D",
        description: "Parents' premium",
        amount: data.parentsPremium,
        metaJson: { bucket: "parents", isSenior: data.parentsHaveSenior },
      },
    }),
    prisma.deduction.create({
      data: {
        taxpayerProfileId: profile.id,
        assessmentYear: CURRENT_ASSESSMENT_YEAR,
        section: "SECTION_80D",
        description: "Preventive health check-up",
        amount: data.preventiveHealthCheckup,
        metaJson: { bucket: "preventiveCheckup" },
      },
    }),
  ]);

  revalidatePath("/deductions");
  return { ok: true };
}

/** Section 80CCD(2): replace-all, same rationale as `saveSection80D`. */
export async function saveSection80CCD2(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = section80CCD2Schema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  await prisma.$transaction([
    prisma.deduction.deleteMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR, section: "SECTION_80CCD_2" } }),
    prisma.deduction.create({
      data: {
        taxpayerProfileId: profile.id,
        assessmentYear: CURRENT_ASSESSMENT_YEAR,
        section: "SECTION_80CCD_2",
        description: "Employer NPS contribution",
        amount: data.employerContribution,
        metaJson: { employmentType: data.employmentType },
      },
    }),
  ]);

  revalidatePath("/deductions");
  return { ok: true };
}
