import { prisma } from "./db";
import type { TaxpayerProfile } from "../generated/prisma/client";

/**
 * This is a single-tenant app — exactly one `TaxpayerProfile` row is meant
 * to ever exist (see the model's own doc comment in `schema.prisma`: "not
 * enforced at the schema level ... Phase 5's wizard UI is responsible for
 * that"). This is the one place that invariant is actually enforced:
 * find the existing profile if one exists, otherwise create a fresh one
 * with the given seed values (or empty-but-valid placeholders).
 *
 * Every page/action in the wizard that needs "the" profile should go
 * through this helper (or `getTaxpayerProfileOrNull` below) rather than
 * calling `prisma.taxpayerProfile.findFirst()`/`.create()` directly, so the
 * single-profile invariant lives in one place.
 */
export async function getOrCreateTaxpayerProfile(
  seed?: Partial<Pick<TaxpayerProfile, "pan" | "fullName" | "dateOfBirth">>,
): Promise<TaxpayerProfile> {
  const existing = await prisma.taxpayerProfile.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return prisma.taxpayerProfile.create({
    data: {
      pan: seed?.pan ?? "",
      fullName: seed?.fullName ?? "",
      dateOfBirth: seed?.dateOfBirth ?? new Date(Date.UTC(1990, 0, 1)),
    },
  });
}

/** Like `getOrCreateTaxpayerProfile`, but returns null instead of creating a placeholder — for pages that should redirect to `/profile` when no profile exists yet. */
export async function getTaxpayerProfileOrNull(): Promise<TaxpayerProfile | null> {
  return prisma.taxpayerProfile.findFirst({ orderBy: { createdAt: "asc" } });
}
