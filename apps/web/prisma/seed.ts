/**
 * Local-dev seed data: one realistic TaxpayerProfile + a plausible year
 * (AY 2026-27) of income/deduction data, so Phase 5's wizard UI has
 * something real to render against.
 *
 * NOT runnable against a real database yet — no live Neon connection
 * exists (see PROGRESS.md). This is written to typecheck cleanly and be
 * correct the moment a real DATABASE_URL is available; it hasn't been
 * executed for real. Run with: `npx prisma db seed` (wired via
 * `migrations.seed` in prisma.config.ts) or directly: `node prisma/seed.ts`
 * (Node 24's native TypeScript support runs this file's syntax without any
 * extra loader — see PROGRESS.md's `npx tsx` hang caveat for why we
 * deliberately avoid tsx/ts-node here).
 *
 * Deliberately does NOT import @cleartax/tax-engine to compute derived
 * figures (HRA exemption, capital-gains tax, etc.) — wiring tax-engine into
 * apps/web for the first time is explicitly Phase 5's job per PROGRESS.md's
 * "Next steps". The numbers below are plausible and internally consistent
 * (hand-computed where a formula applies, e.g. the HRA exemption — see
 * inline comments) but not engine-verified; treat them as realistic
 * fixture data, not a golden test case.
 *
 * Idempotent: deletes any existing TaxpayerProfile rows first (cascades to
 * every dependent table via onDelete: Cascade), so re-running this doesn't
 * accumulate duplicates.
 */
import { hashPassword } from "../lib/auth";
import { panBlindIndex } from "../lib/blindIndex";
import { prisma } from "../lib/db";
import { isFieldEncryptionConfigured } from "../lib/encryption";

const ASSESSMENT_YEAR = "2026-27";
const SEED_EMAIL = "arjun.mehta@example.com";
const SEED_PAN = "ABCDE1234F";

