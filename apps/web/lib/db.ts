import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "../generated/prisma/client";
import { getEnv } from "./env";
import { fieldEncryptionExtension } from "./prismaFieldEncryption";

// Node.js runtime (Vercel functions, local dev) doesn't have a native WebSocket
// implementation Neon's driver can rely on in every environment, so we wire the
// `ws` package explicitly. Harmless if a native implementation is also present.
neonConfig.webSocketConstructor = ws;

function createPrismaClient() {
  const adapter = new PrismaNeon({ connectionString: getEnv().DATABASE_URL });
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
