-- Phase 13 (multi-user accounts, invite-only) — applied to the live Supabase
-- database on 2026-08-12, after phase12-migration.sql. Applied in two steps:
-- the User/profile-ownership changes first, then the Invite table.
--
-- Provenance: prisma migrate diff --from-schema <schema.prisma@be257c9>
--                                 --to-schema prisma/schema.prisma --script
-- with the DELETE below hand-prepended. Applied through the Supabase API, for
-- the P1001 pooler reason recorded in phase11-migration.sql.
--
-- NOT purely additive: it deletes the one pre-existing TaxpayerProfile. That
-- row could not be backfilled onto a User because a User requires an email
-- (the row had none), a password (none existed) and a PAN blind index, which
-- cannot be derived in SQL — the PAN is AES-256-GCM encrypted under a random
-- IV and only the Prisma client extension can read it. Confirmed beforehand
-- that the row had no dependent SalaryIncome, Deduction, Form16Upload,
-- TaxComputation or ItrJsonArtifact rows, so no tax data was lost; the
-- identity and bank details are re-entered through registration.
DELETE FROM "TaxpayerProfile";
-- AlterTable
ALTER TABLE "TaxpayerProfile" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "panBlindIndex" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_usedAt_idx" ON "Invite"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_panBlindIndex_key" ON "User"("panBlindIndex");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxpayerProfile_userId_key" ON "TaxpayerProfile"("userId");

-- AddForeignKey
ALTER TABLE "TaxpayerProfile" ADD CONSTRAINT "TaxpayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
