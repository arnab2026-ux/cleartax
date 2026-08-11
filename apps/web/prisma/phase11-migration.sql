-- Phase 11 (foreign assets) + residentialStatus, applied to the live Supabase
-- database on 2026-08-11.
--
-- Provenance: generated with
--   prisma migrate diff --from-schema <schema.prisma@ab7b160> \
--                       --to-schema prisma/schema.prisma --script
-- i.e. diffed against the last schema revision that init-migration.sql covers,
-- after confirming via information_schema that the live database matched that
-- revision exactly on every table.
--
-- NOT generated with --from-config-datasource: Prisma's schema engine cannot
-- reach Supabase's transaction pooler (P1001 on port 6543) even though plain
-- TCP to that host/port succeeds. Applied through the Supabase API instead.
--
-- Purely additive: 6 CREATE TYPE, 1 ALTER TYPE ADD VALUE, 2 ADD COLUMN (both
-- NOT NULL with defaults), 2 CREATE TABLE, 2 indexes, 2 foreign keys. No DROP.
-- CreateEnum
CREATE TYPE "ResidentialStatus" AS ENUM ('ROR', 'RNOR', 'NR');

-- CreateEnum
CREATE TYPE "ForeignAssetType" AS ENUM ('A1_FOREIGN_DEPOSITORY_ACCOUNT', 'A2_FOREIGN_CUSTODIAL_ACCOUNT', 'A3_FOREIGN_EQUITY_DEBT_INTEREST', 'A4_FOREIGN_CASH_VALUE_INSURANCE', 'B_FINANCIAL_INTEREST_IN_ENTITY', 'C_IMMOVABLE_PROPERTY', 'D_OTHER_CAPITAL_ASSET', 'E_SIGNING_AUTHORITY_ACCOUNT', 'F_TRUST_OUTSIDE_INDIA', 'G_OTHER_FOREIGN_SOURCE_INCOME');

-- CreateEnum
CREATE TYPE "ForeignAssetOwnership" AS ENUM ('OWNER', 'BENEFICIAL_OWNER', 'BENIFICIARY');

-- CreateEnum
CREATE TYPE "ForeignIncomeNature" AS ENUM ('INTEREST', 'DIVIDEND', 'SALE_PROCEEDS', 'OTHER', 'NONE');

-- CreateEnum
CREATE TYPE "ForeignIncomeHead" AS ENUM ('SALARY', 'HOUSE_PROPERTY', 'CAPITAL_GAINS', 'OTHER_SOURCES');

-- CreateEnum
CREATE TYPE "ForeignTaxReliefSection" AS ENUM ('SECTION_90', 'SECTION_90A', 'SECTION_91');

-- AlterEnum
ALTER TYPE "CapitalAssetType" ADD VALUE 'FOREIGN_SHARES';

-- AlterTable
ALTER TABLE "TaxpayerProfile" ADD COLUMN     "residentialStatus" "ResidentialStatus" NOT NULL DEFAULT 'ROR';

-- AlterTable
ALTER TABLE "TaxComputation" ADD COLUMN     "foreignTaxCredit" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ForeignAsset" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "assetType" "ForeignAssetType" NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "entityName" TEXT,
    "entityAddress" TEXT,
    "zipCode" TEXT,
    "natureOfEntity" TEXT,
    "accountNumber" TEXT,
    "ownership" "ForeignAssetOwnership" NOT NULL DEFAULT 'OWNER',
    "acquisitionDate" TIMESTAMP(3),
    "initialValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "peakValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closingValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incomeAccrued" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incomeNature" "ForeignIncomeNature" NOT NULL DEFAULT 'NONE',
    "grossProceeds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incomeTaxableInIndia" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeignAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignSourceIncome" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "taxIdentificationNumber" TEXT NOT NULL,
    "head" "ForeignIncomeHead" NOT NULL,
    "description" TEXT,
    "incomeAmount" DECIMAL(14,2) NOT NULL,
    "foreignTaxPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dtaaRateCapPercent" DECIMAL(5,2),
    "dtaaArticle" TEXT,
    "reliefSection" "ForeignTaxReliefSection" NOT NULL DEFAULT 'SECTION_90',
    "alreadyIncludedInIndianIncome" BOOLEAN NOT NULL DEFAULT false,
    "form67Filed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeignSourceIncome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForeignAsset_taxpayerProfileId_assessmentYear_idx" ON "ForeignAsset"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "ForeignSourceIncome_taxpayerProfileId_assessmentYear_idx" ON "ForeignSourceIncome"("taxpayerProfileId", "assessmentYear");

-- AddForeignKey
ALTER TABLE "ForeignAsset" ADD CONSTRAINT "ForeignAsset_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignSourceIncome" ADD CONSTRAINT "ForeignSourceIncome_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
