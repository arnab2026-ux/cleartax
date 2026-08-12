/**
 * Cross-tenant isolation against the REAL database — Phase 13.
 *
 * SKIPPED BY DEFAULT, same as liveDatabase.test.ts. Run with:
 *
 *   cd apps/web
 *   RUN_DB_INTEGRATION_TESTS=1 npx vitest run test/integration
 *
 * WHY THESE EXIST
 * ===============
 * Phase 13 turned a single-tenant app into a multi-user one, and the audit
 * that came with it found six places where a row was reached by an id with no
 * ownership filter. Those were fixed by reading the code. Reading is not
 * proof, and the failure mode — one user seeing another's PAN, salary or bank
 * details — is the worst this app has. So these assert the invariants against
 * real Postgres, with two real users and real rows.
 *
 * They exercise the same QUERY SHAPES the application uses (scoped by
 * `taxpayerProfileId`, resolved from `userId`) rather than calling the route
 * handlers, which would need a running server and a NextRequest. What they
 * prove is that the scoping predicate genuinely partitions the data and that
 * the database-level constraints hold; the browser walkthrough recorded in
 * PROGRESS.md covers the HTTP path.
 */
import "./loadEnv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { fieldEncryptionExtension } from "../../lib/prismaFieldEncryption";
import { panBlindIndex } from "../../lib/blindIndex";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ALICE = { email: `iso-alice-${RUN_ID}@example.test`, pan: "AAAPA1111A", name: "Alice Isolation" };
const BOB = { email: `iso-bob-${RUN_ID}@example.test`, pan: "BBBPB2222B", name: "Bob Isolation" };

