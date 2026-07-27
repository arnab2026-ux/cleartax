# Progress

Read this file first in every session. Update it last, every session — this is
the resumability mechanism across token limits and separate sessions. See the
approved plan at the top of the repo history / conversation for full context;
this file tracks living state only.

## Current status: Phase 1 (tax engine core) done, Phase 0 external setup pending

### Done
- Monorepo: npm workspaces (`packages/*`, `apps/*`), root `package.json` with
  `dev`/`build`/`lint`/`typecheck`/`test` scripts that fan out to workspaces.
- `apps/web`: Next.js 16.2.12 (App Router, TS strict, Tailwind, Turbopack) via
  `create-next-app`.
- Four placeholder packages scaffolded with working `typecheck`/`test` (Vitest)
  scripts, each with a trivial passing test: `@cleartax/tax-engine`,
  `@cleartax/itr-schema`, `@cleartax/filing-provider`, `@cleartax/pdf-form16`.
  Only `tax-engine` has a real dependent so far (itr-schema depends on it,
  filing-provider depends on itr-schema) — wire real code in per their phases.
- Auth: **not NextAuth** — deviated from the plan's suggested library.
  Auth.js (next-auth) v5 is still beta.32 with no stable release, so for a
  single-credential personal-use gate I built a minimal custom session
  instead: `lib/auth.ts` (scrypt password hash/verify, HS256 JWT session via
  `jose`), `lib/rateLimit.ts` (best-effort in-memory login throttle),
  `app/api/auth/login|logout/route.ts`, `app/login/page.tsx`,
  `scripts/hash-password.mjs` to generate `AUTH_PASSWORD_HASH`. Much smaller
  dependency surface for this use case; revisit only if multi-provider auth is
  ever needed (it shouldn't be, per the personal-use scope decision).
- `proxy.ts` (NOT `middleware.ts` — see Next 16 note below) gates every route
  except `/login` and `/api/auth/*`, redirecting unauthenticated browser
  requests to `/login` and returning 401 JSON for unauthenticated `/api/*`
  calls.
- Prisma 7.9.1 wired for Neon: `prisma.config.ts` (new in Prisma 7 — see note
  below) + placeholder `prisma/schema.prisma` (just an `AppMeta` singleton
  model to prove the toolchain works) + `lib/db.ts` using
  `@prisma/adapter-neon` / `@neondatabase/serverless` (with `ws` wired as the
  WebSocket constructor for Node runtimes).
- Security headers (HSTS, X-Frame-Options, nosniff, referrer-policy) added in
  `next.config.ts`. `turbopack.root` set explicitly to kill the multi-lockfile
  warning (there's exactly one lockfile now, at repo root).
- `.env.example` documents every env var needed through Phase 4
  (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_USER_EMAIL`, `AUTH_PASSWORD_HASH`,
  `FIELD_ENCRYPTION_KEY`, `BLOB_READ_WRITE_TOKEN`), validated at runtime via
  `lib/env.ts` (Zod).
- `.github/workflows/ci.yml`: lint, typecheck, test, build (all with dummy
  env vars), `npm audit --audit-level=critical` (non-blocking — see known
  issue below).
- Verified locally: `tsc --noEmit` clean, `eslint .` clean, `next build`
  succeeds (with dummy env vars), `prisma generate` succeeds.

### Not done yet in Phase 0 (deferred — needs the user's accounts)
- **Not pushed to GitHub / no remote configured.** CI workflow exists but
  hasn't run anywhere yet. User is setting up a GitHub repo + push access and
  a Neon project; wire these in once shared (see "Next steps").
- **Never run against a real Neon database.** `prisma migrate dev` has not
  been executed. The Neon adapter wiring in `lib/db.ts` is untested against a
  live connection.
- Phase 0 scaffold itself is committed (see git log) — only the external
  account wiring above remains.

## Phase 1 (tax engine core) — done

- `packages/tax-engine/src/ay2026-27/`: `slabs.ts`, `rebate.ts`,
  `surcharge.ts`, `cess.ts`, `rounding.ts` (Sections 288A/288B rounding),
  `computeTax.ts` (orchestrator: `computeTaxFromTaxableIncome(taxableIncome,
  regime, age)`), `income.ts` (Phase-1-only minimal salary + other-sources →
  taxable income aggregation — explicitly does not cover HRA/house
  property/capital gains/Chapter VI-A, by design, see file header).
- Covers both regimes for AY 2026-27: slabs, age-banded old-regime exemption
  limits (below60/senior/superSenior), Section 87A rebate with new-regime
  marginal relief at the ₹12L cliff (old regime confirmed to have a hard
  cliff at ₹5L, no marginal relief — that's correct current law, not a gap),
  surcharge at all four thresholds (₹50L/1Cr/2Cr/5Cr) with per-threshold
  marginal relief and the new-vs-old-regime cap divergence above ₹5Cr (new
  regime caps at 25%, old regime steps to 37%), flat 4% cess.
- Numeric constants are cited in-file with sources cross-checked against
  ClearTax, Tax2win, Axis Max Life, Policybazaar, Bajaj Finserv, TaxBuddy
  (2026-07-28) — see the header comments in `slabs.ts`, `rebate.ts`,
  `surcharge.ts` for the specific citations and the arithmetic verification
  of each rebate-cap-vs-threshold-tax match.
- 109 tests passing (`packages/tax-engine`: `rebate.test.ts` 21,
  `slabs.test.ts` 49, `surcharge.test.ts` 20, `computeTax.test.ts` 18, plus
  the original placeholder). Table-driven, boundary-value coverage at every
  slab edge, the 87A cliffs, and all four surcharge thresholds, across both
  regimes and all three old-regime age bands, plus end-to-end scenarios at
  ₹15L/₹60L/₹1.5Cr/₹6Cr gross.
- Full repo `typecheck`/`lint`/`test` verified green after this change.
- **Not yet done**: the adversarial second review pass the plan calls for
  specifically on this module (build agent + review agent, per plan) —
  do this before relying on the module further, ideally before Phase 2 stacks
  more logic on top of it.
- Root `README.md` now written (done, part of Phase 0 wrap-up).

### Known issues / deferred cleanup
- `npm audit` reports 12 high-severity advisories, all in **dev-only
  tooling** (eslint's transitive `minimatch`/`brace-expansion`,
  `postcss`/build-time). Fixing requires `--force` which bumps eslint to a
  breaking major version — deferred; not a runtime/production risk. Revisit
  when eslint 10 configs are worth migrating to.
- Login rate limiting (`lib/rateLimit.ts`) is in-memory only — resets per
  serverless cold start, so it's a deterrent, not a hard guarantee, on
  Vercel. The real gate is the scrypt-hashed password with timing-safe
  compare. If this ever matters more, move counters to Vercel KV.

## Critical environment notes for future sessions (don't relearn these)

- **This is Next.js 16, not the Next.js in your training data.** Two changes
  that will silently break things if you write "Next 14/15 style" code:
  1. `middleware.ts` is deprecated → use **`proxy.ts`** with an exported
     `proxy` function (same `NextRequest`/`NextResponse`/`config.matcher`
     API, just renamed). Already done at `apps/web/proxy.ts`.
  2. `cookies()`, `headers()`, `draftMode()`, and `params`/`searchParams` in
     pages/layouts/routes are **fully async now** (sync access was removed,
     not just deprecated) — always `await` them.
  3. `next lint` is removed; lint via the ESLint CLI directly (already set up
     as the `lint` script: `eslint`).
  - Full details: `apps/web/node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
    (also mirrored in `AGENTS.md`/`CLAUDE.md` in `apps/web/`, which
    `create-next-app` generated — read those docs before writing Next.js code
    if anything seems off vs. what you expect).
- **This is Prisma 7, not Prisma 5/6.** The datasource `url` no longer lives
  in `schema.prisma`. Instead:
  - `prisma.config.ts` at the app root (`apps/web/prisma.config.ts`) holds
    the connection URL for the CLI (`migrate`, `studio`, etc.), loaded via
    `dotenv/config`.
  - The generator is `provider = "prisma-client"` (not `"prisma-client-js"`)
    with an explicit `output` path — we generate to `apps/web/generated/prisma`
    (gitignored, regenerated via `postinstall: prisma generate`).
  - `PrismaClient` at runtime needs a driver **adapter**, not a bare
    connection string — we use `@prisma/adapter-neon`, constructed as
    `new PrismaNeon({ connectionString })` (takes a config object, not a
    `Pool` instance, in this version — check the installed version's
    `dist/index.d.ts` if this ever errors after a bump).
  - Import the generated client from `../generated/prisma/client`, not
    `@prisma/client`.
- Node 24 / npm 11 locally. CI pins Node 22 (still comfortably above Next
  16's Node 20.9+ minimum).

## Next steps (pick up here)

1. **Waiting on the user** for a GitHub repo (+ push access) and a Neon
   connection string. Once shared: push the repo, confirm CI goes green for
   real, run `npx prisma migrate dev` against the placeholder schema to prove
   the Neon adapter path works end-to-end, then remove the `AppMeta`
   placeholder model when Phase 4 lands the real schema. Not blocking further
   phases — all remaining phases through Phase 7 are pure code with no
   external account dependency.
2. Get an adversarial review pass on `packages/tax-engine` (build agent +
   review agent per the plan) before Phase 2 stacks more logic on it — the
   module hasn't had that second pass yet, only the build agent's own tests.
3. Start **Phase 2**: extend `packages/tax-engine` with HRA exemption
   (u/s 10(13A)), house property income (incl. home loan interest), capital
   gains classification (STCG/LTCG — verify current AY rates against the
   actual Finance Act, don't assume from memory, rates have changed in recent
   budgets), Chapter VI-A deductions (80C/80D/80CCD(1B)/80TTA/80TTB, regime-
   conditional), and `regimeCompare.ts`. Extend `income.ts`'s income
   aggregation without touching the Phase-1 slab/rebate/surcharge/cess
   primitives (they're intentionally decoupled — see `income.ts` header).

## Phase checklist (from the approved plan)

- [~] Phase 0 — Scaffold (core done; GitHub/Neon wiring pending user input)
- [x] Phase 1 — Tax engine core + tests (pending adversarial review pass)
- [ ] Phase 2 — Tax engine extended (HRA, house property, capital gains, deductions, regime compare)
- [ ] Phase 3 — Form 16 parsing pipeline
- [ ] Phase 4 — Data model + persistence
- [ ] Phase 5 — Wizard UI
- [ ] Phase 6 — ITR JSON export
- [ ] Phase 7 — Filing provider stub
- [ ] Phase 8 — Deploy to Vercel
- [ ] Phase 9 — End-to-end QA pass
