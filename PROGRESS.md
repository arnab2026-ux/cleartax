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

- `packages/tax-engine/src/types.ts`: shared types (`Regime`, `AgeCategory`,
  `SlabDefinition`/`SlabBreakdownEntry`, `RebateResult`, `SurchargeResult`,
  `CessResult`, `TaxComputationResult`).
- `packages/tax-engine/src/ay2026-27/`: `slabs.ts` (slab tables + age-aware
  old-regime exemption limits + `computeSlabTax`), `rebate.ts` (Section 87A
  + new-regime marginal relief), `surcharge.ts` (4 thresholds + per-threshold
  marginal relief, regime-aware cap), `cess.ts` (flat 4%), `rounding.ts`
  (shared paisa/percent helpers + Section 288A/288B nearest-₹10 rounding),
  `computeTax.ts` (orchestrator: `computeTaxFromTaxableIncome(taxableIncome,
  regime, age)`), `income.ts` (Phase-1-only minimal salary + other-sources →
  taxable income aggregation — explicitly does not cover HRA/house
  property/capital gains/Chapter VI-A, by design; see file header for the
  Phase 2 boundary).
- Covers both regimes for AY 2026-27 (FY 2025-26): slabs, age-banded
  old-regime exemption limits (below60/senior/superSenior — verified the 5%
  band's lower edge moves with the exemption limit, e.g. 3L not 2.5L for
  seniors, and disappears entirely for super seniors), Section 87A rebate
  with new-regime marginal relief at the ₹12L cliff (verified arithmetically
  in `rebate.test.ts` that the ₹60,000 cap exactly equals slab tax at
  ₹12,00,000 — no gap), old regime confirmed to have a **hard cliff** at ₹5L
  with **no marginal relief** (that's correct current law per Tax2win/
  ClearTax/TaxBuddy explainers, not a gap to patch — tested explicitly),
  surcharge at all four thresholds (₹50L/1Cr/2Cr/5Cr) with per-threshold
  marginal relief and the new-vs-old-regime cap divergence above ₹5Cr (new
  regime caps at 25% with no further step; old regime steps to 37% — the
  well-known bug-prone case, tested explicitly for both regimes at 5Cr and
  5Cr+1), flat 4% Health & Education Cess.