describe.skipIf(!shouldRun)("cross-tenant isolation", () => {
  const connectionString = process.env.DATABASE_URL as string;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) }).$extends(fieldEncryptionExtension);

  const userIds: string[] = [];
  let aliceUserId = "";
  let bobUserId = "";
  let aliceProfileId = "";
  let bobProfileId = "";

  async function createAccount(spec: { email: string; pan: string; name: string }) {
    const user = await prisma.user.create({
      data: {
        email: spec.email,
        passwordHash: "scrypt:00:00",
        phone: "+919876543210",
        panBlindIndex: panBlindIndex(spec.pan),
      },
    });
    userIds.push(user.id);
    const profile = await prisma.taxpayerProfile.create({
      data: { userId: user.id, pan: spec.pan, fullName: spec.name, dateOfBirth: new Date("1990-01-01") },
    });
    return { userId: user.id, profileId: profile.id };
  }

  beforeAll(async () => {
    ({ userId: aliceUserId, profileId: aliceProfileId } = await createAccount(ALICE));
    ({ userId: bobUserId, profileId: bobProfileId } = await createAccount(BOB));

    // Give Alice data across the tables that matter most if they leaked.
    await prisma.salaryIncome.create({
      data: {
        taxpayerProfileId: aliceProfileId,
        assessmentYear: "2026-27",
        employerName: "Alice Employer",
        grossSalary: 2_500_000,
        basicSalary: 1_200_000,
      },
    });
    await prisma.taxComputation.create({
      data: {
        taxpayerProfileId: aliceProfileId,
        assessmentYear: "2026-27",
        regime: "NEW",
        engineVersion: "test",
        inputSnapshotJson: {},
        grossTotalIncome: 2_500_000,
        totalDeductions: 0,
        taxableIncome: 2_425_000,
        taxBeforeRebate: 0,
        rebate: 0,
        taxAfterRebate: 0,
        surcharge: 0,
        marginalRelief: 0,
        cess: 0,
        capitalGainsTax: 0,
        totalTaxLiability: 0,
        tdsCredit: 0,
        netPayableOrRefund: 0,
      },
    });
  });

  afterAll(async () => {
    // Deleting the user cascades to the profile and everything beneath it.
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe("profile resolution (the tenant boundary)", () => {
    it("resolves each user to their OWN profile", async () => {
      const alice = await prisma.taxpayerProfile.findUnique({ where: { userId: aliceUserId } });
      const bob = await prisma.taxpayerProfile.findUnique({ where: { userId: bobUserId } });
      expect(alice?.id).toBe(aliceProfileId);
      expect(bob?.id).toBe(bobProfileId);
      expect(alice?.id).not.toBe(bob?.id);
    });

    it("returns each user's own PAN, decrypted, and never the other's", async () => {
      const alice = await prisma.taxpayerProfile.findUnique({ where: { userId: aliceUserId } });
      const bob = await prisma.taxpayerProfile.findUnique({ where: { userId: bobUserId } });
      expect(alice?.pan).toBe(ALICE.pan);
      expect(bob?.pan).toBe(BOB.pan);
    });

    it("the OLD unscoped query would have returned one profile to both users", async () => {
      // Pins the actual bug Phase 13 fixed: this is verbatim what
      // getOrCreateTaxpayerProfile used to do. It returns a single row
      // regardless of who is asking, which is exactly the leak.
      const whoeverIsFirst = await prisma.taxpayerProfile.findFirst({ orderBy: { createdAt: "asc" } });
      expect(whoeverIsFirst).not.toBeNull();
      // Whichever profile that is, it is necessarily wrong for one of them.
      const servesAlice = whoeverIsFirst!.id === aliceProfileId;
      const servesBob = whoeverIsFirst!.id === bobProfileId;
      expect(servesAlice && servesBob).toBe(false);
    });
  });

  describe("scoped reads", () => {
    it("Bob's salary query returns none of Alice's rows", async () => {
      const bobRows = await prisma.salaryIncome.findMany({ where: { taxpayerProfileId: bobProfileId } });
      expect(bobRows).toHaveLength(0);
      const aliceRows = await prisma.salaryIncome.findMany({ where: { taxpayerProfileId: aliceProfileId } });
      expect(aliceRows).toHaveLength(1);
    });

    it("Bob cannot fetch Alice's TaxComputation by id once the query is scoped", async () => {
      const aliceComputation = await prisma.taxComputation.findFirst({
        where: { taxpayerProfileId: aliceProfileId },
      });
      expect(aliceComputation).not.toBeNull();

      // The IDOR shape: Bob supplies Alice's id. Scoped, it finds nothing.
      const asBob = await prisma.taxComputation.findFirst({
        where: { id: aliceComputation!.id, taxpayerProfileId: bobProfileId },
      });
      expect(asBob).toBeNull();

      // Unscoped — what the code did before Phase 13 — it hands the row over.
      const unscoped = await prisma.taxComputation.findUnique({ where: { id: aliceComputation!.id } });
      expect(unscoped).not.toBeNull();
    });
  });

  describe("scoped writes", () => {
    it("Bob updating Alice's profile id affects zero rows when scoped by his own userId", async () => {
      const before = await prisma.taxpayerProfile.findUnique({ where: { userId: aliceUserId } });

      // saveProfile's shape after Phase 13: the where clause is the session's
      // userId, so there is no id for Bob to supply that reaches Alice's row.
      await prisma.taxpayerProfile.update({
        where: { userId: bobUserId },
        data: { fullName: "Bob Renamed Himself" },
      });

      const after = await prisma.taxpayerProfile.findUnique({ where: { userId: aliceUserId } });
      expect(after?.fullName).toBe(before?.fullName);
      expect(after?.fullName).toBe(ALICE.name);

      const bob = await prisma.taxpayerProfile.findUnique({ where: { userId: bobUserId } });
      expect(bob?.fullName).toBe("Bob Renamed Himself");
    });

    it("a scoped deleteMany against another tenant's row removes nothing", async () => {
      const aliceRow = await prisma.salaryIncome.findFirst({ where: { taxpayerProfileId: aliceProfileId } });
      const result = await prisma.salaryIncome.deleteMany({
        where: { id: aliceRow!.id, taxpayerProfileId: bobProfileId },
      });
      expect(result.count).toBe(0);
      expect(await prisma.salaryIncome.findUnique({ where: { id: aliceRow!.id } })).not.toBeNull();
    });
  });

  describe("account constraints", () => {
    it("rejects a second account with the same email", async () => {
      await expect(
        prisma.user.create({
          data: {
            email: ALICE.email,
            passwordHash: "scrypt:00:00",
            phone: "+919876543210",
            panBlindIndex: panBlindIndex("ZZZPZ9999Z"),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("rejects a second account with the same PAN, via the blind index", async () => {
      // The whole point of the blind index: the PAN column itself is
      // encrypted under a random IV and could never have caught this.
      await expect(
        prisma.user.create({
          data: {
            email: `iso-dup-${RUN_ID}@example.test`,
            passwordHash: "scrypt:00:00",
            phone: "+919876543210",
            panBlindIndex: panBlindIndex(ALICE.pan),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("matches the same PAN regardless of case or spacing", async () => {
      await expect(
        prisma.user.create({
          data: {
            email: `iso-dup2-${RUN_ID}@example.test`,
            passwordHash: "scrypt:00:00",
            phone: "+919876543210",
            panBlindIndex: panBlindIndex(" aaapa1111a "),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("invite redemption", () => {
    it("is single-use: the compare-and-set matches exactly once", async () => {
      const code = `iso-invite-${RUN_ID}`;
      await prisma.invite.create({ data: { code } });

      const first = await prisma.invite.updateMany({
        where: { code, usedAt: null, OR: [{ email: null }, { email: "x@example.test" }] },
        data: { usedAt: new Date() },
      });
      const second = await prisma.invite.updateMany({
        where: { code, usedAt: null, OR: [{ email: null }, { email: "x@example.test" }] },
        data: { usedAt: new Date() },
      });

      expect(first.count).toBe(1);
      expect(second.count).toBe(0); // the second registration would roll back

      await prisma.invite.deleteMany({ where: { code } });
    });

    it("honours an email binding", async () => {
      const code = `iso-bound-${RUN_ID}`;
      await prisma.invite.create({ data: { code, email: "invited@example.test" } });

      const wrongPerson = await prisma.invite.updateMany({
        where: { code, usedAt: null, OR: [{ email: null }, { email: "someone-else@example.test" }] },
        data: { usedAt: new Date() },
      });
      expect(wrongPerson.count).toBe(0);

      const rightPerson = await prisma.invite.updateMany({
        where: { code, usedAt: null, OR: [{ email: null }, { email: "invited@example.test" }] },
        data: { usedAt: new Date() },
      });
      expect(rightPerson.count).toBe(1);

      await prisma.invite.deleteMany({ where: { code } });
    });
  });

  describe("account deletion", () => {
    it("cascades from User through TaxpayerProfile to its dependent rows", async () => {
      const { userId, profileId } = await createAccount({
        email: `iso-cascade-${RUN_ID}@example.test`,
        pan: "CCCPC3333C",
        name: "Cascade User",
      });
      await prisma.otherSourceIncome.create({
        data: { taxpayerProfileId: profileId, assessmentYear: "2026-27", sourceType: "SAVINGS_INTEREST", amount: 5000 },
      });

      await prisma.user.delete({ where: { id: userId } });

      expect(await prisma.taxpayerProfile.findUnique({ where: { id: profileId } })).toBeNull();
      expect(await prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId: profileId } })).toHaveLength(0);
    });
  });
});