async function main() {
  if (!isFieldEncryptionConfigured()) {
    console.error(
      "FIELD_ENCRYPTION_KEY is not set. It's required to write TaxpayerProfile.pan/aadhaar/bankAccountNumber. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" and put it in .env.",
    );
    process.exit(1);
  }

  if (!process.env["PAN_BLIND_INDEX_KEY"]) {
    console.error(
      "PAN_BLIND_INDEX_KEY is not set. Phase 13 requires it to seed a User (see lib/blindIndex.ts). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" — " +
        "and make it different from FIELD_ENCRYPTION_KEY.",
    );
    process.exit(1);
  }

  // Idempotency: wipe any prior seed run. Deleting the User cascades to its
  // TaxpayerProfile, which cascades to every child table.
  await prisma.user.deleteMany({ where: { email: SEED_EMAIL } });
  await prisma.taxpayerProfile.deleteMany({});

  // Phase 13: a profile cannot exist without an owner. Created by its own
  // model call rather than as a nested write under `user.create`, because the
  // field-encryption extension only intercepts `taxpayerProfile.*` — a nested
  // create would write the PAN in PLAINTEXT (see app/api/auth/register/route.ts).
  const user = await prisma.user.create({
    data: {
      email: SEED_EMAIL,
      // "seed-password-not-for-real-use" — hashed, so the seeded account is
      // loginable locally without a plaintext password sitting in the repo.
      passwordHash: hashPassword("seed-password-not-for-real-use"),
      phone: "+919876543210",
      panBlindIndex: panBlindIndex(SEED_PAN),
    },
  });

  const profile = await prisma.taxpayerProfile.create({
    data: {
      userId: user.id,
      // Plaintext here — the field-encryption extension (lib/prismaFieldEncryption.ts)
      // encrypts pan/aadhaar/bankAccountNumber transparently before this reaches Postgres.
      pan: SEED_PAN,
      aadhaar: "234567890123",
      fullName: "Arjun Mehta",
      dateOfBirth: new Date("1988-06-15"),
      // Phase 11: explicit rather than relying on the column default, since
      // this seed exercises Schedule FA below and that schedule applies ONLY
      // to a Resident and Ordinarily Resident individual.
      residentialStatus: "ROR",
      addressLine1: "221B, Business Bay Towers",
      addressLine2: "Bandra Kurla Complex",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400051",
      bankAccountNumber: "000123456789012",
      bankIfsc: "HDFC0000123",
      bankName: "HDFC Bank",
    },
  });

  // Salary: basic 9,00,000, HRA received 3,60,000, rent paid 3,00,000, Mumbai (metro, 50%).
  // Hand-computed Section 10(13A) exemption (see packages/tax-engine/src/ay2026-27/hra.ts's formula):
  //   least of: hraReceived (3,60,000); rentPaid - 10% basic = 3,00,000 - 90,000 = 2,10,000; 50% basic = 4,50,000
  //   => exemptHra = 2,10,000.
  await prisma.salaryIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: ASSESSMENT_YEAR,
      employerName: "Acme Technologies Pvt Ltd",
      grossSalary: 1_800_000,
      basicSalary: 900_000,
      hraReceived: 360_000,
      rentPaid: 300_000,
      isMetroCity: true,
      ltaReceived: 30_000,
      otherAllowances: 60_000,
      perquisitesValue: 50_000,
      exemptHra: 210_000,
      exemptLta: 25_000,
      exemptOther: 0,
      standardDeduction: 75_000,
      professionalTax: 2_400,
      tdsDeducted: 185_000,
    },
  });

  // One let-out property in Pune, running at a small loss after the 30%
  // standard deduction + home loan interest (NAV 2,28,000 - 68,400 - 1,80,000 = -20,400).
  await prisma.housePropertyIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: ASSESSMENT_YEAR,
      propertyType: "LET_OUT",
      address: "Flat 402, Lake View Residency, Pune",
      annualLetableValue: 240_000,
      municipalTaxesPaid: 12_000,
      homeLoanInterest: 180_000,
      netIncomeOrLoss: -20_400,
    },
  });

  // Two capital-gains transactions: a straightforward long-term equity MF
  // sale, and a pre-23-Jul-2024 immovable-property sale eligible for the
  // Section 112 grandfathering comparison (indexedGainAmount supplied).
  await prisma.capitalGainAsset.createMany({
    data: [
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        assetType: "LISTED_EQUITY_OR_EQUITY_MF",
        description: "Equity mutual fund units — Axis Bluechip Fund",
        acquisitionDate: new Date("2023-01-10"),
        saleDate: new Date("2025-11-20"),
        acquisitionCost: 200_000,
        saleValue: 350_000,
        expenses: 500,
        acquiredBeforeRegimeChange: false,
        indexedGainAmount: null,
        computedGainAmount: 149_500,
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        assetType: "IMMOVABLE_PROPERTY",
        description: "Ancestral land parcel sale — Nashik",
        acquisitionDate: new Date("2010-04-01"),
        saleDate: new Date("2025-09-15"),
        acquisitionCost: 1_500_000,
        saleValue: 6_000_000,
        expenses: 100_000,
        acquiredBeforeRegimeChange: true,
        // Illustrative indexed gain (lower than the raw 44,00,000 gain, as
        // indexation typically produces for a 2010-era acquisition) —
        // Phase 5/6's mapping layer will compute this for real from CII
        // tables rather than hardcoding it.
        indexedGainAmount: 2_800_000,
        computedGainAmount: 4_400_000,
      },
    ],
  });

  await prisma.otherSourceIncome.createMany({
    data: [
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        sourceType: "SAVINGS_INTEREST",
        description: "SBI savings account interest",
        amount: 8_500,
        tdsDeducted: 0,
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        sourceType: "FIXED_DEPOSIT_INTEREST",
        description: "HDFC Bank fixed deposit interest",
        amount: 45_000,
        tdsDeducted: 4_500,
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        sourceType: "DIVIDEND",
        description: "Equity dividend income",
        amount: 12_000,
        tdsDeducted: 0,
      },
    ],
  });

  await prisma.deduction.createMany({
    data: [
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        section: "SECTION_80C",
        description: "ELSS + PPF + LIC premium",
        amount: 150_000,
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        section: "SECTION_80D",
        description: "Health insurance premium — self & family",
        amount: 22_000,
        // Phase 5's mapping layer (lib/mapping/toTaxEngineInput.ts's
        // reconstructSection80D) reads Section80D sub-bucket/senior-flag
        // facts from metaJson, not from `section`/`amount` alone — a row
        // without it is silently treated as un-attributable and contributes
        // ₹0 to the computed deduction (fail-safe by design, see
        // reconstructSection80D's doc comment and
        // test/mapping/toTaxEngineInput.test.ts's "fails safe" case). This
        // row predates that Phase 5 schema addition; without metaJson here,
        // running this seed against a real database would silently drop
        // this ₹22,000 deduction from every computed tax figure.
        metaJson: { bucket: "selfFamily", isSenior: false },
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        section: "SECTION_80CCD_1B",
        description: "NPS additional contribution (Tier I)",
        amount: 50_000,
      },
      // No SECTION_80TTA/80TTB Deduction row: per Phase 5's design, this
      // section is never manually entered or read from Deduction rows at
      // all — lib/mapping/toTaxEngineInput.ts's interestIncomeForTtaOrTtb
      // computes it automatically from OtherSourceIncome interest rows
      // (the SAVINGS_INTEREST row below already supplies the ₹8,500 this
      // used to duplicate as a separate, and entirely unread, Deduction
      // row). Keeping a SECTION_80TTA row here would be dead/misleading
      // fixture data, not a second source of the same deduction.
    ],
  });

  // Phase 11 — the canonical foreign-asset case: US RSUs. TWO Schedule FA
  // rows are required and both are correct (this is not double reporting):
  // the SHARES go in table A3, the brokerage ACCOUNT holding them in A2.
  //
  // Every value below is a CALENDAR-year figure (1 Jan - 31 Dec 2025 for AY
  // 2026-27), unlike every other table in this seed, which is
  // financial-year. See lib/foreignAssetPeriod.ts.
  await prisma.foreignAsset.createMany({
    data: [
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        assetType: "A3_FOREIGN_EQUITY_DEBT_INTEREST",
        countryCode: "2", // ISD code for the UNITED STATES OF AMERICA, per the ITR schema's own enum
        countryName: "UNITED STATES OF AMERICA",
        description: "Acme Global Inc. RSUs",
        entityName: "Acme Global Inc.",
        entityAddress: "1 Acme Way, Sunnyvale, CA",
        zipCode: "94085",
        natureOfEntity: "Company",
        ownership: "OWNER",
        // The VEST date — a grant confers no interest in the shares.
        acquisitionDate: new Date("2023-02-15"),
        // FMV on the vest date: the perquisite already taxed via Form 16, and
        // the cost base for the capital gain above.
        initialValue: 1_800_000,
        peakValue: 3_300_000,
        closingValue: 2_900_000,
        incomeAccrued: 48_000, // dividends received during calendar 2025
        incomeNature: "DIVIDEND",
        grossProceeds: 0,
      },
      {
        taxpayerProfileId: profile.id,
        assessmentYear: ASSESSMENT_YEAR,
        assetType: "A2_FOREIGN_CUSTODIAL_ACCOUNT",
        countryCode: "2",
        countryName: "UNITED STATES OF AMERICA",
        description: "Morgan Stanley StockPlan account",
        entityName: "Morgan Stanley Smith Barney LLC",
        entityAddress: "1585 Broadway, New York, NY",
        zipCode: "10036",
        accountNumber: "1234567890",
        ownership: "OWNER",
        acquisitionDate: new Date("2022-04-12"),
        // Account-level: the shares PLUS any idle cash.
        peakValue: 3_400_000,
        closingValue: 2_950_000,
        incomeAccrued: 48_000,
        incomeNature: "DIVIDEND",
      },
    ],
  });

  // The dividend itself, for Schedules FSI/TR and the Rule 128 credit. 25%
  // withheld in the US under Article 10(2)(b) of the India-US DTAA (the 15%
  // rate is company-only and never applies to an individual RSU holder).
  // `alreadyIncludedInIndianIncome: false` because this dividend is NOT
  // recorded as an OtherSourceIncome row anywhere above — the tax engine adds
  // it to slab-rate other-sources income itself.
  await prisma.foreignSourceIncome.create({
    data: {
      taxpayerProfileId: profile.id,
      assessmentYear: ASSESSMENT_YEAR,
      countryCode: "2",
      countryName: "UNITED STATES OF AMERICA",
      taxIdentificationNumber: "123-45-6789",
      head: "OTHER_SOURCES",
      description: "Acme Global Inc. dividends",
      incomeAmount: 48_000,
      foreignTaxPaid: 12_000,
      dtaaRateCapPercent: 25,
      dtaaArticle: "Article 10(2)(b)",
      reliefSection: "SECTION_90",
      alreadyIncludedInIndianIncome: false,
      // Deliberately false: the seeded taxpayer has NOT filed Form 67, so the
      // /foreign-assets page's warning banner is exercised by this fixture.
      form67Filed: false,
    },
  });

  console.log(`Seeded TaxpayerProfile ${profile.id} (PAN decrypts back to ${profile.pan}) for AY ${ASSESSMENT_YEAR}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
