-- Phase 12 (section 10 exemptions) — applied to the live Supabase database
-- on 2026-08-11, immediately after phase11-migration.sql.
--
-- Provenance: prisma migrate diff --from-schema <schema.prisma@e83ac36>
--                                 --to-schema prisma/schema.prisma --script
-- e83ac36 is the revision the live database matched once the Phase 11
-- migration had been applied. Applied through the Supabase API, for the same
-- P1001 pooler reason recorded in phase11-migration.sql.
--
-- Additive only, and SalaryIncome had 0 rows at the time, so no backfill.
-- AlterTable
ALTER TABLE "SalaryIncome" ADD COLUMN     "exemptRetirementSection10" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reportedTotalSection10Exemption" DECIMAL(14,2);
