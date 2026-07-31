Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Form16ParseStatus" AS ENUM ('PENDING', 'PARSED', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "HousePropertyType" AS ENUM ('SELF_OCCUPIED', 'LET_OUT');

-- CreateEnum
CREATE TYPE "CapitalAssetType" AS ENUM ('LISTED_EQUITY_OR_EQUITY_MF', 'UNLISTED_SHARES', 'DEBT_MUTUAL_FUND', 'IMMOVABLE_PROPERTY', 'GOLD', 'OTHER_ASSET');

-- CreateEnum
CREATE TYPE "OtherSourceType" AS ENUM ('SAVINGS_INTEREST', 'FIXED_DEPOSIT_INTEREST', 'RECURRING_DEPOSIT_INTEREST', 'DIVIDEND', 'FAMILY_PENSION', 'LOTTERY_OR_GAME_WINNINGS', 'GIFT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeductionSection" AS ENUM ('SECTION_80C', 'SECTION_80D', 'SECTION_80CCD_1B', 'SECTION_80CCD_2', 'SECTION_80TTA', 'SECTION_80TTB');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateEnum
CREATE TYPE "ItrType" AS ENUM ('ITR1', 'ITR2');

-- CreateEnum
CREATE TYPE "FilingProvider" AS ENUM ('MOCK');

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "TaxpayerProfile" (
    "id" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "aadhaar" TEXT,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "email" TEXT,
    "mobileNumber" TEXT,
    "fatherName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxpayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form16Upload" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "employerName" TEXT,
    "employerTan" TEXT,
    "blobUrl" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parseStatus" "Form16ParseStatus" NOT NULL DEFAULT 'PENDING',
    "rawExtractedJson" JSONB,

    CONSTRAINT "Form16Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryIncome" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "form16UploadId" TEXT,
    "employerName" TEXT NOT NULL,
    "grossSalary" DECIMAL(14,2) NOT NULL,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "hraReceived" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rentPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isMetroCity" BOOLEAN NOT NULL DEFAULT false,
    "ltaReceived" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "perquisitesValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exemptHra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exemptLta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exemptOther" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "standardDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "professionalTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tdsDeducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousePropertyIncome" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "propertyType" "HousePropertyType" NOT NULL,
    "address" TEXT,
    "annualLetableValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "municipalTaxesPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "homeLoanInterest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netIncomeOrLoss" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousePropertyIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalGainAsset" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "assetType" "CapitalAssetType" NOT NULL,
    "description" TEXT,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(14,2) NOT NULL,
    "saleValue" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acquiredBeforeRegimeChange" BOOLEAN NOT NULL DEFAULT false,
    "indexedGainAmount" DECIMAL(14,2),
    "computedGainAmount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapitalGainAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherSourceIncome" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "sourceType" "OtherSourceType" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "tdsDeducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherSourceIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "section" "DeductionSection" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxComputation" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "inputSnapshotJson" JSONB NOT NULL,
    "grossTotalIncome" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "taxableIncome" DECIMAL(14,2) NOT NULL,
    "taxBeforeRebate" DECIMAL(14,2) NOT NULL,
    "capitalGainsTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rebate" DECIMAL(14,2) NOT NULL,
    "taxAfterRebate" DECIMAL(14,2) NOT NULL,
    "surcharge" DECIMAL(14,2) NOT NULL,
    "marginalRelief" DECIMAL(14,2) NOT NULL,
    "cess" DECIMAL(14,2) NOT NULL,
    "totalTaxLiability" DECIMAL(14,2) NOT NULL,
    "tdsCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPayableOrRefund" DECIMAL(14,2) NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxComputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItrJsonArtifact" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "itrType" "ItrType" NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "jsonPayload" JSONB NOT NULL,
    "blobUrl" TEXT,
    "taxComputationId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItrJsonArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingAttempt" (
    "id" TEXT NOT NULL,
    "taxpayerProfileId" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "itrJsonArtifactId" TEXT NOT NULL,
    "provider" "FilingProvider" NOT NULL DEFAULT 'MOCK',
    "status" "FilingStatus" NOT NULL,
    "acknowledgementNumber" TEXT,
    "statusHistoryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Form16Upload_taxpayerProfileId_assessmentYear_idx" ON "Form16Upload"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE UNIQUE INDEX "Form16Upload_taxpayerProfileId_fileHash_key" ON "Form16Upload"("taxpayerProfileId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryIncome_form16UploadId_key" ON "SalaryIncome"("form16UploadId");

-- CreateIndex
CREATE INDEX "SalaryIncome_taxpayerProfileId_assessmentYear_idx" ON "SalaryIncome"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "HousePropertyIncome_taxpayerProfileId_assessmentYear_idx" ON "HousePropertyIncome"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "CapitalGainAsset_taxpayerProfileId_assessmentYear_idx" ON "CapitalGainAsset"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "OtherSourceIncome_taxpayerProfileId_assessmentYear_idx" ON "OtherSourceIncome"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "Deduction_taxpayerProfileId_assessmentYear_idx" ON "Deduction"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "TaxComputation_taxpayerProfileId_assessmentYear_idx" ON "TaxComputation"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "ItrJsonArtifact_taxpayerProfileId_assessmentYear_idx" ON "ItrJsonArtifact"("taxpayerProfileId", "assessmentYear");

-- CreateIndex
CREATE INDEX "FilingAttempt_taxpayerProfileId_assessmentYear_idx" ON "FilingAttempt"("taxpayerProfileId", "assessmentYear");

-- AddForeignKey
ALTER TABLE "Form16Upload" ADD CONSTRAINT "Form16Upload_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryIncome" ADD CONSTRAINT "SalaryIncome_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryIncome" ADD CONSTRAINT "SalaryIncome_form16UploadId_fkey" FOREIGN KEY ("form16UploadId") REFERENCES "Form16Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePropertyIncome" ADD CONSTRAINT "HousePropertyIncome_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalGainAsset" ADD CONSTRAINT "CapitalGainAsset_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherSourceIncome" ADD CONSTRAINT "OtherSourceIncome_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxComputation" ADD CONSTRAINT "TaxComputation_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItrJsonArtifact" ADD CONSTRAINT "ItrJsonArtifact_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItrJsonArtifact" ADD CONSTRAINT "ItrJsonArtifact_taxComputationId_fkey" FOREIGN KEY ("taxComputationId") REFERENCES "TaxComputation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingAttempt" ADD CONSTRAINT "FilingAttempt_taxpayerProfileId_fkey" FOREIGN KEY ("taxpayerProfileId") REFERENCES "TaxpayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingAttempt" ADD CONSTRAINT "FilingAttempt_itrJsonArtifactId_fkey" FOREIGN KEY ("itrJsonArtifactId") REFERENCES "ItrJsonArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

