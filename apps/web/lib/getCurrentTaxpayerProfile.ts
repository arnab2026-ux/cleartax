import { prisma } from "./db";
import { requireUserId } from "./session";
import type { TaxpayerProfile } from "../generated/prisma/client";

/**
 * Resolves THE taxpayer profile belonging to the logged-in user — Phase 13.
 *
 * ============================================================================
 * THIS IS THE TENANT BOUNDARY
 * ============================================================================
 * Before Phase 13 this file was a singleton lookup:
 *
 *   prisma.taxpayerProfile.findFirst({ orderBy: { createdAt: "asc" } })
 *
 * ...which was correct for a single-user personal app and catastrophic the
 * moment a second account existed: every dashboard page and Server Action
 * resolves the profile through here and then queries by its id, so the first
 * registered user's PAN, salary, bank details and filings would have been
 * served to whoever happened to be logged in.
 *
 * Scoping happens HERE, once, keyed on the session's `userId`, because
 * `TaxpayerProfile.userId` is unique — so every downstream query that filters
 * by `taxpayerProfileId` is transitively scoped to the right tenant without
 * each call site having to remember. Any new code path that reaches taxpayer
 * data by some other route (a raw id from a URL, a `findFirst` with no
 * filter) is outside that guarantee and must scope itself explicitly.
 *
 * There is deliberately NO create-if-missing branch any more. Registration
 * creates the User and its profile together in one transaction
 * (app/api/auth/register/route.ts), so a session without a profile means an
 * invariant has already been broken — and the old fallback would paper over
 * it by silently creating an empty profile with a blank PAN, which is both
 * useless and indistinguishable from real data afterwards. Failing loudly is
 * the safer behaviour for the file that defines the tenant boundary.
 */
export async function getCurrentTaxpayerProfile(): Promise<TaxpayerProfile> {
  const userId = await requireUserId();
  const profile = await prisma.taxpayerProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error(
      `No TaxpayerProfile exists for user ${userId}. Registration creates one atomically with the account, ` +
        "so this means the invariant was broken — investigate rather than creating one here.",
    );
  }
  return profile;
}

/**
 * Like `getCurrentTaxpayerProfile`, but returns null instead of throwing —
 * for pages that would rather redirect than error. Still scoped by the
 * session's user; it is not a way to reach anyone else's profile.
 */
export async function getCurrentTaxpayerProfileOrNull(): Promise<TaxpayerProfile | null> {
  const userId = await requireUserId();
  return prisma.taxpayerProfile.findUnique({ where: { userId } });
}
