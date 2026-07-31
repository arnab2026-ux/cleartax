/**
 * Live-database integration test — the one thing every prior phase could NOT
 * verify (see PROGRESS.md: "untested against a live database" appears in
 * Phases 0, 4, 5, 6, 7).
 *
 * SKIPPED BY DEFAULT. It only runs when `RUN_DB_INTEGRATION_TESTS=1` AND a
 * real `DATABASE_URL` is present, so CI (which sets a dummy DATABASE_URL) and
 * ordinary `npm test` runs stay hermetic and fast. To run it:
 *
 *   cd apps/web
 *   RUN_DB_INTEGRATION_TESTS=1 npx vitest run test/integration
 *
 * `./loadEnv` pulls DATABASE_URL and FIELD_ENCRYPTION_KEY out of
 * `apps/web/.env.local` automatically, so no other setup is needed.
 *
 * What it proves that unit tests cannot:
 *  1. The Prisma driver adapter actually connects to the real Postgres.
 *  2. The field-encryption Prisma extension round-trips PII correctly through
 *     a real write + read cycle (unit tests only covered the pure helpers).
 *  3. What is PHYSICALLY STORED is ciphertext, not plaintext — verified by
 *     reading the same row back over a separate raw connection that bypasses
 *     the extension entirely. This is the check that would catch the
 *     extension silently not being applied.
 *  4. The connection is TLS-encrypted (Supabase's pooler accepts unencrypted
 *     connections when `sslmode` is omitted — a real trap this caught).
 */
import "./loadEnv"; // must come first — populates process.env from .env.local
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { fieldEncryptionExtension } from "../../lib/prismaFieldEncryption";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);

const PAN = "ABCDE1234F";
const AADHAAR = "234567890123";
const ACCOUNT = "000123456789012";

describe.skipIf(!shouldRun)("live database integration", () => {
  const connectionString = process.env.DATABASE_URL as string;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) }).$extends(
    fieldEncryptionExtension,
  );
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.taxpayerProfile.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("connects over TLS (not plaintext)", async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      // pg only exposes an encrypted socket when SSL actually negotiated.
      const stream = (client as unknown as { connection?: { stream?: { encrypted?: boolean } } }).connection?.stream;
      expect(stream?.encrypted).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("round-trips encrypted PII through a real write and read", async () => {
    const created = await prisma.taxpayerProfile.create({
      data: {
        pan: PAN,
        aadhaar: AADHAAR,
        fullName: "Integration Test",
        dateOfBirth: new Date("1990-01-28"),
        bankAccountNumber: ACCOUNT,
        bankIfsc: "HDFC0001234",
        bankName: "Test Bank",
      },
    });
    createdIds.push(created.id);

    const readBack = await prisma.taxpayerProfile.findUnique({ where: { id: created.id } });
    expect(readBack?.pan).toBe(PAN);
    expect(readBack?.aadhaar).toBe(AADHAAR);
    expect(readBack?.bankAccountNumber).toBe(ACCOUNT);
  });

  it("physically stores ciphertext, never plaintext PII", async () => {
    const created = await prisma.taxpayerProfile.create({
      data: {
        pan: PAN,
        aadhaar: AADHAAR,
        fullName: "Integration Test Ciphertext",
        dateOfBirth: new Date("1990-01-28"),
        bankAccountNumber: ACCOUNT,
      },
    });
    createdIds.push(created.id);

    // Separate RAW connection — deliberately bypasses the Prisma extension, so
    // this reads exactly what's on disk.
    const raw = new pg.Client({ connectionString });
    await raw.connect();
    try {
      const { rows } = await raw.query<{ pan: string; aadhaar: string; bankAccountNumber: string }>(
        'select pan, aadhaar, "bankAccountNumber" from "TaxpayerProfile" where id = $1',
        [created.id],
      );
      const stored = rows[0]!;
      expect(stored.pan).not.toBe(PAN);
      expect(stored.aadhaar).not.toBe(AADHAAR);
      expect(stored.bankAccountNumber).not.toBe(ACCOUNT);
      // Stored format is "iv:authTag:ciphertext", all base64.
      expect(stored.pan.split(":")).toHaveLength(3);
    } finally {
      await raw.end();
    }
  });

  it("cascades deletes from TaxpayerProfile to dependent income rows", async () => {
    const profile = await prisma.taxpayerProfile.create({
      data: { pan: PAN, fullName: "Cascade Test", dateOfBirth: new Date("1990-01-28") },
    });
    await prisma.otherSourceIncome.create({
      data: {
        taxpayerProfileId: profile.id,
        assessmentYear: "2026-27",
        sourceType: "SAVINGS_INTEREST",
        amount: 8500,
      },
    });

    await prisma.taxpayerProfile.delete({ where: { id: profile.id } });
    const orphans = await prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId: profile.id } });
    expect(orphans).toHaveLength(0);
  });
});
