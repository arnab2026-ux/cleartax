import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getEnv } from "./env";
import { fieldEncryptionExtension } from "./prismaFieldEncryption";

function createPrismaClient() {
  // Standard node-postgres adapter (not Neon's serverless driver): the
  // database is Supabase Postgres, reached over its pooler on port 6543.
  // Supabase's transaction-mode pooler doesn't support prepared statements,
  // hence the connection string carries `pgbouncer=true` (see .env.example).
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  // Transparent AES-256-GCM encryption for TaxpayerProfile.pan/.aadhaar/
  // .bankAccountNumber — see lib/prismaFieldEncryption.ts. Applied here so
  // every caller of `prisma` (route handlers, seed script, etc.) gets it for
  // free rather than needing to remember to opt in per call site.
  return client.$extends(fieldEncryptionExtension);
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
