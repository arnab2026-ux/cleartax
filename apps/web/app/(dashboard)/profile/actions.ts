"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { taxpayerProfileSchema } from "@/lib/validation/profile";

export interface SaveProfileResult {
  ok: boolean;
  error?: string;
}

/**
 * Upserts the single `TaxpayerProfile` row (find-or-create, per this app's
 * single-tenant design — see `lib/getOrCreateTaxpayerProfile.ts`). Session
 * is checked here too (not just relying on `proxy.ts`) — Server Actions are
 * directly-callable POST endpoints, so per Next.js 16's own guidance this is
 * defense in depth, matching the pattern in
 * `app/api/form16/upload/route.ts`.
 */
export async function saveProfile(values: unknown): Promise<SaveProfileResult> {
  await requireSession();

  const parsed = taxpayerProfileSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid profile data" };
  }
  const data = parsed.data;

  const existing = await prisma.taxpayerProfile.findFirst({ orderBy: { createdAt: "asc" } });

  const payload = {
    residentialStatus: data.residentialStatus,
    pan: data.pan,
    fullName: data.fullName,
    dateOfBirth: new Date(data.dateOfBirth),
    aadhaar: data.aadhaar ?? null,
    addressLine1: data.addressLine1 ?? null,
    addressLine2: data.addressLine2 ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    pincode: data.pincode ?? null,
    bankAccountNumber: data.bankAccountNumber ?? null,
    bankIfsc: data.bankIfsc ?? null,
    bankName: data.bankName ?? null,
  };

  if (existing) {
    await prisma.taxpayerProfile.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.taxpayerProfile.create({ data: payload });
  }

  revalidatePath("/profile");
  return { ok: true };
}
