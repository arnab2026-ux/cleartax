# Personal ITR Assistant

A personal-use, ClearTax-like income tax computation and filing-prep
assistant for India (AY 2026-27). Enter basic info, upload Form 16, get an
accurate old-vs-new-regime tax computation, and export the official ITR JSON
to file yourself on the government's e-filing portal.

**This app never submits returns to the government on your behalf.** The
Income Tax Department's e-filing API is only available to registered ERI/GSP
partners; this app instead produces the same JSON format the government's own
offline utility does, for you to upload and e-verify yourself. See
`packages/filing-provider` for the (mock-only) submission interface.

## Structure

- `packages/tax-engine` — pure tax computation logic (old/new regime, slabs,
  rebate, surcharge, cess, HRA, capital gains). No framework dependencies.
- `packages/itr-schema` — maps computed data to the official ITR-1/ITR-2 JSON
  schema, versioned per assessment year.
- `packages/filing-provider` — pluggable filing interface; only a mock
  implementation exists.
- `packages/pdf-form16` — Form 16 PDF decrypt/parse pipeline.
- `apps/web` — the Next.js app (wizard UI, API routes, Prisma schema, auth).

See [`PROGRESS.md`](./PROGRESS.md) for current build status and next steps —
read it before starting work in a new session.

## Development

```bash
npm install
cp apps/web/.env.example apps/web/.env   # fill in real values
node apps/web/scripts/hash-password.mjs "your-password"  # -> AUTH_PASSWORD_HASH
npm run dev     # starts apps/web on localhost:3000
npm run lint
npm run typecheck
npm run test
```

Requires Node 20.9+ (developed on Node 24). Requires a Postgres database
(Neon recommended — `DATABASE_URL` in `.env`) for anything touching `lib/db.ts`.
