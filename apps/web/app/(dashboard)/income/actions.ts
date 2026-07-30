"use server";

import { revalidatePath } from "next/cache";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { capitalGainAssetSchema } from "@/lib/validation/capitalGain";
import { housePropertySchema } from "@/lib/validation/houseProperty";
import { otherSourceIncomeSchema } from "@/lib/validation/otherSource";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ---------------------------------------------------------------------------
// House property
// ---------------------------------------------------------------------------

export async function createHouseProperty(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = housePropertySchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await prisma.housePropertyIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      propertyType: parsed.data.propertyType,
      address: parsed.data.address ?? null,
      annualLetableValue: parsed.data.annualLetableValue,
      municipalTaxesPaid: parsed.data.municipalTaxesPaid,
      homeLoanInterest: parsed.data.homeLoanInterest,
    },
  });
  revalidatePath("/income");
  return { ok: true };
}

export async function deleteHouseProperty(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.housePropertyIncome.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/income");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Capital gains
// ---------------------------------------------------------------------------

export async function createCapitalGainAsset(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = capitalGainAssetSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  const computedGainAmount = data.saleValue - data.acquisitionCost - data.expenses;

  await prisma.capitalGainAsset.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      assetType: data.assetType,
      description: data.description ?? null,
      acquisitionDate: new Date(data.acquisitionDate),
      saleDate: new Date(data.saleDate),
      acquisitionCost: data.acquisitionCost,
      saleValue: data.saleValue,
      expenses: data.expenses,
      acquiredBeforeRegimeChange: data.acquiredBeforeRegimeChange,
      indexedGainAmount: data.indexedGainAmount ?? null,
      computedGainAmount,
    },
  });
  revalidatePath("/income");
  return { ok: true };
}

export async function deleteCapitalGainAsset(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.capitalGainAsset.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/income");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Other-sources income
// ---------------------------------------------------------------------------

export async function createOtherSourceIncome(values: unknown): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  const parsed = otherSourceIncomeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await prisma.otherSourceIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: CURRENT_ASSESSMENT_YEAR,
      sourceType: parsed.data.sourceType,
      description: parsed.data.description ?? null,
      amount: parsed.data.amount,
      tdsDeducted: parsed.data.tdsDeducted,
    },
  });
  revalidatePath("/income");
  return { ok: true };
}

export async function deleteOtherSourceIncome(id: string): Promise<ActionResult> {
  await requireSession();
  const profile = await getOrCreateTaxpayerProfile();
  await prisma.otherSourceIncome.deleteMany({ where: { id, taxpayerProfileId: profile.id } });
  revalidatePath("/income");
  return { ok: true };
}
