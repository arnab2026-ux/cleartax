/**
 * Loads `apps/web/.env.local` into process.env for the live-database
 * integration tests. Imported for its side effect at the top of
 * `liveDatabase.test.ts` and `tenantIsolation.test.ts`, before anything reads
 * DATABASE_URL / FIELD_ENCRYPTION_KEY / PAN_BLIND_INDEX_KEY.
 *
 * Deliberately does NOT overwrite variables already set in the environment,
 * so an explicit `DATABASE_URL=... npx vitest` still wins over the file.
 * Missing file is not an error — the integration suite skips itself when the
 * required vars aren't present.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local");

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    // `.trim()` matters on Windows: splitting on "\n" leaves a trailing "\r"
    // on a CRLF file, and the regex below is anchored with `$`, so a
    // perfectly valid line would silently fail to match and the variable
    // would read as unset. That is a confusing failure — the value is plainly
    // there in the file — so normalise rather than assume LF endings.
    const line = rawLine.trim();
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value && process.env[key!] === undefined) {
      process.env[key!] = value;
    }
  }
}
