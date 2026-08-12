#!/usr/bin/env node
/**
 * Mints an invite code. Registration is closed (see
 * app/api/auth/register/route.ts), so this is the only way an account can be
 * created.
 *
 *   node apps/web/scripts/create-invite.mjs
 *   node apps/web/scripts/create-invite.mjs --email priya@example.com --note "Bangalore group"
 *
 * Passing --email BINDS the code to that address, so it cannot be redeemed by
 * anyone else even if the code leaks in transit. Prefer it whenever you know
 * who you are inviting; it is the difference between a bearer token and a
 * named one.
 *
 * Requires DATABASE_URL. Reads apps/web/.env.local automatically.
 *
 * Uses `pg` directly rather than the Prisma client, deliberately. `lib/db.ts`
 * imports the generated client as a directory specifier
 * ("../generated/prisma/client"), which Node's ESM resolver cannot resolve
 * from a plain .mjs script — only the bundler and Vitest can. Since `Invite`
 * holds no encrypted columns, it needs none of the Prisma field-encryption
 * extension, so a parameterised INSERT is both sufficient and free of that
 * whole resolution problem.
 */
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Same approach as test/integration/loadEnv: prisma.config.ts loads `.env`,
// but this project keeps its secrets in `.env.local`.
try {
  const envLocal = readFileSync(join(here, "..", ".env.local"), "utf8");
  for (const line of envLocal.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env.local — fall back to whatever is already in the environment.
}

function parseArgs(argv) {
  const args = { email: null, note: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--email") args.email = argv[i + 1] ?? null;
    if (argv[i] === "--note") args.note = argv[i + 1] ?? null;
  }
  return args;
}

/**
 * 32 bytes of CSPRNG entropy, base64url. Deliberately not a short
 * human-friendly code: this is the only thing standing between a stranger and
 * an account holding someone's PAN and bank details, so it must not be
 * guessable, and it is copy-pasted rather than typed.
 */
function generateCode() {
  return randomBytes(32).toString("base64url");
}

async function main() {
  const { email, note } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (checked the environment and apps/web/.env.local).");
    process.exit(1);
  }

  const code = generateCode();
  // Lowercased to match how User.email and the registration schema
  // canonicalise it — otherwise a binding on "Priya@x.com" would never match
  // the "priya@x.com" that actually reaches the route.
  const boundEmail = email ? email.trim().toLowerCase() : null;

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO "Invite" (id, code, email, note, "createdAt") VALUES ($1, $2, $3, $4, now())',
      [randomUUID(), code, boundEmail, note],
    );
  } finally {
    await client.end();
  }

  console.log("\nInvite created.\n");
  console.log(`  Code:  ${code}`);
  console.log(`  Email: ${boundEmail ?? "(any address)"}`);
  if (note) console.log(`  Note:  ${note}`);
  console.log("\nSend the code to the invitee. It can be redeemed exactly once.\n");
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
