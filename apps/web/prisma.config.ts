import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Node 24's native TypeScript support runs prisma/seed.ts directly —
    // no tsx/ts-node needed (see prisma/seed.ts's file header for why tsx
    // is deliberately avoided in this repo).
    seed: "node prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