- Sources cross-checked (all fetched/searched 2026-07-28, at least two
  independent sources per load-bearing figure):
  - Slab tables (both regimes) + standard deduction amounts (₹75,000 new /
    ₹50,000 old — confirmed these differ, not assumed equal): ClearTax
    (cleartax.in/c/income-tax-slab-rates) and Axis Max Life
    (axismaxlife.com/blog/tax-savings/income-tax-slab-2025-26), corroborated
    by Bajaj Finserv via search summary.
  - Old-regime senior/super-senior exemption limits (₹3L / ₹5L): same two
    sources above, both agree.
  - Section 87A rebate amounts/thresholds (new: ₹60,000 cap / ₹12L; old:
    ₹12,500 cap / ₹5L) and the old-regime "no marginal relief" cliff:
    ClearTax, Axis Max Life, and a dedicated search corroborated by
    Tax2win/TaxBuddy/RightHorizons summaries ("There is no relief for
    taxpayers eligible for Section 87A rebate under the old regime").
  - Surcharge thresholds/rates and the new-vs-old 25%-cap-vs-37% divergence
    above ₹5Cr: ClearTax (cleartax.in/s/marginal-relief-surcharge) fetched
    directly, corroborated by a Policybazaar/Axis Max Life/Tax2win search
    summary using identical wording for the divergence.
  - Marginal relief *formula* (tax+surcharge on income just above a
    threshold must not exceed [tax+surcharge at the threshold] + [income
    above the threshold]): stated identically across ClearTax, Policybazaar,
    Axis Max Life, and Tax2win.
  - Section 288A/288B rounding-to-nearest-₹10 procedure and worked example
    (₹62,923.25 → ₹62,920): charteredclub.com, cross-checked against the
    statutory text summary on indiankanoon.org's mirror of Section 288B.
  - End-to-end sanity check: independently found a published claim that
    ₹15,00,000 salary under the new regime (FY 2025-26) owes exactly
    ₹97,500 total tax — matches this engine's hand-derived and
    code-computed result exactly (see `computeTax.test.ts`).
- **Flagged as NOT independently verified against a full third-party
  numeric worked example**: the specific rupee-by-rupee worked examples for
  surcharge marginal relief published on Tax2win/ClearTax/myITreturn/
  Policybazaar could not be fully cross-checked — several were paywalled
  (403 on WebFetch) and the ones that did load (e.g. a ClearTax ₹51L
  example) had internally inconsistent arithmetic in the fetched summary
  (their own "excess tax − excess income" line didn't reconcile with their
  stated final liability), so they were not used as ground truth. Instead,
  every surcharge/marginal-relief number in the test suite was **hand-derived
  from first principles** (slab tax → rebate → surcharge formula, done twice
  independently — once by hand, once by the implementation — and
  cross-checked for internal consistency: whenever relief applies,
  taxAfterRebate + surchargeAfterRelief must land exactly on
  taxAtThreshold×(1+prevRate) + incomeExcess). This is lower-confidence than
  the slab/rebate/cess figures, which have a clean external confirmation
  point (the ₹97,500 example above). **Recommend an adversarial review pass
  specifically re-derive 2-3 of the surcharge marginal-relief fixtures in
  `test/surcharge.test.ts` independently** before treating this module as
  fully verified.
- 116 tests passing in `packages/tax-engine` (`slabs.test.ts` 49,
  `rebate.test.ts` 21, `surcharge.test.ts` 20, `computeTax.test.ts` 18,
  `income.test.ts` 8). `placeholder.test.ts` and the trivial `TAX_ENGINE_
  PACKAGE`-only scaffold test were removed (superseded by real coverage);
  `TAX_ENGINE_PACKAGE` constant itself is kept in `index.ts` for now since
  other packages may rely on it existing. Table-driven, boundary-value
  coverage at every slab edge (±₹1 or the smallest meaningful increment),
  both 87A cliffs, and all four surcharge thresholds (±₹1) across both
  regimes and all three old-regime age bands, plus 8 end-to-end scenarios
  (₹15L/₹60L/₹1.5Cr/₹6Cr gross, split across both regimes and varied ages)
  exercising the full slabs→rebate→surcharge→cess→288B-rounding pipeline.
- Full repo `typecheck`, `lint` (`--workspaces --if-present`; tax-engine has
  no lint script, consistent with the other packages, so it's a no-op there
  — only `apps/web` actually lints), and `test` verified green after this
  change (ran from repo root).
- **Done**: the adversarial second review pass the plan calls for on this
  module has now been run — see "Phase 1 adversarial review" below. No bugs
  found; the surcharge marginal-relief fixtures were independently
  re-derived and confirmed, plus a real third-party worked example was found
  and matched exactly.

### Phase 1 adversarial review (2026-07-28)

An independent adversarial review pass was run against `packages/tax-engine`
(the build agent's own tests were not trusted; everything below was
re-derived from first principles before comparing to the existing code/tests).

- **Surcharge marginal relief (the item flagged as lowest-confidence)**: hand
  re-derived ~16 of the 20 fixtures in `test/surcharge.test.ts` from the
  statutory formula (`cap = taxAtThreshold*(1+prevRate) + incomeExcess`),
  spanning all four thresholds (₹50L/1Cr/2Cr/5Cr), both regimes, and all
  three old-regime age bands — **every one matched the existing fixture
  exactly**, including the subtle case the review specifically targeted:
  at the ₹1Cr and ₹2Cr thresholds, `prevRatePercent` in `surcharge.ts`
  correctly picks up the *previous band's* rate (10%/15%), not 0 — verified
  this isn't accidentally right by hand-computing what the wrong (prevRate=0)
  answer would have been and confirming the code does NOT produce that value.
- **Found and used a genuine third-party numeric worked example** (Zoho
  Payroll's tax guide — independent of every source already cited in
  `surcharge.ts`) for a new-regime taxpayer at ₹51,00,000: tax+surcharge
  before relief ₹12,21,000, relief ₹41,000, total incl. 4% cess ₹12,27,200.
  This engine reproduces all three figures exactly
  (`test/adversarial-review.test.ts`). This directly closes the gap PROGRESS.md
  previously flagged ("no third-party numeric worked example found for
  surcharge marginal relief") — one now exists and passes.
- Confirmed cess is correctly computed on tax-after-rebate +
  surcharge-*after*-relief (not before relief) — cross-checked against the
  Zoho example above and independent search results, which state explicitly
  that "marginal relief is only available on surcharge and not on cess."
- Re-verified slab boundary convention (income exactly at a slab/surcharge
  threshold falls in the cheaper/lower band) against fresh sources — matches
  standard practice and the ITR computation convention, consistent everywhere
  it's used (slabs.ts and surcharge.ts use the same `<=` convention).
- Re-verified numeric constants (new-regime slabs, ₹75,000/₹50,000 standard
  deductions, 87A rebate ₹60,000/₹12L and ₹12,500/₹5L, surcharge thresholds
  and the 25%-cap-vs-37% new-vs-old divergence above ₹5Cr) against fresh
  independent web searches, not just the citations already in the code —
  all confirmed.
- Checked age/regime branching, negative/zero income handling, and the
  `Math.max(0, ...)` clamps in `income.ts`/`slabs.ts`/`cess.ts` for
  silently-wrong-default risk. No bugs found; added
  `test/adversarial-review.test.ts` to pin the current (correct) behavior:
  zero/negative taxable income degrades to zero liability rather than
  crashing or going negative. **Flagged, not fixed** (legitimate design
  choice for Phase 1's scope, worth re-checking once Phase 2 adds income
  heads — like house property loss — where a negative component is
  legitimate and clamping to 0 at the wrong layer could silently swallow it):
  `income.ts`'s `Math.max(0, otherSourcesIncome)` clamp.
- **No bugs found or fixed** — no code changes to `src/`. Added 6 new tests
  in `test/adversarial-review.test.ts` (all passing); 122 tests total now
  pass (`npx vitest run`), `tsc --noEmit` clean.
- **Confidence assessment**: high, for the scope this module actually
  covers (salary + other-sources income, both regimes, AY 2026-27, no
  HRA/house property/capital gains/Chapter VI-A). The surcharge
  marginal-relief formula — the part explicitly flagged as needing this pass
  — is now independently confirmed against both hand-derivation and a real
  third-party published example, not just internal self-consistency.

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
2. ~~Get an adversarial review pass on `packages/tax-engine`~~ — done, see
   "Phase 1 adversarial review" above. No bugs found.
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
- [x] Phase 1 — Tax engine core + tests (adversarial review pass complete, no bugs found)
- [ ] Phase 2 — Tax engine extended (HRA, house property, capital gains, deductions, regime compare)
- [ ] Phase 3 — Form 16 parsing pipeline
- [ ] Phase 4 — Data model + persistence
- [ ] Phase 5 — Wizard UI
- [ ] Phase 6 — ITR JSON export
- [ ] Phase 7 — Filing provider stub
- [ ] Phase 8 — Deploy to Vercel
- [ ] Phase 9 — End-to-end QA pass
