"use server";

import { revalidatePath } from "next/cache";
import { foreignCountryName } from "@cleartax/itr-schema";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { foreignAssetSchema, foreignSourceIncomeSchema } from "@/lib/validation/foreignAsset";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ---------------------------------------------------------------------------
// Foreign assets (Schedule FA)
// ---------------------------------------------------------------------------

export async function createForeignAsset(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = foreignAssetSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  await prisma.foreignAsset.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      assetType: data.assetType,
      countryCode: data.countryCode,
      // Derived from the government schema's own codebook rather than taken
      // from the client, so the name can never disagree with the code (the
      // ITR JSON carries both, and a mismatch is a rejection risk).
      countryName: foreignCountryName(data.countryCode),
      description: data.description ?? null,
      entityName: data.entityName ?? null,
      entityAddress: data.entityAddress ?? null,
      zipCode: data.zipCode ?? null,
      natureOfEntity: data.natureOfEntity ?? null,
      accountNumber: data.accountNumber ?? null,
      ownership: data.ownership,
      acquisitionDate: new Date(data.acquisitionDate),
      initialValue: data.initialValue,
      peakValue: data.peakValue,
      closingValue: data.closingValue,
      incomeAccrued: data.incomeAccrued,
      incomeNature: data.incomeNature,
      grossProceeds: data.grossProceeds,
      incomeTaxableInIndia: data.incomeTaxableInIndia,
    },
  });
  revalidatePath("/foreign-assets");
  return { ok: true };
}

export async function deleteForeignAsset(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.foreignAsset.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/foreign-assets");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Foreign-source income (Schedules FSI / TR + the Rule 128 foreign tax credit)
// ---------------------------------------------------------------------------

export async function createForeignSourceIncome(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = foreignSourceIncomeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  await prisma.foreignSourceIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      countryCode: data.countryCode,
      countryName: foreignCountryName(data.countryCode),
      taxIdentificationNumber: data.taxIdentificationNumber,
      head: data.head,
      description: data.description ?? null,
      incomeAmount: data.incomeAmount,
      foreignTaxPaid: data.foreignTaxPaid,
      // Null, not 0, when the user left it blank: 0 would mean "the treaty
      // caps the foreign country's tax at 0%", which silently destroys the
      // entire credit. See schema.prisma's `dtaaRateCapPercent`.
      dtaaRateCapPercent: data.dtaaRateCapPercent ?? null,
      dtaaArticle: data.dtaaArticle ?? null,
      reliefSection: data.reliefSection,
      alreadyIncludedInIndianIncome: data.alreadyIncludedInIndianIncome,
      form67Filed: data.form67Filed,
    },
  });
  revalidatePath("/foreign-assets");
  return { ok: true };
}

export async function deleteForeignSourceIncome(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.foreignSourceIncome.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/foreign-assets");
  return { ok: true };
}

/** Flips the "I have filed Form 67 on the e-filing portal" acknowledgement. Purely informational — nothing is gated on it (this app cannot file Form 67). */
export async function setForm67Filed(id: string, filed: boolean): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.foreignSourceIncome.updateMany({ where: { id, taxpayerProfileId: profile.id }, data: { form67Filed: filed } });
  revalidatePath("/foreign-assets");
  return { ok: true };
}
