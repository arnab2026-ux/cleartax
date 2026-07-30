# Progress

Read this file first in every session. Update it last, every session — this is
the resumability mechanism across token limits and separate sessions. See the
approved plan at the top of the repo history / conversation for full context;
this file tracks living state only.

## Current status: Phase 6 (ITR JSON export) done, adversarial review done (2026-07-30) — see "Phase 6 (ITR JSON export)" and "Phase 6 adversarial review" sections below. Three real bugs found and fixed, including the Section 115BB lottery-taxation gap flagged at the end of the build pass (this required — and got — a sanctioned, surgical fix inside `packages/tax-engine`). Still untested against a live DB (same blocker as every DB-touching phase since Phase 0); Phase 0 external setup pending

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
- **Turbopack (`next build`) does NOT resolve `./foo.js` relative imports to
  `./foo.ts` source files for workspace packages consumed directly from
  `packages/*` (no build step).** `tsc --noEmit` and Vitest both handle this
  fine (that's the whole point of TS's `"moduleResolution": "bundler"`
  convention our `tsconfig.base.json` uses), so this only surfaces the first
  time a `packages/*` package is actually imported into `apps/web` — it'll
  typecheck and test clean, then fail `next build` with "Module not found:
  Can't resolve './foo.js'". `transpilePackages` in `next.config.ts` does
  **not** fix this on its own (tried it, still failed). The actual fix: don't
  use `.js` suffixes on relative imports within these packages at all — bare
  extensionless specifiers (`from "./types"`, not `from "./types.js"`) work
  everywhere (tsc, Vitest, and Turpoback). Already fixed across
  `packages/pdf-form16` and `packages/tax-engine` (Phase 3). **`packages/itr-
  schema` and `packages/filing-provider` don't have internal relative imports
  yet** (still placeholder-only) — if you add real code with relative imports
  to either before they're wired into `apps/web`, use extensionless imports
  from the start rather than reintroducing this.

## Phase 2 (tax engine extended) — done

Everything additive, in `packages/tax-engine/src/ay2026-27/`. Phase 1's
`slabs.ts`/`rebate.ts`/`surcharge.ts`/`cess.ts`/`computeTax.ts`/`income.ts`
were NOT modified (only `types.ts`-level... actually not even that — no
Phase 1 file changed at all; `index.ts` only gained new exports).

- **`hra.ts`** — Section 10(13A) HRA exemption (old regime only; new regime
  forced to 0 via `getHraExemptionForRegime`, the regime-aware entry point
  the aggregation layer actually calls). Formula: min(actual HRA, rent paid
  − 10% of basic salary, 50%/40% of basic salary for metro/non-metro).
- **`houseProperty.ts`** — self-occupied (NAV nil, interest deduction capped
  ₹2,00,000 old regime / disallowed entirely new regime) and let-out
  (NAV = rent − municipal taxes, less 30% standard deduction, less
  home-loan interest UNCAPPED in both regimes) property income, with
  Section 71(3A) loss set-off against other heads: capped ₹2,00,000/year old
  regime, **₹0 (fully disallowed) new regime** — intra-head netting across
  multiple properties still allowed in both regimes; excess loss reported as
  carried-forward but not applied to the current year.
- **`capitalGains.ts`** — the highest-risk module (see "Capital gains
  sources" below). Two-tier holding-period classification (12 months listed
  equity/equity MF, 24 months everything else, debt/specified mutual funds
  always short-term per Section 50AA regardless of holding period); STCG-
  equity flat 20% (Section 111A); LTCG-equity flat 12.5% on gains over a
  ₹1,25,000/year exemption (Section 112A); LTCG-other flat 12.5% no
  indexation by default (Section 112), with the transitional
  20%-with-indexation option for immovable property acquired before
  23-Jul-2024 (lower-of-the-two, only when the caller supplies an indexed
  gain figure); STCG-other (incl. all debt-fund gains) folded into slab-rate
  income rather than taxed here. Deliberately does NOT model inter-bucket
  capital-loss set-off (Section 70/74 ordering) — each bucket nets and
  floors independently; flagged as a conservative simplification, see
  "Uncertain / flagged for review" below.
- **`deductions.ts`** — 80C (₹1,50,000 cap), 80D (₹25,000/₹50,000 self+family
  and parents caps, senior-citizen-aware, preventive-checkup ₹5,000
  sub-limit), 80CCD(1B) (₹50,000, additional NPS), 80CCD(2) (employer NPS —
  the one section that survives BOTH regimes: 14% of salary new regime for
  everyone, old regime still splits 14% government / 10% private), 80TTA
  (₹10,000, below 60) / 80TTB (₹50,000, 60+, mutually exclusive with 80TTA).
  All sections except 80CCD(2) forced to 0 under the new regime by
  `computeChapterVIA` itself — callers never need to special-case the
  regime.
- **`fullIncome.ts`** — aggregation layer: salary (+HRA exemption, regime-
  aware) + house property (regime-aware) + capital gains' slab-rate STCG
  bucket + other-sources − Chapter VI-A deductions → `slabTaxableIncome`
  (Section 288A-rounded, feeds directly into the untouched
  `computeTaxFromTaxableIncome`), plus `totalIncome` (slabTaxableIncome +
  special-rate capital-gains taxable income) for rebate-threshold and
  surcharge-band purposes.
- **`computeTaxFull.ts`** — new orchestrator (does NOT modify
  `computeTax.ts`) combining slab tax with capital-gains tax: rebate
  eligibility/threshold uses total income but the rebate amount only ever
  offsets slab tax (capital-gains tax under 111A/112/112A is never
  rebatable — verified explicitly for FY 2025-26, see below); surcharge band
  is selected using total income (reusing the exact Phase 1 marginal-relief
  formula for the slab-tax portion), while capital-gains-attributable
  surcharge is capped at 15% regardless of the ordinary band (verified —
  this is the specific "common source of errors" the Phase 2 brief flagged,
  and it's now implemented and tested, see `computeTaxFull.test.ts`'s
  ₹2.5Cr-LTCG-equity scenario: 25% ordinary band but 15%-capped CG
  surcharge). Cess 4% flat on the combined total, Section 288B rounding at
  the end — both reused unchanged from Phase 1.
- **`regimeCompare.ts`** — `compareRegimes(profile, age)` runs
  `computeFullTaxLiability` under both regimes on one input profile
  (regime-inapplicable fields like HRA/Chapter VI-A are auto-zeroed per
  regime by the lower layers) and recommends the lower
  `totalTaxLiabilityRounded`; ties break toward old (documented, arbitrary).
- 76 new tests across 7 new files (`hra.test.ts` 8, `houseProperty.test.ts`
  12, `capitalGains.test.ts` 20, `deductions.test.ts` 19, `fullIncome.test.ts`
  6, `computeTaxFull.test.ts` 8, `regimeCompare.test.ts` 3), table-driven with
  boundary-value cases (80C cap edge, HRA metro/non-metro, LTCG-equity
  ₹1,25,000 exemption boundary at ±₹1, 12/24-month holding-period boundaries,
  self-occupied interest cap boundary) plus several full end-to-end
  `regimeCompare`/`computeFullTaxLiability` scenarios that were hand-derived
  independently (slab tax → rebate → surcharge → cess, by hand on paper)
  BEFORE running, then checked against the code — every hand-derived figure
  matched the implementation's output exactly on the first test run (no
  fixture was adjusted to match unexpected code output). **122 Phase 1 tests
  pass completely unmodified** — confirms the "additive only" scope
  discipline held. 198 tests total in `packages/tax-engine`.
- Full repo `typecheck`, `lint` (tax-engine still has no lint script — only
  `apps/web` lints, as in Phase 1), and `test` all verified green from repo
  root after this change.

### Capital gains sources (the highest-risk module — verified 2026-07-28, NOT from training-data recollection)

- **Holding-period thresholds** (12 months listed equity/equity MF, 24
  months everything else, post-23-Jul-2024 Budget 2024 simplification):
  taxgarden.in, patronaccounting.com, carajput.com (search summaries,
  cross-corroborated).
- **Debt/"specified" mutual funds always short-term (Section 50AA),
  regardless of holding period**, effective definition (>65% debt/money-
  market proceeds) for FY 2025-26: cleartax.in Section 50AA explainer,
  finnovate.in "Mutual Fund Taxation India FY 2025-26" — explicitly
  confirmed the >65% threshold and the "no indexation, slab rate" treatment
  are unchanged for FY 2025-26.
- **STCG-equity 20% (Section 111A) / LTCG-equity 12.5% + ₹1,25,000
  exemption (Section 112A)**, effective 23-Jul-2024 (Budget 2024), unchanged
  for FY 2025-26: venturasecurities.com, bajajfinserv.in, taxgarden.in,
  anptaxcorp.com, business-standard.com ("Budget 2024 hikes LTCG tax rate to
  12.5%, STCG to 20%"), PIB press release on the CBDT FAQs
  (pib.gov.in/PressReleasePage.aspx?PRID=2036604) — explicitly confirmed
  "Budget 2025 made no changes to the LTCG tax rate... for FY 2025-26"
  (anptaxcorp.com search summary).
- **Indexation removed for LTCG generally, 12.5% flat rate (Section 112)**,
  effective 23-Jul-2024: business-standard.com, moneylife.in.
- **Transitional grandfathering option for immovable property acquired
  before 23-Jul-2024** (lower of 12.5% no-indexation vs. 20%-with-
  indexation): moneylife.in, ascgroup.in ("New Grandfathering Rule in
  Capital Gain Tax") — all three sources agree on the shape of the rule
  (pre-23-Jul-2024 acquisition only, resident individual/HUF, immovable
  property only, taxpayer pays the lower of the two). Implemented exactly
  as described; no other asset class gets this option per any source found.
- **Surcharge on Sections 111A/112/112A tax capped at 15%**, regardless of
  the taxpayer's total-income surcharge band: ebizfiling.com, a dedicated
  search summary citing casahuja.com's "LTCG under Section 112A after
  Finance Act 2025" post and a worked ₹5.5 crore mixed-income example
  (non-CG income ₹3 crore → 25% band, but CG-attributable surcharge capped
  at 15% "irrespective of the level of capital gains income"). This is the
  specific interaction the Phase 2 brief flagged as a common source of
  errors — implemented in `computeTaxFull.ts` and tested explicitly.
- **Section 87A rebate excludes tax under 111A/112/112A entirely for FY
  2025-26 onward**: verified via a dedicated search into the AY 2024-25
  CPC-vs-ITAT controversy (taxpayers won that round for AY 2024-25 on a
  "Parliament didn't explicitly exclude 111A" argument) and its FY 2025-26
  legislative closure — the law was explicitly amended so the gap ITAT
  exploited for AY 2024-25 no longer exists for FY 2025-26 (AY 2026-27, this
  package's target year). Sources: counselvise.com, taxtmi.com,
  arvindtuliclasses.com, taxheal.com, a2ztaxcorp.net (two separate posts,
  one specifically dated for "FY 2025-26" MF investors).

### HRA metro-city source (verified 2026-07-28, and explicitly NOT the training-data-plausible answer)

The obvious modern answer ("8 metro cities including Bengaluru/Hyderabad/
Pune/Ahmedabad") is WRONG for this AY. Multiple SEO/content-mill-flavored
sources confidently claimed the 8-city list applies "for FY 2025-26" — this
was cross-checked further and found to be describing a real but NOT-YET-
EFFECTIVE change: the Income-tax Rules, 2026 (notified under the new
Income-tax Act, 2025) add those four cities, but only **effective 1 April
2026** (FY 2026-27 / AY 2027-28 — the filing year AFTER this one). Verified
via a targeted follow-up search: "the return due July 31, 2026 covers FY
2025-26 — still the old Act. That filing gets 40%" (myfinancial.in,
corroborated by taxupdate.in and ascent-hr.com's "Income Tax Rules 2026
Complete Analysis" PDF). This package implements the ORIGINAL 4-city list
(Delhi/Mumbai/Kolkata/Chennai) for AY 2026-27, which is correct for this
package's stated scope — flagged here specifically because a less careful
pass could easily have shipped the wrong (future) list by trusting the
first few search results at face value.

### Other Phase 2 numeric constants and their sources (verified 2026-07-28)

- Self-occupied home loan interest: ₹2,00,000 cap old regime, fully
  disallowed new regime: 1finance.co.in, kmgcollp.com, kotaklife.com,
  callmyca.com (all agree; kmgcollp.com's phrasing — "if the assessee opts
  for taxation under Section 115BAC, deduction under Section 24(b) shall
  not be allowed for self-occupied property" — was the most explicit).
- Let-out property interest uncapped in BOTH regimes (restriction is
  self-occupied-only): same sources as above.
- House-property loss set-off cap ₹2,00,000/year old regime, ₹0 new regime
  (Section 71(3A)): taxbuddy.com, patronaccounting.com, hinote.in, the
  statutory text of Section 71 itself (incometaxindia.gov.in).
- 80D caps (₹25,000/₹50,000 self+family and parents, senior-aware, ₹5,000
  preventive-checkup sub-limit): finnovate.in (two separate posts),
  taxclue.in, toolisky.com.
- 80CCD(2) 14%-for-everyone under the new regime (unified FY 2025-26,
  private sector previously capped at 10% even under the new regime pre-FY
  2025-26) vs. old regime's persisting 14%-government/10%-private split:
  calcguru.in (two posts), arthaengine.com, taxbuddy.com "80CCD Deduction
  Limit Under the New Tax Regime FY 2025-26".
- 80CCD(1B) ₹50,000 cap, old-regime-only, additive to the 80C cap:
  1finance.co.in, taxgarden.in, oquilia.com, disytax.com.
- 80TTA ₹10,000 (below 60) / 80TTB ₹50,000 (60+), old-regime-only, mutually
  exclusive: paytm.com, taxbuddy.com, cleartax.in Section 80TTB explainer,
  taxgarden.in.
- Which Chapter VI-A sections survive the new regime (80CCD(2), 80CCH
  Agniveer — not modeled — and nothing else from the common personal-use
  set): taxbuddy.com "Deductions Allowed in New Tax Regime", cleartax.in
  Section 115BAC explainer, kotaklife.com, kmgcollp.com.

### Uncertain / flagged for review (do not treat these as fully verified)

1. **Marginal relief for the combined slab+capital-gains surcharge case is
   a documented simplification, not a literal replication of the
   department's Schedule-SI computation.** The slab-tax portion reuses the
   exact, already-adversarially-reviewed Phase 1 marginal-relief formula
   (with total income used correctly for band selection); the
   capital-gains-attributable surcharge (capped at 15%) has NO
   marginal-relief smoothing applied to it in this implementation. A
   taxpayer whose total income crosses a surcharge threshold primarily
   because of capital gains (rather than ordinary income) could see a
   surcharge step that real marginal-relief provisions might partially
   smooth in ways this module doesn't replicate. Flagged explicitly in
   `computeTaxFull.ts`'s file header. Recommend a follow-up pass that either
   finds a published worked example of this exact scenario (mixed slab +
   capital-gains income crossing a surcharge threshold) to check against,
   or explicitly scopes this as an accepted limitation.
2. **Inter-bucket capital-loss set-off (Section 70/74) is not modeled.**
   `capitalGains.ts` nets gains/losses only within each bucket (same asset
   class + same short/long classification) and floors each bucket at 0 for
   tax purposes independently. A taxpayer with, say, a short-term equity
   loss and a long-term property gain in the same year would, in reality,
   likely be able to set the loss off against the gain (STCG losses can
   offset both STCG and LTCG); this module would currently tax the gain in
   full and separately report 0 tax on the loss bucket, overstating
   liability. Conservative direction (never understates tax), but flagged
   as a real gap versus correct law — worth fixing before this becomes
   user-facing if loss-harvesting scenarios are expected to be common.
3. **Self-occupied home loan interest's lower ₹30,000 cap (for loans not
   used for acquisition/construction, or where construction wasn't
   completed within 5 years) is not modeled** — `houseProperty.ts` always
   applies the full ₹2,00,000 cap for self-occupied property under the old
   regime. Documented explicitly in the file header as a known
   simplification; flagged here too since it's a real (if less common)
   scenario.
4. **HRA's `basicSalary` input doesn't separately model DA-forming-part-of-
   retirement-benefits** — the module takes one "basicSalary" figure at face
   value per the Phase 2 scope brief's instruction not to over-engineer;
   flagged in case a future session needs the DA nuance for accuracy against
   a specific payslip structure.
5. Everything in "Not modeled" sections of each new file's header comment
   (80E/80EE/80EEA/80G/80GG/80CCH/80U/80DD deductions, deemed-let-out
   second self-occupied property, GAV-vs-actual-rent for vacant/under-rented
   let-out property, capital-loss carry-forward across years) is a
   deliberate Phase 2 scope boundary, not an oversight — listed for
   completeness, not urgency.

### Phase 2 adversarial review (2026-07-28)

An independent adversarial review pass was run against the Phase 2 additions
(`hra.ts`, `houseProperty.ts`, `capitalGains.ts`, `deductions.ts`,
`fullIncome.ts`, `computeTaxFull.ts`, `regimeCompare.ts`). Started from the
198-tests-green baseline (confirmed via `npx vitest run` before touching
anything); 208 tests pass now. The build agent's own citations were treated
as a starting point, not ground truth — every Priority-1 figure below was
re-verified with fresh, independently-chosen search queries.

**One real bug found and fixed** (see "Bug fixed" below). Everything else
checked out, with one genuinely unsettled point of law flagged (not a code
bug — see "87A threshold ambiguity" below) and the four originally-flagged
simplifications reassessed on their own severity rather than just repeating
the build agent's framing.

#### Independently re-verified capital-gains figures (fresh searches, 2026-07-28)

All confirmed correct, using different queries/sources than the ones already
cited in `capitalGains.ts`:
- **STCG-equity 20% (111A) / LTCG-equity 12.5% + ₹1,25,000 exemption (112A)**,
  unchanged for FY 2025-26: manipalcigna.com, venturasecurities.com,
  bajajfinserv.in, taxbuddy.com, business-standard.com — all corroborate,
  explicitly noting Budget 2025 made no change.
- **12-month (equity) / 24-month (everything else) holding-period split**,
  post-Budget-2024 simplification, unchanged for FY 2025-26: taxgyany.com,
  anptaxcorp.com, indiatax.ai, plannprogress.com.
- **Debt/specified mutual funds always short-term (Section 50AA)**,
  regardless of holding period, for FY 2025-26 (the >65% debt/money-market
  threshold): cleartax.in, taxtmi.com (two separate posts), hdfclife.com.
- **LTCG-other 12.5% flat, no indexation, with the pre-23-Jul-2024 immovable
  property grandfathering option (lower of 12.5% no-indexation vs. 20%
  with-indexation)**: outlookmoney.com, bajajfinserv.in, arthgyaan.com,
  business-standard.com — all agree on the shape and the "lower of the two"
  mechanic; outlookmoney.com additionally confirms FY 2025-26's CBDT cost
  inflation index (363) is still being published, i.e. the indexation
  machinery is actively in use for this option, not vestigial.
- **Surcharge on 111A/112/112A tax capped at 15%, regardless of the
  taxpayer's ordinary surcharge band**: a dedicated fresh search surfaced
  casahuja.com's "LTCG under Section 112A after Finance Act 2025" post
  (dated for AY 2026-27 specifically) stating this explicitly, corroborated
  by ebizfiling.com and a Taxsutra article — three independent sources, none
  of which were the exact ones cited in the original code comments.
- **Section 87A rebate cannot offset 111A/112/112A tax, for FY 2025-26
  onward**: confirmed via jmfinancialservices.in, a2ztaxcorp.net, and
  firstreports.in's worked example (₹9L salary + ₹2L STCG-111A, total income
  ₹11L — under the 12L threshold — still owes the full ₹40,000 STCG tax
  un-rebated). Matches the code's behavior exactly.

**No numeric constant in `capitalGains.ts` needed correction.** The rates,
thresholds, holding periods, and the 15% surcharge cap were all confirmed
independently.

#### 87A ₹12,00,000 threshold: inclusive or exclusive of capital gains? (genuine unsettled point of law, flagged not fixed)

While verifying the rebate/CG interaction, a real disagreement surfaced
across sources on ONE specific sub-question: when checking whether total
income is within ₹12,00,000 for Section 87A eligibility, does that ₹12L
figure INCLUDE special-rate capital gains (111A/112A), or is it computed on
normal (slab-rate) income only?
- Some sources (tax2win.in, caclubindia.com summaries) say the threshold
  check EXCLUDES special-rate income.
- Other sources (jmfinancialservices.in, and most importantly
  taxguru.in's "Section 87A Controversy Continues Even After Budget 2025",
  which quotes the actual amended statutory language — "the deduction...
  shall not exceed the amount of income-tax payable as per the rates
  provided in sub-section (1A) of section 115BAC") say the threshold
  INCLUDES capital gains for eligibility, but the rebate AMOUNT is capped at
  tax on normal-rate income only. taxguru.in explicitly states: **"even
  after the 2025 Budget, the confusion remains. Despite inquiries to Big 4
  firms and government authorities, there is still no clear or uniform
  response."**
- This package's implementation (`computeTaxFull.ts`) uses
  `income.totalIncome` (slab + CG) for the ₹12L eligibility/threshold check,
  matching the interpretation backed by the source that quotes the actual
  amended statute text — the strongest evidence available, but not a
  unanimous one. **Flagged as a genuinely unsettled area of law, not a bug**:
  do not "fix" this to the exclusive interpretation without a firmer source
  (e.g. a CBDT circular or ITR-utility source-code observation) — either
  reading is defensible today, and it's better to be explicit about the
  ambiguity than to silently pick a side. If this app ever needs to state a
  number with confidence for a taxpayer near the ₹12L line with capital
  gains present, this is the place to revisit first.

#### Bug found and fixed: grandfathered-property indexed gain leaked the wrong amount into "total income"

**`capitalGains.ts`, `computeLtcgOtherTransactionTax`**: when the
pre-23-Jul-2024 property indexation option was used (because 20%-with-
indexation produced less tax than 12.5%-no-indexation), the function
correctly taxed the smaller *indexed* gain, but the caller
(`computeCapitalGains`) was still accumulating the RAW (pre-indexation, and
therefore larger) `gainAmount` into `ltcgOtherTaxableGainEquivalent`. That
figure feeds `totalSpecialRateTaxableIncome`, which feeds `totalIncome` in
`fullIncome.ts`, which is what `computeTaxFull.ts` uses for the Section 87A
₹12L eligibility check AND surcharge-band selection. Net effect: whenever a
taxpayer benefited from the indexation option, their reported "total income"
was inflated by exactly the indexation benefit (raw gain − indexed gain) —
large enough in realistic property-sale scenarios to wrongly deny an
otherwise-eligible 87A rebate on their slab income, or push them into a
higher surcharge band than their real taxable income supports. Both failure
directions overstate tax, consistent with the module's general
"conservative" bias, but it's a real correctness bug, not a documented
simplification — nobody flagged it going in.

**Fixed**: `computeLtcgOtherTransactionTax` now returns a `taxableGainUsed`
field (the indexed gain when that method wins, the raw gain otherwise) and
`computeCapitalGains` accumulates that instead of always using the raw gain.
Regression tests added in `test/adversarial-review-phase2.test.ts`,
including an end-to-end `computeFullTaxLiability` case showing the bug used
to flip 87A rebate eligibility for a mixed slab+property-sale taxpayer at
exactly the ₹12L line (correct total income ₹11,00,000, eligible; the
pre-fix code would have computed ₹13,00,000, incorrectly denying the
rebate). No existing test exercised this path (the existing indexation tests
in `capitalGains.test.ts` only checked `ltcgOtherTax`, never
`ltcgOtherTaxableGainEquivalent`), so it shipped unnoticed in Phase 2 and all
198 original tests still pass unmodified after the fix.

#### Assessment of the four originally-flagged simplifications

1. **No marginal-relief smoothing on the combined slab+capital-gains
   surcharge case.** Confirmed via fresh search
   (jmfinancialservices.in/similar summaries): "marginal relief provisions
   may apply to normal income, but this relief does not extend to
   special-rate capital gains" — i.e. the code's behavior (no relief
   smoothing on the CG-attributable surcharge step) is directionally
   consistent with how practitioners describe the real rule, not an
   arbitrary omission. Constructed several boundary scenarios (see new tests)
   and found the results plausible, not obviously broken — e.g. a taxpayer
   crossing ₹12L total income by ₹1 via capital gains sees slab tax capped
   at ₹1 (correct marginal-relief shape) while CG tax is charged in full
   (also correct — CG tax was never eligible for relief). **Assessment:
   Medium priority, correctly disclosed.** This is a real gap versus the
   department's literal Schedule-SI computation, but it affects a narrower
   population (taxpayers whose total income crosses a surcharge threshold
   specifically because of capital gains) and the disclosed approximation
   doesn't produce implausible numbers in the scenarios tested. Worth a
   follow-up only if/when a real published worked example of this exact
   combination surfaces to check against.
2. **Inter-bucket capital-loss set-off not modeled.** Actively tried to
   construct a counterexample where independent-bucket flooring would
   UNDERSTATE tax (the build agent's claim was "conservative, never
   understates") — could not find one. Tried: STCG-equity loss vs. LTCG-other
   gain (code overstates: ₹62,500 vs. correctly-netted ₹25,000 — see
   `test/adversarial-review-phase2.test.ts`), STCG-other loss vs. LTCG-equity
   gain (code overstates similarly), and the one case where the LAW ITSELF
   restricts set-off the same way the code does (LTCG loss cannot offset an
   STCG gain, Section 70(3)) — there the code's independent-bucket behavior
   exactly matches correct law, no discrepancy either direction. The
   mathematical reason the claim holds: cross-bucket netting can only ever
   subtract a loss from a gain that would otherwise be taxed in full: it
   never manufactures additional gain, so omitting it can only leave tax
   equal or higher, never lower. **Assessment: confirmed conservative as
   claimed; genuine gap for loss-harvesting-heavy taxpayers but safe
   direction for a filing tool. Lower priority than #3 below** precisely
   because it can't cause an underpayment.
3. **Self-occupied home loan interest always uses the ₹2,00,000 cap, never
   the ₹30,000 cap for incomplete/renovation-purpose loans.** Re-assessed
   priority upward versus the build agent's framing: unlike #2, this
   simplification can UNDERSTATE tax — a taxpayer whose loan actually
   qualifies only for the ₹30,000 cap (renovation loan, or construction not
   completed within 5 years) would have this module claim up to ₹1,70,000 of
   deduction they're not entitled to, understating their taxable income and
   therefore their tax liability. For a personal tax-filing assistant with
   real legal stakes, silently understating liability is the more dangerous
   failure mode than the conservative overstatement in #2. **Assessment:
   higher priority than the original framing suggested** — not fixed in this
   pass (would need a new input field capturing loan purpose /
   construction-completion timing, which is a scope expansion the Phase 2
   brief explicitly deferred, not a small surgical fix), but flagged more
   strongly here with a quantified test
   (`test/adversarial-review-phase2.test.ts`) showing the magnitude. Should
   be prioritized before this module is trusted for a user with a home loan
   whose purpose isn't "acquisition/construction completed within 5 years."
4. **HRA's `basicSalary` doesn't separately model DA-forming-part-of-
   retirement-benefits.** Confirmed this is a minor, narrow-population gap
   (mainly relevant to government/PSU pensionable employees with a DA
   component) rather than a common case for this app's likely user base.
   **Assessment: low priority, agree with the original framing** — the
   module takes one caller-supplied `basicSalary` figure at face value, and
   as long as the UI instructs users to include DA-if-applicable in that
   figure, this is a documentation/UX concern for Phase 5, not an engine bug.

#### General adversarial code review — no additional bugs found

- **Regime-conditional zeroing, traced end-to-end** (not just unit-level):
  added `test/adversarial-review-phase2.test.ts`'s
  "Regime-zeroing wiring" test, which builds one profile with every
  old-regime-only input populated (HRA, self-occupied interest, house-
  property inter-head loss set-off, 80C/80D/80CCD1B/80TTA/80TTB) and asserts
  every one is exactly 0 when routed through `computeFullTaxLiability(...,
  "new", ...)`, while confirming 80CCD(2) and let-out-property interest
  correctly survive. All zeroed correctly — the regime-awareness is
  consistently pushed down to the individual modules and nothing leaks
  through `fullIncome.ts`/`regimeCompare.ts`'s wiring.
- **`computeTaxFull.ts`'s slab-vs-special-rate separation**: traced every
  downstream use of `income.totalIncome` vs. `income.slabTaxableIncome` —
  rebate amount only ever offsets `slabTaxBeforeRebate` (capital-gains tax
  is structurally never passed into `computeRebate`), surcharge band
  selection correctly uses total income while the CG-attributable surcharge
  is separately capped at 15%, cess is applied once to the combined total
  (not double-counted). No leakage found in either direction.
- **Boundary/edge cases**: 80C cap edge, HRA metro/non-metro boundary,
  12/24-month holding-period boundaries, and self-occupied interest cap
  boundary were already well covered by the existing per-module test files
  (`deductions.test.ts`, `hra.test.ts`, `capitalGains.test.ts`,
  `houseProperty.test.ts`) — spot-checked several by hand, all correct. Added
  new ₹12,00,000-total-income±₹1 boundary tests specifically for the
  slab+CG-combined case (not previously covered at that exact boundary) in
  `test/adversarial-review-phase2.test.ts`.
- **80C aggregate cap / 80TTA-vs-80TTB mutual exclusivity**: confirmed both
  correct by reading `deductions.ts` directly — `section80C` is a single
  pre-aggregated caller-supplied number, clamped by `Math.min(...,
  SECTION_80C_CAP)` regardless of how a caller derived it (so even a caller
  that sums sub-instrument totals exceeding ₹1,50,000 gets correctly capped);
  `computeSection80TtaOrTtb` branches exhaustively on `isSenior`, so exactly
  one of TTA/TTB is ever non-zero — structurally impossible to double-apply.

#### Overall confidence assessment

**High**, with one caveat. The capital-gains numeric constants, holding
periods, surcharge cap, and rebate exclusion are now independently
re-verified from a second, disjoint set of sources and all confirmed
correct. One genuine bug was found and fixed (indexed-gain leakage into
total income), with a regression test. The four originally-flagged
simplifications are all real but were each individually assessed rather than
taken on faith — three are low-to-medium priority and correctly disclosed;
one (#3, the ₹30,000 self-occupied interest cap) is reprioritized upward
here because it's the one simplification in Phase 2 that can understate
tax owed rather than overstate it. The caveat: the 87A-threshold
inclusive-vs-exclusive question is a genuinely unsettled point of Indian tax
law even among practitioners as of this review date, not something this
review (or any single source found) can resolve with certainty — the
current implementation follows the best-sourced interpretation found, but
this is inherent legal ambiguity, not an engineering gap, and no amount of
further code review will settle it. 208 tests pass
(`npx vitest run`), `tsc --noEmit` clean.

## Phase 3 (Form 16 PDF parsing pipeline) — done

- `packages/pdf-form16/src/`: `types.ts` (`ExtractedField<T>` confidence-
  scored discriminated union — every extracted field is `{found:true, value,
  confidence, sourceText}` or `{found:false, reason}`, nothing is ever a bare
  value; `Form16PartA`/`Form16PartB`/`QuarterlyTds`/`ChapterViaDeductionLine`
  shapes), `decrypt.ts` (password handling via `pdfjs-dist`: no-password →
  PAN+DOB-derived → override, returns a status union rather than throwing),
  `extractText.ts` (position-aware line reconstruction — clusters text items
  by y-coordinate into rows, orders within a row by x, inserts tabs across
  wide gaps so tabular columns don't run together; detects the no-text-layer
  scanned-PDF case), `parseUtils.ts` (shared regex constants + labeled-value/
  labeled-amount heuristics with same-line → next-line → whole-line-low-
  confidence fallback), `parsePartA.ts` / `parsePartB.ts` (heuristic field
  extraction), `index.ts` (`parseForm16Pdf()` — the single end-to-end entry
  point: decrypt → extract → parse both parts).
- **Multiple build attempts stalled** (background agent hung ~600s with no
  progress, twice) right as they started building test fixtures. Root cause,
  confirmed by direct investigation: `npx tsx -e "..."` (used to spike-test
  code ad hoc) hangs in this sandboxed environment, almost certainly because
  it tries to fetch the `tsx` package on demand over a network the sandbox
  restricts. **Lesson: don't use `npx <package-not-already-in-lockfile>` for
  ad hoc verification — use `vitest` (already installed) or plain `node` on
  a real `.mjs` file instead.** The `src/` implementation itself (decrypt,
  extractText, parsePartA, parsePartB) was already solid when this was
  discovered — the stall was purely a tooling issue, not a code problem.
- Also hit and abandoned: the `pdf-lib-with-encrypt` package (an unmaintained
  fork of `pdf-lib` with `.encrypt()` support) has a real dependency bug —
  `.save()` after `.encrypt()` throws `TypeError: pako.deflate is not a
  function` from inside its own bundled `PDFFlateStream.js`. Confirmed via
  isolated reproduction, not a usage mistake. Don't reach for this package
  again for encrypted-PDF fixture generation.
- **No real encrypted-PDF fixture exists in the test suite.** Plain `pdf-lib`
  (what's actually used, in `test/fixtures.ts`) cannot write encrypted PDFs
  at all. Instead, `decrypt.test.ts` mocks pdfjs-dist's `getDocument` to
  reject with the same shape `decrypt.ts`'s `isPasswordException()` duck-type
  check looks for (`{name: "PasswordException", code}}` — note
  `PasswordException` the *class* is not actually exported from
  `pdfjs-dist/legacy/build/pdf.mjs`, only `PasswordResponses` is; confirmed
  by grepping the bundle's export list, so the mock uses a plain object, not
  the real class). This exercises all of `decryptForm16Pdf`'s branching
  (needs-password / wrong-password / success-via-pan-dob / success-via-
  override / fallback-to-override) faithfully without a real encrypted file.
  **If the user ever supplies a real (redacted) password-protected Form 16,
  test the decrypt path against it for real** — the mocked tests prove the
  branching logic is correct, not that the real PAN+DOB password convention
  actually works against a real employer-generated encrypted PDF.
- Synthetic (unencrypted) Form 16-like fixtures built programmatically in
  `test/fixtures.ts` using `pdf-lib` (Part A + Part B, realistic multi-item
  positioned rows for the header/quarterly-TDS-table/Chapter-VI-A-lines, not
  just single whole-line strings) — reviewable as code, not a committed
  binary blob. **Three real parser bugs were found and fixed by testing
  against this fixture** (not fixture-authoring mistakes — genuine heuristic
  weaknesses that could plausibly occur on real Form 16s too):
  1. `parsePartA.ts`'s `amountDeposited` label pattern matched inside "Date
     of tax deposit" (both contain the substring "tax deposit"), extracting
     the day-of-month from a deposit *date* as if it were the deposited
     *amount*. Fixed with a negative lookbehind excluding "date of ".
  2. `parsePartB.ts`'s `CHAPTER_VIA_SECTION_REGEX` used a trailing `\b`,
     which requires a word/non-word *transition* — this silently truncated
     "80CCD(1B)" down to "80CCD" whenever whitespace (also non-word)
     followed the closing paren, since non-word-to-non-word isn't a boundary.
     Fixed by replacing the trailing `\b` with a negative lookahead
     `(?![A-Za-z0-9])`, which means "not immediately followed by another
     alphanumeric character" regardless of what that following character is.
  3. `parsePartB.ts`'s `totalTaxableIncome` label pattern
     (`/total\s*(?:taxable\s*)?income/i`) also matched inside "**Gross**
     Total Income" (which appears earlier in the document), silently
     returning the gross figure instead of the taxable one. Fixed by trying
     the specific `/taxable\s*income/i` first, with a `(?<!gross\s*)`-guarded
     generic fallback.
  These were caught precisely *because* the fixture was built independently
  from realistic field layout rather than hand-tailored to make the parser
  pass — worth remembering as a testing-strategy lesson for Phase 5's wizard
  UI and beyond: adversarial-ish fixtures catch more than convenient ones.
- **`apps/web/app/api/form16/upload/route.ts`**: thin route — session-checked
  (defense in depth on top of `proxy.ts`), accepts a multipart PDF, validates
  type/size (15MB cap), computes a SHA-256 hash, stores via Vercel Blob
  (`put()`, `access: "public"`, `addRandomSuffix: true`), calls
  `parseForm16Pdf()`, returns `{fileHash, blobUrl, parseResult}` as JSON. No
  DB persistence yet (Phase 4 hasn't built the schema for it) and no review/
  edit UI yet (Phase 5) — this route is intentionally just upload+parse.
  **Untested against real Vercel Blob storage** — no `BLOB_READ_WRITE_TOKEN`
  exists yet (no Vercel project provisioned), same situation as the untested
  Neon DB wiring from Phase 0. The route fails fast with a clear 503 if the
  token is missing rather than throwing an opaque error.
- **Found and fixed a real Turbopack build bug this way**: importing
  `@cleartax/pdf-form16` into `apps/web` for the first time (this route) is
  what surfaced the `.js`-extension resolution issue documented above in
  "Critical environment notes" — fixed proactively across both
  `packages/pdf-form16` and `packages/tax-engine` (the latter isn't imported
  into `apps/web` yet, but will be in Phase 5, so fixing it now avoids
  rediscovering the exact same stall later).
- Removed an unused `pdfkit`/`@types/pdfkit` devDependency pair a stalled
  build attempt had added but never used (confirmed via grep before
  removing) — dead weight from an abandoned approach.
- 61 new tests in `packages/pdf-form16` (`parseUtils.test.ts` 18,
  `decrypt.test.ts` 14, `extractText.test.ts` 10, `parsePartA.test.ts` 8,
  `parsePartB.test.ts` 8, `index.test.ts` 3). Full repo (`typecheck`, `lint`,
  `test` across all 5 workspaces, plus `next build`) verified green — 269
  tests total across the whole repo (61 pdf-form16 + 208 tax-engine + 2
  placeholders in itr-schema/filing-provider).
- **Not done**: OCR (out of scope by design — scanned/image-only PDFs
  correctly surface a "no text layer, enter manually" error instead).

### Phase 3 adversarial review (2026-07-30)

An independent adversarial review pass was run against `packages/pdf-form16`
(`types.ts`, `decrypt.ts`, `extractText.ts`, `parseUtils.ts`, `parsePartA.ts`,
`parsePartB.ts`, `index.ts`), started from the 61-tests-green baseline
(confirmed via `npx vitest run` before touching anything). Focus: hunt for
more label/pattern collisions in the same class as the three already found
during initial build/test, stress-test the robustness of those three
already-applied fixes (not just re-check the exact case they were caught on),
re-examine `extractText.ts`'s line-reconstruction thresholds at their exact
boundaries, and re-examine `decrypt.ts` for correctness beyond what was
already tested. 84 tests pass now (23 new), `tsc --noEmit` clean across the
whole repo, full `npm run test --workspaces --if-present` green (84
pdf-form16 + 208 tax-engine + 2 placeholders).

**Four real bugs found and fixed**, all demonstrated first with a concrete
failing scenario (not fixed speculatively) before writing the fix:

1. **`parsePartB.ts`'s `totalTaxByEmployer` picked up an intermediate
   "tax payable" figure instead of the final one.** A real Form 16 Part B
   tax-computation block legitimately contains "tax payable" more than
   once — e.g. "Tax payable on total income" (before rebate/surcharge/cess)
   and "Net tax payable" (the final figure, after rebate/surcharge/cess/
   section-89 relief). The label pattern list already included
   `/net\s*tax\s*payable/i`, but it was listed *last*, and
   `findLabeledAmount`/`findLabeledValue` return on the first **line**
   (top-to-bottom) that matches *any* of the given label patterns — pattern
   order within the array only matters for tie-breaks on the same line, not
   across lines. So whenever the generic "Tax payable on total income" line
   appeared earlier in the document (the normal case), it won regardless of
   `/net\s*tax\s*payable/i` being in the list at all, silently returning the
   pre-rebate/pre-cess figure as "the employer's stated total tax." Verified
   concretely: with lines `["Tax payable on total income 45000", ...,
   "Net tax payable 40000"]`, the pre-fix code returned 45000. Fixed by
   adding a `findFirstFoundAmount` helper in `parsePartB.ts` that tries each
   pattern *group* across the **whole document** in priority order (search
   everywhere for "net tax payable" first; only fall back to the broader
   "tax payable" pattern if that specific search finds nothing anywhere) —
   this lets a specific label win globally over a broader one even when the
   broad pattern's match appears earlier in the text. Regression tests in
   `test/parsePartB.test.ts`.
2. **`parsePartB.ts`'s `exemptionHra` fallback patterns
   (`/\bhra\b.*exempt/i`, `/exempt.*\bhra\b/i`) used an unbounded `.*`,**
   which can span an entire unrelated sentence. Constructed and confirmed a
   concrete collision: `["Amount exempt under section 10 including HRA and
   LTA 45000", "House Rent Allowance 180000"]` — the pre-fix code matched
   "exempt ... HRA" across the *first*, combined/aggregate line and returned
   45000 instead of continuing to the real, HRA-specific 180000 line. Fixed
   by bounding the wildcard to `.{0,20}` (real "HRA"/"exempt" phrasings on a
   Form 16 are always close together — "HRA - Exempt", "Exempt HRA
   amount" — so this still matches genuine short phrasings while excluding
   cross-sentence false positives). Regression tests confirm both the fixed
   collision and that legitimate bounded phrasings still match.
3. **`parsePartA.ts`'s `receiptNumber` pattern (`/(\d{6,})/`, no upper
   bound, no column awareness) could misattribute the adjacent BSR code
   when a row's receipt number is genuinely blank** (a real possibility —
   not every TDS entry has a challan receipt number). Reconstructed row text
   for a blank receipt number looks like `"...Receipt No.\tBSR Code
   1234567\tDate of tax deposit..."` — `findLabeledValue`'s leading-separator
   strip removes the tab between the (empty) label and the next column, and
   the unbounded digit pattern then greedily captured "1234567" (the BSR
   code, which also happens to satisfy `\d{6,}`) as if it were the receipt
   number, at **high** confidence. Confirmed concretely before fixing (see
   commit). Fixed by anchoring the value pattern to the start of the
   post-label text and adding a negative lookahead that refuses to cross
   into another known column's own label (`/^(?:(?!bsr\s*code|date\s*of).)*?
   (\d{6,})/i`) — a blank receipt number now correctly reports "not found"
   instead of silently borrowing a neighboring field's value. Regression
   tests confirm both the fixed case and that a genuinely-present receipt
   number still extracts correctly.
4. **`decrypt.ts`'s `derivePanDobPassword` silently derived a wrong
   password for an invalid calendar-date DOB string.** `new Date("2001-02-29")`
   (2001 is not a leap year) does not throw or produce `NaN` — it silently
   rolls over to 1 March 2001, and the pre-fix code would then confidently
   derive `"...01032001"` instead of erroring, failing later as an opaque
   "wrong password" with no hint the DOB itself was invalid (or, worse in
   principle, matching if an employer's PDF generator made the exact same
   rollover mistake). The same code path also read local-timezone
   `getDate()`/`getMonth()` off a date that `new Date("YYYY-MM-DD")` parses
   as **UTC** midnight — in a negative-UTC-offset timezone this can silently
   shift the derived day back by one, making the derived password depend on
   the machine's local timezone (confirmed via inspection/reasoning, not
   locally reproducible in this sandbox — its Node build ignores `TZ` env
   overrides; not a live issue on this app's actual Vercel deploy target,
   which runs in UTC, but a real landmine for local dev in the Americas).
   Fixed for the `"YYYY-MM-DD"` ISO-date-string input shape specifically (the
   structured format this function is documented to accept, alongside the
   already-correct `DDMMYYYY` 8-digit shape): parse the numeric components
   directly and validate the day against the actual days-in-that-month
   (leap-year-aware) instead of round-tripping through `new Date()` +
   local-timezone getters at all. This fixes both the leap-year-rollover bug
   and the UTC/local mismatch for this input shape in one change. Free-form
   date strings and caller-supplied `Date` objects are unchanged (see
   "flagged, not fixed" below for why). Regression tests: rejects
   `"2001-02-29"` and `"2024-04-31"` (April has 30 days), accepts
   `"2000-02-29"` (an actual leap year), rejects an out-of-range month.

**Everything else checked and confirmed fine** (with tests added to pin the
behavior, not just spot-checked by eye):

- **Chapter VI-A section regex robustness** (`(?![A-Za-z0-9])` fix from the
  original build): confirmed correct for a section code at the very end of a
  line with no following character at all (negative lookahead trivially
  succeeds when there's nothing left to violate it), for a section code
  immediately followed by punctuation (comma) rather than whitespace, and
  re-confirmed the original "80CCD(1B)" truncation case still doesn't
  regress. All three pinned with new tests in `test/parsePartB.test.ts`.
- **`amountDeposited` lookbehind fix robustness**: confirmed case-insensitive
  ("DATE OF TAX DEPOSIT" all-caps still correctly excluded, since the `/i`
  flag applies to the whole pattern including the lookbehind) and robust to
  irregular multi-space spacing ("Date  of  tax  deposit", `\s*` handles any
  amount of whitespace). Both pinned with new tests in
  `test/parsePartA.test.ts`. **Narrower residual risk flagged, not fixed**:
  the fix only excludes the literal "date of ..." phrasing; a differently
  worded date-column header (e.g. "Date on which tax deposited", "Deposited
  on") would still collide, since the lookbehind is a literal string match,
  not a semantic one. Too speculative to fix without a real Form 16 sample
  showing this alternate phrasing actually occurs.
- **`totalTaxableIncome` lookbehind fix robustness**: confirmed handles
  irregular multi-space spacing ("Gross  Total   Income"). **Narrower
  residual risk flagged, not fixed**: the exclusion only works within a
  single reconstructed line; if "Gross" and "Total Income" ever ended up
  split across two different reconstructed lines (a line-reconstruction
  quirk, not something this fixture or any current test triggers), the
  continuation line wouldn't contain "gross" and could be picked up as if it
  were the real taxable-income line. Flagged as speculative/architectural,
  not a demonstrated bug.
- **`extractText.ts`'s `COLUMN_GAP_THRESHOLD` (12) and
  `TOUCHING_GAP_THRESHOLD` (0.5)**: the original tests only exercised gaps
  comfortably inside each bucket (40, 3, ~0.1). Added boundary-exact tests
  (gap = 12 exactly, 11.9, 12.1; gap = 0.5 exactly, 0.4, 0.51) — confirmed
  both thresholds use a strict `>` consistently and a gap exactly at either
  threshold falls into the *gentler* (smaller-separator) bucket, which is
  intentional and not accidental, but was previously untested at the exact
  edge.
- **`decrypt.ts`'s `openAttempt` buffer-reuse (`data.slice()`)**: confirmed
  correct by re-deriving from `TypedArray.prototype.slice()` semantics — it
  returns a copy backed by a **new** `ArrayBuffer` (unlike `.subarray()`,
  which shares the buffer), and every attempt slices from the pristine
  original `data` parameter, never from a previous attempt's
  already-possibly-detached copy. This is correct regardless of whether
  pdfjs-dist actually detaches its copy, and isn't practically exercisable by
  the current mocked test suite (no real encrypted-PDF fixture exists — see
  the existing note above) since the mocked `getDocument` doesn't consume/
  transfer the buffer the way real pdfjs-dist does.
- **`parseQuarterlyTdsRows`'s other row fields, `grossSalary`,
  `salarySection17_1`, `perquisitesSection17_2`, `profitsInLieuSection17_3`,
  `standardDeduction`, `professionalTax`, `incomeChargeableUnderSalaries`,
  `totalChapterViaDeductions`**: read through each label pattern by hand for
  collision risk against realistic alternate Form 16 phrasing; all specific
  enough (multi-word phrases or explicit section-number anchors) that no
  concrete collision could be constructed. Lower confidence than the four
  fixed bugs above (absence of a found bug isn't proof none exists — see
  flagged items below for the ones judged too speculative to either fix or
  fully clear).

**Flagged but not fixed** (real, reasoned-through fragilities, not fabricated
hypotheticals — but not clean, low-risk surgical fixes either, or too
speculative without a real Form 16 sample to confirm against):

1. **`parsePartA.ts`'s `employerName` and `employerAddress` both match the
   same standard combined "Name and address of the Employer" label and
   share the same match end-boundary**, so on a real Form 16 (which almost
   universally uses this exact combined phrasing, not separate
   name/address labels) both fields end up returning the *same* single
   value — which is really the company name, not a real street address.
   Additionally, neither field ever captures more than one line, while a
   real employer address commonly continues across 2-4 lines (street,
   city, state, PIN). Not fixed: a correct fix needs multi-line value
   aggregation until the next recognized label, which is a real feature
   addition (this module has no concept of "read until the next label
   starts" today), not a surgical one-line fix — and the Phase 5 review UI
   is exactly the safety net this kind of imperfect-but-not-silently-wrong
   extraction is designed to sit in front of. Pinned with a test in
   `test/parsePartA.test.ts` documenting the current behavior explicitly,
   so a future change to this is deliberate.
2. **`parsePartB.ts`'s `exemptionLta` fallback pattern `/\blta\b/i`** (bare,
   no proximity requirement to an actual amount or "exempt" keyword) risks
   matching a line that mentions "LTA" incidentally without a real LTA
   figure on it (e.g. a section-reference line with unrelated digits),
   returning a spurious number at **high** confidence rather than correctly
   reporting "not found." Unlike the `exemptionHra` bug fixed above, this
   isn't a two-anchor `.*`-spanning problem with a clean bounded-wildcard
   fix — it's a single bare keyword with no structural way to distinguish
   "this line states the real LTA amount" from "this line just mentions LTA
   in passing." Flagged rather than fixed; would need either a stronger
   shape requirement on the captured amount or removing the bare-keyword
   fallback entirely (losing recall on genuine but loosely-labeled LTA
   lines) — a real trade-off decision, not obviously correct in one
   direction, better left to a session with a real Form 16 sample to check
   against.
3. **`decrypt.ts`'s `derivePanDobPassword` cannot validate a caller-supplied
   `Date` object for a silent invalid-date rollover** (e.g. `new Date(2001,
   1, 29)` already becomes 1 March 2001 by the time this function receives
   it) — inherent to JS `Date` semantics, not detectable after construction.
   Only the string-input path (fixed above) is defensible. Documented in the
   fix's inline comment; not something a future session should try to "fix"
   further without changing this function's input contract entirely (e.g.
   requiring separate day/month/year integers instead of a `Date`).

**Overall confidence**: medium-high for this module's actual scope (heuristic
extraction feeding a *mandatory* human review/edit step, not direct-to-tax-
engine use). All three of the originally-fixed bugs were re-verified robust
against realistic variations, not just their exact original fixture case, and
four new genuine bugs were found, concretely demonstrated, and fixed with
regression tests — a real yield, consistent with this being the first
adversarial pass on this phase. The confidence isn't "high" outright (unlike
Phase 1's tax-engine core) because this module's fundamental design — regex/
proximity heuristics over reconstructed PDF text, with no real Form 16 sample
or real encrypted-PDF fixture ever tested against — means more undiscovered
label collisions are plausible on real-world documents this specific
synthetic fixture's layout doesn't happen to exercise (the same reason three
bugs were found originally, and four more were found this pass, just by
constructing slightly different but equally realistic layouts). This is an
inherent property of the heuristic-extraction approach, not a sign of
carelessness — and it's exactly why the mandatory human review/edit UI
(Phase 5) is load-bearing, not optional, for this package's output. **Before
this module is trusted for a real user's Form 16, the two still-outstanding
recommendations from before this pass remain relevant: test the decrypt path
against a real (redacted) password-protected Form 16 if the user ever
supplies one, and revisit `exemptionLta`'s bare-keyword fallback (flagged
item 2 above) if it turns out to matter in practice.**

## Phase 4 (data model + persistence) — done, UNTESTED against a live DB

Replaced the placeholder `AppMeta`-only `apps/web/prisma/schema.prisma` with
the full data model from the plan, added AES-256-GCM field encryption for
PII via a Prisma Client Extension, wrote a seed script, and validated
everything `prisma generate` / `tsc` / `eslint` / `vitest` can validate
without a real database connection. **No live Neon database exists yet**
(same blocker as Phase 0 — see "Next steps") — `prisma migrate dev` was
attempted and confirmed to fail only on the connection step (`P1001: Can't
reach database server at localhost:5432`), with the schema itself already
validated separately via `prisma generate`/`prisma validate`. This is a new,
larger instance of the exact caveat already recorded for Phase 0's Neon
wiring: **nothing in this phase has been run against a real Postgres
database.**

### Schema (`apps/web/prisma/schema.prisma`)

10 models, replacing `AppMeta` entirely: `TaxpayerProfile`, `Form16Upload`,
`SalaryIncome`, `HousePropertyIncome`, `CapitalGainAsset`,
`OtherSourceIncome`, `Deduction`, `TaxComputation`, `ItrJsonArtifact`,
`FilingAttempt` — plus 9 enums (`Form16ParseStatus`, `HousePropertyType`,
`CapitalAssetType`, `OtherSourceType`, `DeductionSection`, `TaxRegime`,
`ItrType`, `FilingProvider`, `FilingStatus`).

- **Single-tenant, no `userId` anywhere** — every income/deduction/
  computation table is keyed by `assessmentYear` (a plain `String`, e.g.
  `"2026-27"`, matching the `packages/tax-engine/src/ay2026-27/` directory
  convention) per the plan, with a `[taxpayerProfileId, assessmentYear]`
  index on each.
- **`Decimal` for every money field**, never `Float` — deliberate per the
  task brief (floating-point rounding on currency is a correctness bug, not
  a style choice). Used `@db.Decimal(14, 2)` throughout (up to
  ₹999,999,999,999.99 — far beyond any realistic personal-filer scale).
- **Real Prisma enums** for every enum field, SCREAMING_SNAKE_CASE by
  Postgres/Prisma convention. These do NOT literally match
  `packages/tax-engine`'s camelCase string-union types (e.g.
  `CapitalAssetType`'s `"listedEquityOrEquityMF"` vs. the schema's
  `LISTED_EQUITY_OR_EQUITY_MF`) or `packages/pdf-form16`'s types — scope
  discipline forbade touching either package, so a small string-mapping
  layer at the persistence boundary is expected and left for Phase 5/6, not
  built here (this phase deliberately stops short of any Prisma-backed
  route beyond what's needed to prove the encryption extension works).
- **Field-shape adjustments made to feed the tax engine cleanly** (the task
  explicitly prioritized this over rigidly matching the plan's literal field
  list) — documented inline in the schema too:
  - `SalaryIncome` gained `rentPaid` and `isMetroCity`, beyond the plan's
    literal field list. Without them this table cannot supply
    `hra.ts`'s `HraExemptionInput` at all (`basicSalary`/`hraReceived` alone
    aren't enough — the formula needs rent paid and the metro/non-metro
    rate). Everything else in `SalaryIncome` maps 1:1 to
    `FullIncomeInput.grossSalaryIncludingHra` +
    `HraExemptionInput`/`Form16PartB`'s exemption fields.
  - `HousePropertyIncome.annualLetableValue` is this table's name for
    `LetOutPropertyInput.annualRentReceived` (0/unused for
    `SELF_OCCUPIED`, since NAV is always nil there by law regardless of
    what's entered). `netIncomeOrLoss` caches the engine's last-computed
    `incomeOrLoss` for display only — not the source of truth.
  - `CapitalGainAsset` stores the raw transaction facts a user actually has
    on hand (`acquisitionDate`/`saleDate`/`acquisitionCost`/`saleValue`/
    `expenses`) rather than `capitalGains.ts`'s pre-derived
    `gainAmount`/`holdingPeriodMonths` — deriving those (date-diff for
    holding period, `saleValue - acquisitionCost - expenses` for gain) is a
    Phase 5/6 mapping-layer concern, deliberately not duplicated as
    redundant stored columns. `acquiredBeforeRegimeChange` and
    `indexedGainAmount` mirror `CapitalGainTransactionInput`'s fields of the
    same purpose exactly, per the task's explicit instruction.
    `computedGainAmount` is a cached display value only.
  - `TaxComputation`'s columns are a considered mapping from
    `FullTaxLiabilityResult`, not a verbatim copy (the engine doesn't
    expose a few of the plan's requested names directly) — documented in
    full in the schema's `TaxComputation` doc comment:
    `grossTotalIncome` (pre-Chapter-VI-A total, computed by the mapping
    layer — the engine itself only exposes the post-deduction
    `slabTaxableIncome`), `taxableIncome` = `income.totalIncome` (slab +
    capital-gains taxable income combined; identity:
    `taxableIncome = grossTotalIncome - totalDeductions`),
    `taxBeforeRebate` = `slabTaxBeforeRebate` (capital-gains tax is never
    rebate-eligible), `surcharge` = sum of both the slab and
    capital-gains surcharge components after relief, `marginalRelief` = sum
    of the 87A new-regime relief and the surcharge relief (capital-gains
    surcharge gets no relief, per `computeTaxFull.ts`'s documented
    simplification), `tdsCredit`/`netPayableOrRefund` are mapping-layer
    arithmetic over already-stored data, not engine output. Added one
    column beyond the plan's literal list, `capitalGainsTax`
    (= `capitalGainsTaxBeforeSurcharge`), since without it the
    slab-vs-capital-gains composition of `totalTaxLiability` would be
    silently lost.
  - `TaxpayerProfile.pan`/`.aadhaar`/`.bankAccountNumber` intentionally do
    **NOT** carry a `@unique` constraint — AES-256-GCM uses a fresh random
    IV per encryption, so the same plaintext PAN never produces the same
    ciphertext twice; a uniqueness check on ciphertext would be meaningless,
    and this is a single-profile app anyway (no need to look anyone up by
    PAN). `aadhaar` and the three bank fields are nullable (a profile can be
    created before bank details are known, e.g. mid-wizard in Phase 5); `pan`
    and `dateOfBirth` are required (the tax engine needs both — PAN as the
    core identity field, DOB to derive the age category the slab
    computation branches on).
  - `Form16Upload.blobUrl`/`fileHash` map directly to
    `apps/web/app/api/form16/upload/route.ts`'s existing response shape
    (`blob.url`, `fileHash`) — checked the route before writing the schema,
    per the task's instruction. `rawExtractedJson` is typed loosely as
    `Json?` (Prisma has no way to pin a `jsonb` column to a specific
    external package's TypeScript type at the schema level) but is
    documented in the schema to hold exactly
    `packages/pdf-form16`'s `Form16ParseResult` shape
    (`{ partA: Form16PartA; partB: Form16PartB }`, every leaf an
    `ExtractedField<T>`) — verified against `packages/pdf-form16/src/types.ts`
    directly.
- `ran npx prisma format` at the end to normalize whitespace/alignment —
  purely cosmetic, re-ran `prisma generate` + `tsc --noEmit` afterward to
  confirm nothing changed structurally.

### Field-level encryption (AES-256-GCM)

- **`apps/web/lib/encryption.ts`**: the actual crypto primitives.
  `encryptField(plaintext): string` / `decryptField(stored): string`.
  AES-256-GCM, fresh random 96-bit IV per call (never reused — GCM's
  confidentiality AND integrity both depend on IV uniqueness). Stored shape:
  `"iv:authTag:ciphertext"`, all three base64, colon-delimited — mirrors the
  `"scheme:salt:hash"` convention `lib/auth.ts` already uses for password
  hashes, for consistency with the existing codebase style. Key comes from
  `FIELD_ENCRYPTION_KEY` (base64-encoded 32-byte/256-bit key), read and
  validated lazily on every call (not cached at module scope) rather than
  through `getEnv()`.
- **Why not through `getEnv()`**: `getEnv()` validates the *entire* app's env
  schema in one shot and is called by routes that have nothing to do with
  encrypted fields (e.g. `/api/auth/login`). Making `FIELD_ENCRYPTION_KEY`
  required there would break every such route the moment it's unset — and
  CI's dummy env vars don't set it either. Kept it `optional()` in
  `lib/env.ts`'s schema (with an updated comment explaining exactly this),
  and instead `lib/encryption.ts` validates presence + exact 32-byte length
  right at the point `encryptField`/`decryptField` are actually called, so a
  missing/malformed key only breaks the code path that's actually
  load-bearing on it. This satisfies the task's instruction to keep
  `getEnv()`'s existing contract intact for unrelated routes.
- **`apps/web/lib/prismaFieldEncryption.ts`**: the Prisma Client Extension
  (`Prisma.defineExtension`) that wires the above into every
  `prisma.taxpayerProfile.*` call transparently:
  - `query` component intercepts `create`/`update`/`updateMany`/`upsert`/
    `createMany` and encrypts `pan`/`aadhaar`/`bankAccountNumber` in
    `args.data` (or `args.create`/`args.update` for `upsert`) before the
    query reaches Postgres. Handles both write-value shapes Prisma actually
    produces for a `String`/`String?` scalar: the plain value
    (`{ pan: "ABCDE1234F" }`) and the field-update-operations wrapper
    (`{ pan: { set: "ABCDE1234F" } }`).
  - `result` component decrypts the same three fields on the way out of
    *any* read (`findUnique`/`findMany`/etc.) — this is automatic per-field,
    not something that needs enumerating per read-method the way `query`
    does.
  - Net effect: `apps/web/lib/db.ts` applies this extension once
    (`client.$extends(fieldEncryptionExtension)`) so every caller
    everywhere — route handlers, the seed script, Phase 5's future wizard
    API — works with plaintext DTOs exactly as if the columns weren't
    encrypted. Postgres itself only ever stores ciphertext.
  - Does NOT touch `where` clauses — querying an encrypted field by value is
    both meaningless (random IV) and unneeded (single-profile app, no PAN
    lookups).
- **Testing** (`apps/web/test/encryption.test.ts`, 17 tests +
  `apps/web/test/prismaFieldEncryption.test.ts`, 12 tests — 29 total, all
  passing): treated as security-critical code and tested accordingly, not
  just "it compiles" —
  - Round-trip correctness: typical PAN/Aadhaar/bank-account values, empty
    string, unicode content, a 10,000-char value — encrypt then decrypt
    reproduces the exact original every time.
  - **Wrong key fails**: encrypt under one randomly generated key, swap
    `FIELD_ENCRYPTION_KEY` to a different one, confirm `decryptField` throws.
  - **Tampered ciphertext fails the auth-tag check**: flip one bit in the
    ciphertext body / the auth tag / the IV (three separate tests) and
    confirm `decryptField` throws in every case — this is GCM's
    `decipher.final()` doing its job (`"Unsupported state or unable to
    authenticate data"`), not custom validation code, but it's exercised
    directly rather than assumed to work.
  - IV uniqueness: encrypting the same plaintext twice produces two
    different ciphertexts (proves a fresh IV really is generated per call,
    not accidentally reused), and both still decrypt correctly.
  - Format/error-handling: malformed stored values (wrong number of
    colon-delimited parts), missing `FIELD_ENCRYPTION_KEY`, non-base64 key,
    and a key that decodes to the wrong byte length all produce clear
    thrown errors rather than silent corruption or a confusing low-level
    crypto exception.
  - `prismaFieldEncryption.test.ts` unit-tests the *pure data-shaping*
    helpers the extension uses (`encryptScalarWriteValue`,
    `encryptWriteData`, `decryptRequired`, `decryptOptional`) directly —
    confirms both write-value shapes are handled, non-encrypted fields
    (`fullName`, `bankIfsc`, etc.) pass through untouched, partial updates
    only touch fields actually present, and the input object is never
    mutated in place. **Does NOT** spin up a real Prisma Client/DB
    connection to exercise the `query`/`result` callbacks end-to-end inside
    an actual extension — impossible without a live database (see "Not
    tested" below); what's verified here is that the transformation logic
    itself is correct in isolation, which is the part that's actually
    security-critical (get this wrong and plaintext PII reaches Postgres
    unencrypted, or a decrypt silently returns the wrong thing).
- **Not tested (genuinely needs a live database)**: the extension actually
  wired into a real `PrismaClient` against real Postgres — i.e. that
  `prisma.taxpayerProfile.create({ data: { pan: "ABCDE1234F", ... } })`
  really does store ciphertext in the `pan` column and that reading it back
  really does return the original plaintext through the full Prisma
  query-engine round trip (not just the pure helper functions in isolation,
  which *are* tested above). This is the natural next verification step the
  moment a real `DATABASE_URL` exists — flagged explicitly, not silently
  assumed to work just because the unit tests pass.

### Migrations

- `npx prisma generate` (from `apps/web`) succeeds cleanly — confirms the
  schema is syntactically valid and the client generates without a live DB
  connection (this was re-run after every schema edit throughout this
  phase, not just once at the end).
  Output: `Generated Prisma Client (7.9.1) to .\generated\prisma`.
- `npx prisma validate` and `npx prisma format` both succeed cleanly too.
- `npx prisma migrate dev --create-only --name init_data_model` was
  attempted (with a dummy `DATABASE_URL` pointing at `localhost:5432`,
  since `prisma.config.ts`'s config loader requires *some* `DATABASE_URL`
  to even start) and failed at exactly the connection step, as expected:
  `Error: P1001: Can't reach database server at localhost:5432`. No
  migration files were created (checked `prisma/migrations/` afterward —
  still absent). **This confirms the schema itself is ready to migrate the
  moment a real Neon `DATABASE_URL` is available — the only missing piece
  is the live connection**, exactly the same situation already documented
  for Phase 0. Whoever picks this up next with real Neon credentials should
  run `npx prisma migrate dev --name init_data_model` for real, review the
  generated SQL once, then remove this caveat.

### Seed script (`apps/web/prisma/seed.ts`)

- Creates one `TaxpayerProfile` (fictional data — "Arjun Mehta", Mumbai) +
  a plausible AY 2026-27 income year: one `SalaryIncome` row (₹18L gross
  incl. HRA, with a hand-computed — not engine-computed — Section 10(13A)
  exemption worked out in a comment: `min(₹3.6L HRA received, ₹3L rent −
  10%×₹9L basic = ₹2.1L, 50%×₹9L = ₹4.5L) = ₹2.1L`), one `HousePropertyIncome`
  (a let-out Pune flat running a small loss), two `CapitalGainAsset` rows
  (a straightforward long-term equity MF sale, and a pre-23-Jul-2024
  property sale with an illustrative `indexedGainAmount` to exercise the
  grandfathering columns), three `OtherSourceIncome` rows, and four
  `Deduction` rows (80C/80D/80CCD(1B)/80TTA).
- **Deliberately does NOT import `@cleartax/tax-engine`** to compute these
  figures — wiring tax-engine into `apps/web` for the first time is
  explicitly called out as Phase 5's job in this file's own "Next steps"
  section, and pulling it in here would preempt that. The seed numbers are
  realistic and internally consistent (the HRA exemption is actually
  hand-derived from the formula, not made up) but are fixture data, not an
  engine-verified golden case — said explicitly in the file's header
  comment so nobody mistakes it for a validated scenario later.
  Idempotent (`deleteMany` on `TaxpayerProfile` first, which cascades to
  every child table) so re-running it doesn't accumulate duplicates.
- Wired into `apps/web/prisma.config.ts`'s `migrations.seed` as
  `"node prisma/seed.ts"` — Node 24's native TypeScript type-stripping runs
  this file directly with no extra loader, deliberately avoiding `npx tsx`
  (see Phase 3's note above on `npx tsx` hanging in this sandboxed
  environment; the seed script's own header comment repeats this rationale
  for the next session).
- **Not run for real** — same live-DB blocker as everything else in this
  phase. Typechecks cleanly (`tsc --noEmit`, part of `apps/web`'s normal
  `**/*.ts` include glob) as the only verification currently possible.

### Test/build infra additions

- `apps/web` had no `test` script or Vitest setup before this phase (its
  `package.json` only had `dev`/`build`/`start`/`lint`/`typecheck`/
  `prisma:*`). Added `vitest` (`^3.0.0`, matching the version already used
  by `packages/tax-engine`/`packages/pdf-form16` — already present in the
  hoisted root `node_modules` via those workspaces, so `npm install`
  resolved it from the existing lockfile state without needing network
  access) as a devDependency, a `test`/`test:watch` script, and
  `apps/web/vitest.config.ts` (scoped to `test/**/*.test.ts` — Next.js
  route/page rendering is out of scope for this runner; only `lib/` code is
  unit-tested here).
- Verified `next build` (Turbopack) still succeeds after all `lib/`
  changes — this specifically exercises the exact class of bug Phase 3 hit
  (Turbopack not resolving `.js`-suffixed relative imports for
  `packages/*`): `lib/db.ts` → `lib/prismaFieldEncryption.ts` →
  `lib/encryption.ts` all use extensionless imports and bundle cleanly.

### Verification run for this phase

- `npm run typecheck` (root, all 5 workspaces): clean.
- `npm run lint` (root): clean (only `apps/web` actually lints, as in every
  prior phase — `tax-engine`/`pdf-form16`/`itr-schema`/`filing-provider`
  have no lint script).
- `npm run test` (root, all 5 workspaces): **323 tests pass** — the
  pre-existing 294 (84 pdf-form16 + 208 tax-engine + 1 itr-schema
  placeholder + 1 filing-provider placeholder), unmodified, plus 29 new in
  `apps/web` (17 `encryption.test.ts` + 12 `prismaFieldEncryption.test.ts`).
- `npx prisma generate` (from `apps/web`): clean, confirms schema validity
  without a live DB.
- `npm run build --workspace=apps/web` (`next build`, with CI's dummy env
  vars): clean.
- `npx prisma migrate dev --create-only` (with a dummy, unreachable
  `DATABASE_URL`): fails exactly at the connection step (`P1001`), as
  expected — see "Migrations" above.

### Not done / deferred (all downstream of the missing live database)

1. **`prisma migrate dev` never run for real** — no migration SQL exists
   yet in `prisma/migrations/`. First priority the moment a real Neon
   `DATABASE_URL` is shared.
2. **The field-encryption extension never exercised against a real
   `PrismaClient`/Postgres round trip** — only the pure encrypt/decrypt
   primitives and the extension's data-shaping helper functions are unit
   tested (29 tests, see above). The `query`/`result` wiring inside an
   actual `$extends()`-produced client talking to real Postgres is
   unverified.
3. **No Prisma-backed API routes were built** beyond what's needed to prove
   the encryption extension's logic works in isolation — per scope
   discipline, that's Phase 5's job (the wizard UI will be the first real
   consumer of `prisma.taxpayerProfile.*` etc. in a route handler).
4. **`ItrJsonArtifact`/`FilingAttempt` are schema-only** — no logic, no
   seed rows, per the plan's explicit Phase 6/7 boundary.
5. **Enum/shape mapping layer between `packages/tax-engine`'s camelCase
   string unions and this schema's SCREAMING_SNAKE_CASE Prisma enums
   doesn't exist yet** — needed the moment Phase 5/6 actually calls the tax
   engine with data read from these tables. Flagged in the schema's doc
   comments field-by-field so it isn't a surprise.

### Phase 4 adversarial review (2026-07-30)

An independent adversarial review pass was run against Phase 4's data model
and encryption code (`apps/web/lib/encryption.ts`,
`apps/web/lib/prismaFieldEncryption.ts`, `apps/web/prisma/schema.prisma`,
`apps/web/prisma/seed.ts`), started from the 29-tests-green baseline
(confirmed via `npx vitest run` from `apps/web` before touching anything).
This is the first phase touching real PII encryption, so it got the same
adversarial scrutiny as the tax engine in Phase 1-3 — the build agent's own
tests and doc comments were treated as a starting point, not ground truth.
39 `apps/web` tests pass now (10 new), 333 tests total across the repo
(up from 323), `tsc --noEmit` clean, `eslint` clean, `next build` clean,
`npx prisma validate`/`generate`/`format` all clean. No live database exists
still — see the caveats below for exactly what this pass could and couldn't
verify as a result.

**Two real bugs found and fixed**, both demonstrated concretely before
fixing (not fixed speculatively):

1. **`encryption.ts`'s `loadKey()` had a dead `catch` block that could never
   fire, and a demonstrated (not just theoretical) gap in key validation.**
   The task specifically asked whether `Buffer.from(str, "base64")` really
   throws on malformed input in Node.js — confirmed empirically it does
   NOT: it's a lenient decoder that silently drops any character outside the
   base64 alphabet and decodes whatever's left (`Buffer.from("not-valid-
   base64!!!", "base64")` returns a 12-byte buffer with no error, for
   example). So the `try { key = Buffer.from(raw, "base64") } catch {...}`
   block in the pre-fix code was unreachable dead code — confirmed further
   by the existing test `"throws a clear error when FIELD_ENCRYPTION_KEY is
   not valid base64 for a 32-byte key"`, which set `FIELD_ENCRYPTION_KEY =
   "too-short"` and asserted the thrown message matched `/32 bytes/` — i.e.
   even the test written to exercise "not valid base64" only ever actually
   reached the *length*-check branch, never the dead catch, and nobody
   noticed the mismatch between the test's name and its own assertion.
   Then went further per the task's request and constructed a concrete
   `FIELD_ENCRYPTION_KEY` value that's clearly not valid base64 but decodes
   to exactly 32 bytes anyway: took a real, valid 32-byte base64 key and
   interleaved `"!@#$%^&*() "` between every character of it
   (`"e!@#$%^&*() /!@#$%^&*() D!@#$%^&*() ..."`). `Buffer.from()` on that
   junked string still decodes to **exactly the original 32-byte key,
   byte-for-byte** — proving the length check alone is NOT sufficient to
   catch malformed input; it just happens that most "obviously wrong" test
   inputs (like `"too-short"`) also happen to decode to the wrong length by
   coincidence, not because anything actually validates the base64 shape.
   **Practical risk**: a corrupted/mistyped `FIELD_ENCRYPTION_KEY` (copy-
   paste accident, wrong env var pasted in, stray characters) that happens
   to land on 32 decoded bytes would previously have been silently accepted
   as "the key" instead of failing loudly at startup — a real, if narrow,
   footgun for security-critical configuration, and directly contrary to
   the file's own stated design intent ("Throws ... if the stored value
   isn't well-formed" / doesn't silently corrupt).
   **Fixed**: `loadKey()` now validates the base64 alphabet explicitly
   (`/^[A-Za-z0-9+/]*={0,2}$/` plus a length-is-multiple-of-4 check) before
   ever calling `Buffer.from`, so malformed input is rejected at the source
   instead of relying on `Buffer.from` to catch it (it won't). Added
   `.trim()` on the raw value first so a trailing newline/whitespace from a
   `.env` file — a realistic, benign artifact — doesn't get newly rejected
   by the stricter check. Regression tests added in `test/encryption.test.ts`:
   the exact junked-32-byte-key scenario above now throws "not valid
   base64"; a genuinely valid key with surrounding whitespace still works;
   the pre-existing "too-short" test was corrected to assert the message it
   *should* produce now (`/not valid base64/`, not `/32 bytes/` — that
   mismatch was itself a symptom of this bug) and a new test using a
   well-formed-but-wrong-length base64 string (`randomBytes(16)`) preserves
   coverage of the original "32 bytes" length-check message.

2. **`prismaFieldEncryption.ts`'s `query.taxpayerProfile` handlers were
   missing `createManyAndReturn` and `updateManyAndReturn`** — a real
   plaintext-PII-to-Postgres gap, not a theoretical one. The task asked
   whether the handlers cover every write path that could reach
   `pan`/`aadhaar`/`bankAccountNumber`. Checked the generated Prisma client
   directly (`generated/prisma/models/TaxpayerProfile.ts` and the
   `PrismaAction` union in `generated/prisma/internal/prismaNamespace.ts`,
   both confirmed against the actually-installed `prisma`/`@prisma/client`
   7.9.1) and found `createManyAndReturn`/`updateManyAndReturn` are real,
   distinct, first-class Prisma Client methods on `TaxpayerProfile` (added
   in a recent Prisma version, easy to miss if working from older-Prisma
   training data) — with `data` arguments shaped identically to
   `createMany`/`updateMany`'s. The extension's `query.taxpayerProfile`
   block covered `create`/`update`/`updateMany`/`upsert`/`createMany` but
   not these two siblings, meaning
   `prisma.taxpayerProfile.updateManyAndReturn({ data: { pan: "..." } } })`
   (or the `createManyAndReturn` equivalent) would have written **plaintext**
   PAN/Aadhaar/bank-account data straight to Postgres, completely bypassing
   encryption — exactly the failure mode this whole module exists to
   prevent. No caller in this codebase actually uses either method yet (no
   Prisma-backed routes exist beyond the seed script, which uses plain
   `create`/`createMany`), so this hadn't caused real harm, but leaving a
   same-shaped sibling method uncovered undermines the entire premise of
   the extension — that every future caller can trust
   `prisma.taxpayerProfile.*` unconditionally.
   **Fixed**: added `createManyAndReturn`/`updateManyAndReturn` handlers,
   identical in approach to their `createMany`/`updateMany` siblings.
   Exported a new `TAXPAYER_PROFILE_WRITE_ACTIONS` constant (the exhaustive
   list of write actions that can carry TaxpayerProfile field data, per the
   `PrismaAction` union) and added a regression-guard test in
   `test/prismaFieldEncryption.test.ts` that reads the module's own source
   text and asserts every action in that list has a real handler method
   (not just a comment mentioning it) inside the `query.taxpayerProfile`
   block — `Prisma.defineExtension()`'s return value is an opaque function
   with no introspectable `.query` shape (confirmed by inspection), so a
   real database round trip would otherwise be the only way to notice this
   regressing again, and this repo doesn't have one yet. Verified the guard
   actually catches a regression by temporarily deleting the
   `createManyAndReturn` handler and confirming the new tests fail, then
   restored the fix.
   Also checked the other two parts of this sub-question explicitly: (a)
   whether `upsert`'s `where` clause ever needs an already-encrypted PAN for
   lookup — grepped the whole codebase for `where:\s*\{\s*pan` and any
   `@unique` on the three encrypted fields in `schema.prisma`; confirmed
   neither exists anywhere, so the "we never look anyone up by PAN" claim in
   the code comments is actually true, not just asserted; (b) whether any
   `$queryRaw`/`$executeRaw`/`queryRawUnsafe`/`executeRawUnsafe` call exists
   anywhere in `apps/web` that could bypass the extension entirely — grepped
   `apps/web/lib` and `apps/web/app`, found zero matches. The raw-query
   bypass risk is real in the sense that nothing would stop a *future*
   caller from using `$queryRaw` to write directly to `TaxpayerProfile` and
   skip encryption (the extension only wraps the high-level query API), but
   it's correctly a documented theoretical gap, not a current one — no code
   anywhere does this today.

**One documentation-accuracy issue found and corrected** (not a code bug —
nothing currently computes anything from the incorrect claim, since the
mapping layer described doesn't exist yet, but worth fixing before Phase 5/6
treats this comment as a spec):

- **`schema.prisma`'s `TaxComputation` doc comment claimed an exact
  "Identity: `taxableIncome = grossTotalIncome - totalDeductions`"**, which
  the task asked to spot-check against the real engine source. Traced
  through `packages/tax-engine/src/ay2026-27/fullIncome.ts`'s
  `computeFullTaxableIncome` line by line: the slab-rate component is (a)
  floored at 0 via `Math.max(0, ...)` before `totalIncome` is derived from
  it, and (b) separately rounded to the nearest ₹10 (`roundToNearestTen`,
  Section 288A) — either can make `grossTotalIncome - totalDeductions`
  (as the schema comment defines `grossTotalIncome`) differ from the actual
  stored `taxableIncome` by anywhere from a few rupees (rounding) to the
  full negative amount (if the pre-floor figure was negative, `taxableIncome`
  shows 0 while the "identity" would predict a negative number). Concrete
  example: a raw pre-rounding slab income of ₹123 (before capital gains)
  rounds to ₹120, so the two sides of the claimed identity differ by ₹3.
  This doesn't affect any actual stored data (both `TaxComputation` columns
  are meant to be populated independently from real
  `FullTaxLiabilityResult` output by the future mapping layer, not derived
  from one another via this formula) — it's a doc-comment precision issue,
  not a computation bug — but worth fixing since the comment reads as a
  spec Phase 5/6 will build against. **Fixed**: reworded the comment to say
  "approximately ... but NOT an exact identity" with the floor/rounding
  caveat spelled out.

**Everything else checked and confirmed fine:**

- **`encryptScalarWriteValue`'s handling of Prisma's field-update-operations
  shapes**: read `generated/prisma/models/TaxpayerProfile.ts`'s actual
  generated types directly — `StringFieldUpdateOperationsInput = { set?:
  string }` and `NullableStringFieldUpdateOperationsInput = { set?: string |
  null }` are BOTH exhaustively just `{ set }`, nothing else (no
  `unset`/`increment`/etc. — those don't exist for string scalars in any
  Prisma connector, `unset` specifically is a MongoDB-connector-only
  concept that doesn't apply to this Postgres schema at all). Confirms the
  code's two-shape handling (plain value / `{ set }`) really is exhaustive
  for this Prisma version and schema, not an assumption.
- **The `result.compute` API shape (`needs`/`compute`, overriding a field by
  its own name)**: read the actual installed
  `node_modules/@prisma/client/runtime/client.d.ts` (Prisma 7.9.1, matching
  the installed `prisma` package version exactly) rather than trusting
  training-data recollection of a possibly-different Prisma major version.
  Confirmed `ResultArgsFieldCompute = (model: any) => unknown` and
  `needs?: { [K in ...]?: true }` are the real, current type shapes, and
  they match `prismaFieldEncryption.ts`'s usage exactly (e.g.
  `pan: { needs: { pan: true }, compute(profile) { return
  decryptRequired(profile.pan) } }`). This is type-level confirmation that
  the code is using the API the way Prisma 7.9.1 actually defines it, which
  is as far as this could be verified without a live database — the
  **behavioral** question (does `compute` really receive the raw encrypted
  DB value at runtime, not something already double-processed, when
  overriding a field by its own name) genuinely requires a live Postgres
  round trip to settle for certain, which this repo still doesn't have.
  Deliberately did not attempt to fake this with a mock driver adapter
  (Prisma 7's SQL adapter interface expects to execute real generated SQL
  and return real result sets — faking that convincingly enough to prove
  anything would mean building a miniature SQL engine, well beyond this
  review's scope and explicitly out of bounds per "no live-DB testing").
  **This specific point remains the single most important thing to verify
  for real the moment a live Neon connection exists** — already flagged as
  such before this review, still true after it.
- **`schema.prisma` cascade/relation correctness**: read all 10 models and
  every `onDelete` choice. Confirmed sensible in every case (`Cascade` from
  `TaxpayerProfile` to all seven direct child tables; `SetNull` for
  `SalaryIncome.form16UploadId` and `ItrJsonArtifact.taxComputationId`,
  both correctly nullable columns; `Restrict` for
  `FilingAttempt.itrJsonArtifactId`, a required column, correctly preventing
  deletion of an artifact a filing still references) **except one flagged
  fragility, not fixed** — see below.
- **`Decimal` precision**: `@db.Decimal(14, 2)` used throughout allows values
  up to ₹999,999,999,999.99 (~1 trillion rupees / ~10,000 crore) — checked
  against realistic capital-gains scale (even a large Indian property/
  business sale rarely exceeds a few hundred crore) and confirmed this is
  far more headroom than needed anywhere in the schema; no overflow risk
  found.
- **`TaxComputation`/`CapitalGainAsset` field-mapping doc comments,
  spot-checked against real `packages/tax-engine` source** (not just taken
  on faith): confirmed `FullTaxableIncomeResult` (in `fullIncome.ts`)
  genuinely does not expose a `grossTotalIncome`-named field, matching the
  schema comment's claim exactly. Confirmed every other `TaxComputation`
  column mapping against the real `RebateResult`/`SurchargeResult`/
  `FullTaxLiabilityResult` field names in `types.ts` and
  `computeTaxFull.ts` (`taxBeforeRebate` = `slabTaxBeforeRebate`,
  `capitalGainsTax` = `capitalGainsTaxBeforeSurcharge`, `rebate` =
  `rebate.rebateApplied`, `surcharge` = `slabSurcharge.surchargeAfterRelief
  + capitalGainsSurcharge`, `marginalRelief` = `rebate.marginalReliefApplied
  + slabSurcharge.marginalReliefApplied`, `cess` = `cess.cess`,
  `totalTaxLiability` = `totalTaxLiabilityRounded`) — all field names
  matched exactly, and independently confirmed `computeTaxFull.ts` really
  does compute the capital-gains surcharge with a flat rate and no
  marginal-relief smoothing (`capitalGainsSurcharge =
  roundPaisa(percentOf(capitalGainsTaxBeforeSurcharge,
  capitalGainsSurchargeRatePercent))`, no relief function involved),
  matching the `marginalRelief` column comment's claim. Confirmed
  `CapitalGainAsset`'s claim that `capitalGains.ts`'s
  `CapitalGainTransactionInput` consumes a pre-derived `gainAmount` +
  `holdingPeriodMonths` (not raw transaction facts) by reading the actual
  interface — true, and `acquiredBeforeRegimeChange`/`indexedGainAmount`
  really do mirror that interface's fields of the same purpose exactly.
- **Seed script (`seed.ts`) arithmetic, independently re-derived** (not just
  re-checked against the seed's own comments): imported and traced
  `packages/tax-engine/src/ay2026-27/hra.ts`'s real
  `computeHraExemption`/`getHraExemptionForRegime` formula by hand against
  the seed's actual inputs (basicSalary ₹9,00,000, hraReceived ₹3,60,000,
  rentPaid ₹3,00,000, metro) — `min(360000, 300000 - 90000, 0.5*900000)` =
  `min(360000, 210000, 450000)` = `210000`, exactly matching the seed's
  hardcoded `exemptHra: 210_000`. Independently recomputed both capital-gains
  `computedGainAmount` values from the seed's own `saleValue -
  acquisitionCost - expenses` fields (equity MF: `350000 - 200000 - 500 =
  149500`; property: `6000000 - 1500000 - 100000 = 4400000`) — both match
  exactly. Independently recomputed the house-property `netIncomeOrLoss`
  against `packages/tax-engine/src/ay2026-27/houseProperty.ts`'s real
  let-out formula (`netAnnualValue = rentReceived - municipalTaxesPaid =
  228000`; `standardDeduction30Percent = 0.3 * 228000 = 68400`;
  `incomeOrLoss = 228000 - 68400 - 180000 = -20400`) — matches the seed's
  `netIncomeOrLoss: -20_400` exactly. **No arithmetic errors found in the
  seed data** — all three hand-computed figures the build agent claimed were
  "hand-derived from the actual formula" really were, verified by tracing
  the real formulas independently rather than trusting the claim.

**Flagged but not fixed** (a real, reasoned-through fragility — not a
fabricated hypothetical — but not a clean surgical fix, and unverifiable
without a live database):

- **Cascade-delete ordering risk on a full `TaxpayerProfile` deletion.**
  `TaxpayerProfile` cascades (`onDelete: Cascade`) directly to both
  `ItrJsonArtifact` and `FilingAttempt`. Separately,
  `FilingAttempt.itrJsonArtifactId` has `onDelete: Restrict` (deliberately —
  it protects a referenced artifact from deletion while a filing still
  points at it, a sensible rule for a *direct* `ItrJsonArtifact` delete).
  The risk: when a `TaxpayerProfile` row itself is deleted, Postgres must
  cascade-delete `ItrJsonArtifact` rows and `FilingAttempt` rows as two
  separate, independently-triggered cascade paths from the same parent
  delete. If Postgres happens to process the `ItrJsonArtifact` cascade
  before the `FilingAttempt` cascade (trigger firing order across different
  constraints isn't something the schema author controls, and isn't
  something `prisma migrate`'s generated SQL pins down either), it would
  try to delete an `ItrJsonArtifact` row while a `FilingAttempt` row still
  references it via the `Restrict` constraint — a foreign-key violation
  that would fail the entire profile deletion with an unexpected error,
  rather than cleanly cascading everything away. This is a known class of
  Postgres gotcha (cascading deletes along a "diamond" of FK paths to the
  same table, where one path is `Cascade` and a sibling path is `Restrict`
  on a table that's *also* being cascade-deleted from a different
  direction) — not fabricated for this review, but also not something that
  can be confirmed to actually happen (or ruled out) without running it
  against a real Postgres instance, which this repo doesn't have. **Not
  fixed**: the "correct" fix isn't obvious — loosening
  `FilingAttempt.itrJsonArtifactId` to `Cascade` would remove the
  intentional protection against deleting a referenced artifact directly
  (a real, separate scenario this schema is right to guard against) just to
  fix a cascade-ordering edge case that only matters for a
  whole-profile-wipe feature that doesn't exist yet (this is a
  single-profile personal-use app; nothing currently deletes a
  `TaxpayerProfile`). Flagged here so it's not a surprise later: **the
  first time a "delete my account" / whole-profile-wipe feature is built,
  test deleting a `TaxpayerProfile` that has an `ItrJsonArtifact` +
  `FilingAttempt` referencing it against the real Neon database and confirm
  it cascades cleanly** — if it doesn't, decide then whether to relax the
  `Restrict` or delete in explicit dependency order in application code.

#### Overall confidence assessment

**High confidence in the pure crypto and data-shaping logic** — the part
that's actually testable without a live database. Two real, concrete bugs
were found and fixed (the dead-code base64 validation gap and the missing
`createManyAndReturn`/`updateManyAndReturn` handlers), both demonstrated with
a failing scenario before fixing, both now covered by regression tests, and
both are the kind of bug that specifically justified this review pass (not
edge-case trivia — the second one is a genuine "plaintext PII could reach
Postgres" gap in a security-critical module). The seed data's hand-computed
figures were independently re-derived against the real engine formulas, not
just trusted, and all three checked out exactly.

**Medium confidence, not high, in the Prisma Client Extension's actual
runtime behavior against a real database** — this is unchanged from before
this review and is the single biggest caveat on this whole phase. Everything
checkable without a live Postgres connection has now been checked twice
(once by the build agent, once adversarially): the pure helper functions are
thoroughly unit-tested, the API shapes used (`needs`/`compute`, the
field-update-operations wrapper shapes) are confirmed against the actually-
installed Prisma 7.9.1's real type definitions rather than assumed from
possibly-stale training data, and the write-path coverage is now genuinely
exhaustive (confirmed against Prisma's own `PrismaAction` union) rather than
just "the actions someone thought to list." But the actual `query`/`result`
callbacks running inside a real `$extends()`-produced `PrismaClient` talking
to real Postgres — whether `compute()` really receives the raw ciphertext at
read time, whether the query interception really reaches Postgres before
encryption failure could leak plaintext, whether the driver adapter and the
extension compose correctly — genuinely cannot be verified without a live
database, and this review did not attempt to fake that (explicitly out of
scope per the task). **This remains the top priority the moment a real Neon
`DATABASE_URL` exists**: run the seed script for real and confirm
`pan`/`aadhaar`/`bankAccountNumber` round-trip correctly through an actual
Postgres column, exactly as PROGRESS.md already flagged before this review —
this pass raises confidence in the surrounding code but does not and cannot
close that gap.

## Phase 5 (wizard UI) — done, UNTESTED against a live DB

Built the guided wizard at `apps/web/app/(dashboard)/`: profile -> Form 16
upload/review -> income -> deductions -> regime comparison -> summary ->
filing (stub). This is the first phase that actually imports
`@cleartax/tax-engine` into `apps/web` (added `"@cleartax/tax-engine": "*"`
to `apps/web/package.json`'s dependencies — already symlinked via the npm
workspace, so no install step was needed beyond that) and the first phase to
build the enum/shape mapping layer Phase 4 deliberately left unbuilt.
**No live Neon database exists yet** — same blocker as every prior phase;
see "What still needs live-DB verification" below for exactly what this
means in practice.

### The mapping layer (`apps/web/lib/mapping/`) — the architecturally significant new piece

**`toTaxEngineInput.ts`** is a pure, Prisma-Client-independent module: every
function takes a plain "row" shape (`SalaryIncomeRow`, `HousePropertyRow`,
`CapitalGainAssetRow`, `OtherSourceIncomeRow`, `DeductionRow` — money
fields already converted from `Prisma.Decimal` to `number`) rather than the
generated Prisma model types directly. This keeps it trivially unit-testable
(construct a plain object literal, no mock database needed) — 33 tests in
`test/mapping/toTaxEngineInput.test.ts` cover every function individually
plus two end-to-end assemblies that feed straight into the real
`computeFullTaxLiability`/`compareRegimes` to confirm the whole pipeline
produces a plausible result. The actual Prisma-touching glue lives one layer
up, in `apps/web/lib/loadFullIncomeInput.ts` (`loadFullIncomeInputForProfile`
fetches every row for a profile+AY and calls into the pure layer;
`loadTdsCredit` sums `SalaryIncome.tdsDeducted` + `OtherSourceIncome.tdsDeducted`)
— both `/regime-comparison` and `/summary` share this one function rather
than duplicating the fetch+map dance.

Key design decisions, each documented inline at its point of use:

- **`buildFullIncomeInput`** is the single entry point: assembles salary+HRA,
  house properties, capital gains, other-sources income, and Chapter VI-A
  deductions into one `FullIncomeInput`, given an `age` (computed via
  `lib/dateMath.ts`'s `computeAgeForAssessmentYear` — age as of 31 March of
  the relevant FY, the standard convention for senior-citizen
  classification, NOT the current date).
- **Salary aggregation across employers** (job-switch scenario): `grossSalary`,
  `basicSalary`, `hraReceived`, `rentPaid` are summed across every
  `SalaryIncome` row for the AY; `isMetro` is OR'd across rows. `grossSalary`
  is passed to the engine at face value (matches `schema.prisma`'s own "matches
  `FullIncomeInput.grossSalaryIncludingHra` exactly" doc comment) — **NOT**
  further reduced by `exemptLta`/`exemptOther`/`professionalTax`, because
  `packages/tax-engine`'s Phase 2 scope only ever implemented the HRA
  exemption (`hra.ts`); it has no input path for LTA exemption, other
  Section 10 exemptions, or the Section 16(iii) professional-tax deduction
  at all. Per the scope-discipline rule against modifying `packages/tax-engine`,
  this mapping layer does NOT invent an ad hoc subtraction the engine was
  never designed to receive — those `SalaryIncome` columns remain
  display/audit-only (they're still shown on the Form 16 review screen and
  editable there, populated from Form 16 when available). This is a
  conservative simplification (overstates taxable salary, therefore tax —
  consistent with this codebase's established bias elsewhere, e.g. Phase 2's
  capital-loss set-off simplification) rather than a silent understatement,
  but it's a real, user-facing gap: a taxpayer with a meaningful LTA
  exemption will see a higher computed liability than the correct one.
  **Flagged here explicitly as the most likely place a future session should
  look first if computed numbers look off** for a salaried taxpayer with LTA
  or other Section 10 exemptions.
- **Capital gains**: `CapitalGainAsset` stores raw transaction facts (dates,
  cost, sale value, expenses); `toCapitalGainTransactionInput` derives
  `gainAmount = saleValue - acquisitionCost - expenses` (can be negative —
  not clamped, since the engine floors per-bucket totals itself where
  appropriate) and `holdingPeriodMonths` via `lib/dateMath.ts`'s
  `monthsBetween` (completed-calendar-months convention, UTC-only
  arithmetic — deliberately avoiding the local-timezone class of bug Phase 3's
  adversarial review found in `derivePanDobPassword`).
- **Chapter VI-A deductions**: 80C/80CCD(1B) are simple per-row sums.
  80D and 80CCD(2) needed more structure than a single `amount` column could
  carry (80D needs three sub-amounts + two independent senior-citizen flags;
  80CCD(2) needs an employment-type flag) — see the schema-change note below.
  **80TTA/80TTB are NOT manually entered anywhere in the UI** — the engine's
  `computeSection80TtaOrTtb` already auto-selects and auto-caps based on age
  and interest income, so `interestIncomeForTtaOrTtb` is computed directly
  from `OtherSourceIncome` rows: below 60, only `SAVINGS_INTEREST` counts
  (Section 80TTA); 60+, all three interest types count (Section 80TTB) —
  exactly why `schema.prisma`'s `OtherSourceType` enum splits
  `SAVINGS_INTEREST` out from `FIXED_DEPOSIT_INTEREST`/`RECURRING_DEPOSIT_INTEREST`
  in the first place. The `/deductions` page shows this as a read-only
  computed panel, not an editable form.
- **`taxComputationMapping.ts`** implements the `TaxComputation` column
  mapping `schema.prisma`'s own doc comment already specified (Phase 4 wrote
  the spec; this phase is the first code that actually performs it) —
  spot-checked field-by-field against `FullTaxLiabilityResult`'s real shape,
  4 tests in `test/mapping/taxComputationMapping.test.ts` including one that
  runs the real `computeFullTaxLiability` (not a hand-built fixture) through
  the mapping and checks every field, plus a refund-vs-payable sign check.

**Enum mapping (`enumMaps.ts`)**: exhaustive `Record<PrismaEnum, EngineUnion>`
maps (not `switch`/`if` chains) for `CapitalAssetType`, `TaxRegime`, and
`HousePropertyType`'s discriminant — exhaustiveness means TypeScript itself
fails to compile if a new Prisma enum member is ever added without a
corresponding entry, catching a silent mapping gap at compile time.

### Schema change: `Deduction.metaJson` (the one schema addition this phase made)

`packages/tax-engine/src/ay2026-27/deductions.ts`'s `Section80DInput` needs
three sub-amounts (self+family premium / parents' premium / preventive
check-up) plus two independent senior-citizen flags that each select a
different cap (₹25,000 vs ₹50,000); `Section80CCD2Input` needs an
`employmentType` flag that also changes the applicable cap (14%/10% old
regime). Phase 4's `Deduction` model (`section` + `description` + `amount`)
has no field for either. This was assessed as a genuine blocking gap, not a
design preference — a single `amount` column structurally cannot carry a
bucket split or a boolean flag. **Smallest fix made**: added one optional
`metaJson Json?` column to `Deduction`, documented in the schema with the
exact shape per section (`{ bucket: "selfFamily" | "parents" |
"preventiveCheckup", isSenior?: boolean }` for 80D rows; `{ employmentType:
"government" | "other" }` for 80CCD(2) rows). `/deductions`' 80D and
80CCD(2) forms are "replace-all" (delete existing rows for that section,
write the new set in a `$transaction`) rather than accumulating duplicates
across edits, since each represents one coherent picture rather than a
growing list of instruments (unlike 80C/80CCD(1B), which stay a genuine
add-a-line-item list). `lib/mapping/toTaxEngineInput.ts`'s
`reconstructSection80D`/`reconstructSection80CCD2` regroup these rows back
into the engine's input shapes at computation time, failing safe (contributing
0, never guessing) for a row with missing/malformed `metaJson` — tested
explicitly.

### A note on `zodResolver` + `z.coerce`/`z.preprocess` (a real type-inference pitfall hit and fixed)

Every validation schema in `lib/validation/` was originally written with
`z.coerce.number()` (for HTML numeric inputs) and `z.preprocess()` (for
"empty string -> undefined" on optional fields) — both failed to typecheck
against `useForm<T>({ resolver: zodResolver(schema) })` with a real,
non-obvious TypeScript error (`Resolver<T>` mismatch, `unknown` appearing in
field types). Root cause, confirmed by reading Zod's actual type
definitions rather than guessing: both `z.coerce.*` and `z.preprocess()` are
built on an `unknown`-typed base internally, so `z.input<>` of any field
built from either is always `unknown` — `zodResolver`'s inferred `Input`
generic then can't unify with `useForm<T>`'s single `T`. Fixed by (1)
replacing `z.coerce.number()` with plain `z.number()` everywhere — React
Hook Form's own `valueAsNumber: true` register option already converts the
DOM string to a real number before the resolver ever runs, so coercion was
never actually needed; (2) replacing `z.preprocess()`-based "empty ->
undefined" with `.transform()`/`.refine()` chains on a concrete `z.string()`
base, ending in an explicit trailing `.optional()` (documented in detail in
`lib/validation/shared.ts` — the trailing `.optional()` is load-bearing: it
makes `z.input` symmetric with `z.output`, both `string | undefined`, which
is what resolves the type mismatch). Left in `lib/validation/shared.ts`'s
comments in detail so a future session doesn't rediscover this the hard way.
One test was updated to match the new (non-coercing) contract
(`salaryIncome.test.ts`'s "rejects a numeric-string input" — previously
asserted coercion) and one new test added (`capitalGain.test.ts`, asserting
an empty-string `indexedGainAmount` is now correctly rejected rather than
coerced to omitted, since the client only ever sends a real number or omits
the key entirely for that field now).

### Per-step summary

1. **`/profile`**: `lib/validation/profile.ts` (PAN/Aadhaar/IFSC/pincode
   regex validation, react-hook-form + `@hookform/resolvers/zod`) +
   `lib/getOrCreateTaxpayerProfile.ts` (find-or-create the single profile
   row — `getOrCreateTaxpayerProfile()` creates a placeholder if none
   exists; `getTaxpayerProfileOrNull()` for pages that should prompt
   "complete your profile" instead). PAN/Aadhaar/bank account number are
   masked by default (`lib/mask.ts` — keeps the last 5/4/4 characters
   respectively, tested for short-string and null/empty edge cases) with a
   per-field "Show / edit" toggle that must be clicked before the real value
   is editable.
2. **`/form16`**: `UploadForm.tsx` handles the FULL password flow —
   `needs-password` prompts for a password and retries with the same
   in-memory `File`; `wrong-password` re-prompts with an attempt counter;
   `no-text-layer` points at `/form16/manual`; `failed` shows the error and
   allows retry. Only `success` persists anything. `createForm16Upload`
   stores `rawExtractedJson` as exactly `{ partA, partB }` (the
   `Form16ParseResult` shape `schema.prisma`'s doc comment specifies, not
   the API route's status-wrapper shape) and sets `parseStatus` to
   `NEEDS_REVIEW` (via `lib/form16Review.ts`'s `needsReview` — true if
   `grossSalary`/`standardDeduction`/`totalTaxableIncome` weren't found or
   were low-confidence) or `PARSED` otherwise. **The review screen
   (`/form16/review/[id]`) is the mandatory gate**: `ExtractedFieldsTable`
   renders every Part A/B field (confidence badge, source text, low-confidence
   rows highlighted) read-only, and `SalaryIncomeForm` (shared with manual
   entry and editing) renders every field that maps to a `SalaryIncome`
   column as an editable input, prefilled from the parse via
   `defaultSalaryFromForm16` (which explicitly zeroes `basicSalary`/
   `hraReceived`/`rentPaid`/`isMetroCity` — Form 16 never states these — with
   a visible amber-highlighted "Form 16 does not include these" section
   prompting manual entry). `confirmForm16Upload` is the ONLY path data
   reaches `SalaryIncome`; it flips `parseStatus` to `CONFIRMED`. Multiple
   Form 16 uploads (job-switch) are supported — each confirmed upload
   creates its own `SalaryIncome` row, summed by the mapping layer. Fields
   with no corresponding persisted column (employee PAN, period dates,
   quarterly TDS breakdown, employer address) are shown read-only/informational
   only — there's no column to save an edited value to without a further
   schema change, which was judged out of scope for this pass (documented
   as a deliberate, not accidental, gap — see "What's NOT fully built" below).
3. **`/income`**: add/delete forms (react-hook-form + zod) for
   `HousePropertyIncome` (self-occupied/let-out, conditionally showing
   rent/tax fields), `CapitalGainAsset` (asset-by-asset, with a conditional
   grandfathering-option sub-form that only appears for immovable property
   acquired before 23-Jul-2024, and only sends `indexedGainAmount` to the
   server when the user actually opts in — see the coerce/preprocess note
   above for why this couldn't just default to 0), and `OtherSourceIncome`.
   Editing in place isn't built for these three (add + delete only — the
   Form 16 salary flow needed edit-in-place for the review gate, these
   didn't get the same treatment given the effort budget; delete + re-add
   is the workaround). `CapitalGainAsset.computedGainAmount` is cached at
   write time (`saleValue - acquisitionCost - expenses`) for display.
4. **`/deductions`**: 80C/80CCD(1B) as add-a-line-item lists;
   80D/80CCD(2) as replace-all single forms (see schema-change note above);
   80TTA/80TTB as a read-only computed panel. Every cap shown
   (`lib/deductionCaps.ts`, 11 tests) imports the real constants from
   `@cleartax/tax-engine` (`SECTION_80C_CAP`, etc.) — never a duplicated
   hardcoded number — and is a UX warning only (`computeChapterVIA` already
   clamps regardless of what's entered, so an over-cap entry can't inflate
   the actual computed benefit).
5. **`/regime-comparison`**: `loadFullIncomeInputForProfile` +
   `compareRegimes()` (from `@cleartax/tax-engine`), rendered as a
   side-by-side table (gross total income, deductions, taxable income, slab
   tax, rebate, capital-gains tax, surcharge, cess, total liability) with a
   recommendation banner. Regime selection is **not** stored as separate
   state — the "Proceed with old/new/recommended regime" links navigate to
   `/summary?regime=old|new`, and the actual persisted choice is the
   `TaxComputation.regime` column written when the user clicks "Compute &
   save" there (see `regimeCompare.ts`'s own doc comment: this is a pure
   function with no I/O, so there's nothing to "select" server-side until a
   computation is actually run).
6. **`/summary`**: `computeAndSaveTaxComputation(regime)` runs
   `computeFullTaxLiability`, sums TDS credit (`loadTdsCredit`), maps via
   `mapFullTaxLiabilityToTaxComputation`, and creates a new `TaxComputation`
   row (history is append-only — each run is a new frozen snapshot, matching
   the model's own doc comment on why: reproducibility, and Phase 6 needs a
   specific computation to build an ITR JSON artifact from). The page shows
   the latest computation's full breakdown (income, deductions, tax
   liability, TDS credit, net payable/refund) and a regime selector
   defaulting to whatever `?regime=` was passed in from the comparison page.
   `TaxComputation.engineVersion` is a hand-maintained constant
   (`"0.0.1"`, matching `packages/tax-engine/package.json`'s version at
   time of writing) rather than importing the package's `package.json` at
   runtime — deliberately avoiding reintroducing the exact "Turbopack can't
   resolve this the way you'd expect" class of issue Phase 3 already hit
   once with `.js`-suffixed relative imports, for a field whose only
   purpose is "which engine revision produced this."
7. **`/filing`**: deliberately minimal per the task's explicit boundary —
   shows the latest `TaxComputation` summary if one exists, otherwise a
   pointer to `/summary`, with a note that ITR JSON export (Phase 6) and
   filing status (Phase 7) will appear here once built. No ITR JSON/filing
   logic of any kind.

### Wizard navigation/persistence

`app/(dashboard)/layout.tsx` is a plain stepper nav (7 links, not a generic
wizard framework) — every step is an independently-navigable route reading/
writing real Prisma data via Server Components/Actions, so refreshing or
returning on a later day resumes correctly; nothing is held only in client
React state. Every Server Action calls `lib/session.ts`'s `requireSession()`
first (reads the session cookie via Next.js 16's async `cookies()`) as
defense in depth on top of `proxy.ts`'s route-level gating, matching the
existing pattern in `app/api/form16/upload/route.ts` — per Next.js 16's own
guidance, Server Actions are directly-callable POST endpoints, not only
reachable by navigating through a proxy-gated page.

**Found and fixed a real `next build` bug this way**: every page under
`(dashboard)` reads live Prisma data, so Next tried to statically prerender
them at build time against the build's dummy/unreachable `DATABASE_URL`,
failing the whole build (`prisma:error undefined` / "Export encountered an
error on /(dashboard)/form16/page"). Fixed by adding `export const dynamic =
"force-dynamic"` to `app/(dashboard)/layout.tsx` (applies to every nested
page) — confirmed via the build's route summary afterward that every
dashboard route is now marked `ƒ` (server-rendered on demand) while `/` and
`/login` stay `○` (static), exactly as intended.

### Testing

- **176 new tests in `apps/web`** (up from 39 after Phase 4's adversarial
  review): `dateMath.test.ts` (17 — `monthsBetween` boundary cases including
  leap years and the exact 12/24-month thresholds; age computation including
  the 60-year senior-citizen boundary), `mask.test.ts` (11 — the exact
  example from the task spec plus short-string/null/empty edge cases),
  `validation/*.test.ts` (58 across all six entities — valid/invalid cases,
  coercion-removal behavior, optional-field empty-string handling),
  `deductionCaps.test.ts` (11 — every cap at the exact boundary ±₹1),
  `form16Review.test.ts` (10 — flattening found/not-found fields, the
  Form-16-can-never-know-these-fields default-zeroing, the `needsReview`
  heuristic), `mapping/toTaxEngineInput.test.ts` (33 — the most important
  file in this phase's test suite: every mapping function individually,
  multiple exhaustive-enum-mapping checks, the 80D `metaJson` fail-safe
  behavior, and two full end-to-end assemblies fed into the REAL
  `computeFullTaxLiability`/`compareRegimes`, not a mock), and
  `mapping/taxComputationMapping.test.ts` (4, including one run against the
  real engine output). **333 pre-existing tests across the repo (39 apps/web
  + 84 pdf-form16 + 208 tax-engine + 2 placeholders) all still pass
  unmodified** except the one `salaryIncome.test.ts` case updated to match
  the coercion-removal fix (documented above) — 470 tests total repo-wide
  now (176 apps/web + 84 + 208 + 2).
- **Deliberately did NOT write Playwright/e2e tests** — blocked on live
  infrastructure (no real Postgres, no real Vercel Blob token), same
  situation as every prior phase. Explicitly deferred to Phase 9 (see "Phase
  checklist" below) — do not attempt this without a live DB.
- `npm run typecheck` / `npm run lint` / `npm run test` (root, all
  workspaces) and `npm run build --workspace=apps/web` (`next build`, CI's
  dummy env vars) all verified clean after every change in this phase, not
  just once at the end.

### What's NOT fully built (deliberate scope decisions, not oversights)

1. **House property / capital gains / other-sources income have no
   edit-in-place UI** — add + delete only. Editing means delete-and-re-add.
   Salary income (via Form 16 review + a dedicated edit page) is the
   exception, since that flow specifically needed edit-in-place for the
   mandatory review gate.
2. **Form 16 fields with no persisted column** (employee PAN, period
   dates, quarterly TDS breakdown, employer address) are shown read-only
   with full confidence/source-text transparency but aren't editable —
   there's no `SalaryIncome`/`Form16Upload` column to save an edited value
   to without a further schema addition, which this phase's scope
   discipline (minimal, justified schema changes only) didn't extend to.
   The core safety property — nothing reaches `SalaryIncome` without going
   through an editable review form — is intact; only these non-taxable-income-affecting
   metadata fields are exempted.
3. **LTA/other Section 10 salary exemptions and Section 16(iii) professional
   tax are recorded (editable, shown) but not subtracted anywhere in the
   computation** — `packages/tax-engine`'s Phase 2 scope never implemented
   an input path for either. Flagged prominently above (mapping-layer
   section) since it's the most likely source of a "why is my number higher
   than I expected" report for a salaried user with real LTA exemptions.
4. **`HousePropertyIncome.netIncomeOrLoss` is never written back** after a
   `/summary` computation — it stays at its creation-time default (0) rather
   than caching the engine's last-computed per-property figure, even though
   `schema.prisma`'s own doc comment describes it as exactly that kind of
   cache. Minor, display-only gap (the tax engine always recomputes
   authoritatively at computation time regardless) — a nice-to-have deferred
   for effort-budget reasons, not a correctness issue.
5. **`Form16Upload.employerName`/`.employerTan`** are set once from the
   original parse and never updated even if the user edits "Employer name"
   on the review form (which only writes to `SalaryIncome.employerName`) —
   a minor display inconsistency between the upload list and the confirmed
   salary list, not a data-correctness issue.

### What still needs live-DB/live-Blob-storage verification before this phase can be considered fully proven

Everything below is genuinely untested — this phase's verification ceiling
is "typechecks, lints, all pure-logic unit tests pass, `next build` succeeds
with dummy env vars" — exactly the same caveat pattern as Phases 0/4, now
extended to a much larger surface area:

1. **No Server Action or Prisma-backed page has ever executed against a real
   Postgres connection.** Every `prisma.*` call added this phase
   (`taxpayerProfile`/`form16Upload`/`salaryIncome`/`housePropertyIncome`/
   `capitalGainAsset`/`otherSourceIncome`/`deduction`/`taxComputation`
   create/update/delete/findMany/findFirst/`$transaction`) is unverified
   beyond `tsc`'s structural type-checking against the generated Prisma
   client types. In particular: the `$transaction` calls in `saveSection80D`/
   `saveSection80CCD2` (delete-then-recreate), the `deleteMany`-based
   ownership-scoped deletes in `/income` and `/deductions` (`where: { id,
   taxpayerProfileId }` — relies on Postgres actually enforcing this
   correctly), and the `Form16Upload`/`SalaryIncome` upsert-like
   find-then-create-or-update pattern in `confirmForm16Upload` (a real race
   condition is possible here if the same upload were confirmed twice
   concurrently — low risk for a single-user personal app, but genuinely
   unverified either way).
2. **The field-encryption extension's real Postgres round trip** (already
   flagged as the top priority since Phase 4) is now MORE load-bearing than
   before — `/profile` is the first real UI surface that writes/reads
   `TaxpayerProfile.pan`/`.aadhaar`/`.bankAccountNumber` through it.
3. **No Form 16 upload has ever gone through `POST /api/form16/upload`
   against real Vercel Blob storage** — still blocked on a missing
   `BLOB_READ_WRITE_TOKEN`, same as Phase 3. `UploadForm.tsx`'s full
   password-retry flow is untested against a REAL encrypted Form 16 for the
   same reason Phase 3 already flagged (the mocked `decrypt.test.ts` tests
   prove the branching logic, not that a real employer-generated encrypted
   PDF round-trips correctly).
4. **No `next build`-time static/dynamic classification issue was found
   beyond the one fixed** (the `force-dynamic` layout fix) — but this was
   only checked against dummy env vars; a real deploy to Vercel is the next
   real checkpoint.
5. **End-to-end wizard flow (profile -> Form 16 -> income -> deductions ->
   compare -> summary -> filing) has never been clicked through in a real
   browser against a real database.** Every page/action was verified in
   isolation (typecheck + the pure mapping-layer unit tests), not as a
   connected user journey. This is the single most important thing to do
   the moment a real Neon `DATABASE_URL` exists, before treating this phase
   as proven correct rather than "correctly typed and unit-tested in
   isolation."

### Phase 5 adversarial review (2026-07-30)

An independent adversarial review pass was run against Phase 5 (the wizard
UI, the mapping layer, and every `app/(dashboard)/*/actions.ts` Server
Action), started from the 176-tests-green baseline (confirmed via
`npx vitest run` from `apps/web`, plus root `typecheck`/`lint`/`test` and
`next build`, all clean, before touching anything). As with every prior
phase's review, the build agent's own doc comments and PROGRESS.md claims
were treated as a starting point to verify, not ground truth. 177 `apps/web`
tests pass now (1 new, in `test/mapping/taxComputationMapping.test.ts`),
471 tests total repo-wide (up from 470). `tsc --noEmit` clean,
`eslint` clean (same 2 pre-existing React-Compiler warnings on
`CapitalGainForm.tsx`/`HousePropertyForm.tsx`'s `watch()` usage, no new
warnings/errors), `next build` clean, `npx prisma validate`/`generate`/
`format` clean. No live database exists still.

**Priority 1 — the LTA/professional-tax claim: verified TRUE, not a bug.**
Read `packages/tax-engine/src/ay2026-27/fullIncome.ts` and `income.ts` in
full (both the Phase 2 `FullIncomeInput`/`computeFullTaxableIncome` used by
the wizard, and the Phase 1 `Phase1IncomeInput`/`computeTaxableIncomePhase1`
predecessor), plus a repo-wide grep across `packages/tax-engine/src` for
`lta`, `professional.?tax`, `section16`, `17\(1\)`, `10\(5\)` (case-
insensitive) — zero matches anywhere outside comments. Confirmed
independently: neither `FullIncomeInput` nor any function it feeds into has
any input path for LTA exemption, other Section 10 exemptions, or the
Section 16(iii) professional-tax deduction. `grossSalaryIncludingHra` really
is passed through unreduced by `exemptLta`/`exemptOther`/`professionalTax`,
exactly as `toTaxEngineInput.ts`'s `buildHraInput` doc comment claims. This
is a genuine, correctly-documented engine limitation, not a mapping-layer
bug — no fix applied (would require extending `packages/tax-engine`, out of
this review's scope, and out of Phase 5's scope per the existing "Phase
2 tax engine extended" boundary). Still the most likely place a future
session should look first if a salaried user with real LTA exemptions
reports a higher-than-expected computed liability.

**Priority 2 — Server Actions (all five `app/(dashboard)/*/actions.ts`
files read in full):**

- **Ownership scoping**: verified every mutation across `deductions/`,
  `form16/`, `income/`, `profile/`, and `summary/actions.ts`. Every delete
  uses `deleteMany({ where: { id, taxpayerProfileId } })`; every update is
  preceded by a `findFirst({ where: { id, taxpayerProfileId } })` ownership
  check in the same action before the actual `update`/`upsert` call. No
  action ever mutates a row keyed by bare `id` without a taxpayerProfileId
  check having already happened in that same request. Confirmed consistent
  across all 16 exported action functions, not just the ones already known
  to do it right. Also confirmed every one of the 16 calls `requireSession()`
  as its literal first statement (checked via a script, not spot-checked) —
  no gap in the defense-in-depth session check either.
- **`confirmForm16Upload`'s find-then-create-or-update race: confirmed real,
  and fixed.** Traced the exact failure mode: two concurrent confirms of the
  same upload (double-click, or a client retry after a slow network response
  that looked like a failure) could both run `findFirst({ where:
  { form16UploadId: uploadId } })` before either committed its branch, both
  see "no existing row," and both `create` — and
  `SalaryIncome.form16UploadId` had no unique constraint, so nothing at the
  database level would have prevented it. This is not merely a duplicate-row
  annoyance: `lib/mapping/toTaxEngineInput.ts`'s `sumGrossSalary`/
  `buildHraInput` sum **every** `SalaryIncome` row for the taxpayer+AY (by
  design, for genuine multi-employer job-switch support) with no dedup by
  `form16UploadId` — so a duplicate would have silently double-counted that
  employer's salary in every subsequent tax computation, a real financial-
  correctness bug, not just wasted storage. **Fixed**: added `@unique` to
  `SalaryIncome.form16UploadId` in `schema.prisma` (Postgres unique indexes
  permit unlimited NULLs, so manual-entry rows with `form16UploadId: null`
  still coexist freely), regenerated the Prisma client, and rewrote
  `confirmForm16Upload` to use `prisma.salaryIncome.upsert({ where:
  { form16UploadId: uploadId }, create, update })` instead of the find-then-
  branch pattern. This is atomic at the database level (a single `INSERT
  ... ON CONFLICT`) — deliberately not just wrapped in a `$transaction`
  instead, since that would still race under Postgres's default READ
  COMMITTED isolation (both transactions could still each see "no existing
  row" and both insert; only a real unique-constraint conflict, or
  SERIALIZABLE isolation with retry logic, actually closes this). Verified:
  `tsc --noEmit`, `eslint`, all 177 `apps/web` tests, `next build`, and
  `npx prisma validate`/`generate`/`format` all clean after the schema
  change; `npx prisma migrate dev --create-only` still fails only at the
  connection step (`P1001`), confirming the schema itself remains
  structurally valid. **Not verified against a real database** — the
  `upsert`'s actual atomicity under real concurrent Postgres connections is,
  like everything else in this phase, unverified without a live DB; this
  fix raises confidence (removes a demonstrated logical race and adds the DB-
  level constraint that backs it) but doesn't and can't close that gap.
  Note: `profile/actions.ts`'s `saveProfile` (and
  `lib/getOrCreateTaxpayerProfile.ts`'s `getOrCreateTaxpayerProfile`) have
  the *same shape* of find-then-create race for the single `TaxpayerProfile`
  row — **flagged, not fixed**: unlike the SalaryIncome case, the impact is
  bounded to an orphaned duplicate profile row (every read path uses
  `findFirst({ orderBy: { createdAt: "asc" } })`, so the app always
  consistently uses the oldest row and the duplicate is simply ignored, not
  silently double-counted into any tax figure), and the schema's own doc
  comment already documents "not enforced at the schema level ... Phase 5's
  wizard UI is responsible for that" as an accepted design tradeoff for this
  single-tenant app. A real fix would need a different pattern entirely
  (e.g. a fixed singleton id) rather than a cheap unique-constraint add, so
  it wasn't judged worth the scope expansion here — but it's the same class
  of bug, and worth revisiting if this app ever needs multi-request-safe
  profile creation for real.
- **`$transaction` usage in `saveSection80D`/`saveSection80CCD2`**:
  confirmed both already use the atomic array form
  `prisma.$transaction([deleteMany, create, create, ...])`, not sequential
  awaited calls — genuinely atomic, exactly as PROGRESS.md's Phase 5 summary
  claimed. No bug found, no fix needed.

**Priority 3 — mapping-layer correctness: one real bug found and fixed, one
real seed-data/schema-drift bug found and fixed, everything else confirmed
correct.**

- **`enumMaps.ts` exhaustiveness**: confirmed genuinely exhaustive, not just
  claimed to be — the `Record<PrismaEnum, EngineUnion>` types for
  `CapitalAssetType`, `TaxRegime`, and the `HousePropertyType` discriminant
  would fail `tsc --noEmit` if `schema.prisma` ever grew a new enum member
  without a corresponding entry (this is a compile-time guarantee, not
  something that needed re-deriving by hand). `DeductionSection` and
  `OtherSourceType` are deliberately NOT mapped through a `Record` (no
  camelCase engine equivalent exists for these — they're consumed as literal
  string filters in `toTaxEngineInput.ts`, e.g. `section === "SECTION_80D"`),
  which is correct, not an oversight — there is no enum-mapping gap for
  either.
- **`interestIncomeForTtaOrTtb`'s age-branching, re-derived independently
  against `deductions.ts`'s real `computeSection80TtaOrTtb`**: confirmed
  correct — both use the identical `age === "senior" || age === "superSenior"`
  predicate, and the interest-type set (`SAVINGS_INTEREST` only below 60;
  `SAVINGS_INTEREST` + `FIXED_DEPOSIT_INTEREST` + `RECURRING_DEPOSIT_INTEREST`
  at 60+) exactly matches 80TTA/80TTB's real statutory scope. Also confirmed
  the other four `OtherSourceType` enum values (`DIVIDEND`, `FAMILY_PENSION`,
  `LOTTERY_OR_GAME_WINNINGS`, `GIFT`, `OTHER`) are correctly excluded from
  both buckets. No bug found.
- **`taxComputationMapping.ts` cross-checked field-by-field against
  `schema.prisma`'s `TaxComputation` doc comment — found and fixed a real
  bug in `computeGrossTotalIncome`.** The doc comment specifies
  `grossTotalIncome = salaryTaxable + housePropertyContribution +
  otherSourcesIncome + capitalGains.stcgOtherSlabRateIncome +
  capitalGains.totalSpecialRateTaxableIncome`. The actual code instead
  reverse-derived it as `slabTaxableIncomeBeforeRounding +
  deductions.totalDeduction + capitalGains.totalSpecialRateTaxableIncome`
  ("take the already-computed slab total and add the deductions back"). These
  are NOT equivalent whenever `fullIncome.ts`'s `computeFullTaxableIncome`
  floors its pre-rounding slab total at 0 (`Math.max(0, ...)`) — which
  happens whenever salary + house property + other-sources + STCG-other
  income (before Chapter VI-A deductions) is negative. This is a completely
  realistic scenario, not a contrived edge case: a modest-salary taxpayer
  with a large self-occupied home-loan-interest loss set off against other
  heads (up to ₹2,00,000/year, old regime, Section 71(3A)) easily drives the
  pre-deduction slab total negative even with zero Chapter VI-A deductions
  claimed. Confirmed concretely with a constructed scenario (salary ₹1,75,000
  gross / ₹1,25,000 after standard deduction, self-occupied home loan
  interest ₹2,00,000, ₹1,75,000 LTCG-equity gain, old regime, age 30): the
  reverse-derivation returned `grossTotalIncome = ₹1,75,000` while the
  schema-documented formula gives `₹1,00,000` — a ₹75,000 overstatement, silently
  absorbing exactly the amount the floor clamp had discarded. This only
  affects the persisted `TaxComputation.grossTotalIncome` display column
  (never fed back into the actual tax computation, which the engine always
  redoes from scratch), so it's a display-accuracy bug, not a tax-liability
  bug — but it's a real, user-visible wrong number on the `/summary` page for
  anyone in this situation, not a documented simplification. **Fixed**:
  `computeGrossTotalIncome` now sums the five components directly from
  `result.income`'s already-exposed fields (`salaryTaxable`,
  `housePropertyContribution`, `otherSourcesIncome`,
  `capitalGains.stcgOtherSlabRateIncome`,
  `capitalGains.totalSpecialRateTaxableIncome`) instead of reverse-deriving
  from the floored total — matching the schema doc comment exactly, with no
  flooring artifact possible. Regression test added in
  `test/mapping/taxComputationMapping.test.ts` reproducing the exact
  scenario above and asserting the new result is strictly less than what the
  old (buggy) formula would have produced. The pre-existing reconciliation
  test (checking `gross - totalDeduction - totalSpecialRateTaxableIncome ≈
  slabTaxableIncomeBeforeRounding`) still passes unmodified, since it only
  ever exercised the non-floored case.
- **`prisma/seed.ts` found to be stale relative to Phase 5's `metaJson`
  design — fixed.** The seed script (written in Phase 4, before
  `Deduction.metaJson` existed) created a `SECTION_80D` row with no
  `metaJson` at all. `reconstructSection80D` fails safe for exactly this
  case (confirmed via the existing test
  `test/mapping/toTaxEngineInput.test.ts`'s "fails safe (contributes 0) for
  a row with missing/malformed metaJson" case, which explicitly asserts
  `metaJson: null` on a `SECTION_80D` row contributes ₹0) — so running this
  seed script against a real database (the literal next step in this file's
  own "Next steps" list) would have silently dropped the seeded ₹22,000
  health-insurance deduction from every computed tax figure, with no error
  of any kind. Separately, the seed also created a `SECTION_80TTA`
  `Deduction` row — but per Phase 5's design, 80TTA/80TTB are never manually
  entered or read from `Deduction` rows at all (`interestIncomeForTtaOrTtb`
  computes them automatically from `OtherSourceIncome` interest rows), so
  that row was genuinely dead/orphaned fixture data, not double-counted, but
  misleading about how the feature actually works. **Fixed**: added the
  correct `metaJson: { bucket: "selfFamily", isSenior: false }` to the
  80D row (with an inline comment explaining why it's required), and removed
  the vestigial `SECTION_80TTA` row (with a comment explaining that the
  existing `SAVINGS_INTEREST` `OtherSourceIncome` row already supplies this
  automatically). This is exactly the class of bug this review was
  commissioned to find — "a logic bug that would surface the moment a real
  database exists" — caught by reading the seed script against the current
  (Phase 5) mapping-layer contract rather than trusting its Phase-4-era doc
  comments.
- **Everything else in the mapping layer** (`buildFullIncomeInput`'s
  top-level assembly, `toCapitalGainTransactionInput`'s
  `gainAmount`/`holdingPeriodMonths` derivation, `reconstructSection80CCD2`'s
  employment-type/salary-base handling, `sumSectionAmount`,
  `decimalToNumber`, and `lib/loadFullIncomeInput.ts`'s Prisma-touching glue)
  read in full and spot-checked against the real engine types — all correct,
  consistent with the existing 33+4 mapping-layer tests. No further bugs
  found.

**Priority 4 — Form 16 review/confirm safety gate: confirmed intact, no
bugs found.** Read `form16/review/[id]/page.tsx`, `ExtractedFieldsTable.tsx`,
`SalaryIncomeForm.tsx`, `form16/edit/[id]/page.tsx`, and
`confirmForm16Upload`/`updateSalaryIncome` together as one flow:

- `ExtractedFieldsTable` is genuinely read-only (no form inputs of any kind,
  confirmed by reading the full component) — the transparency half of the
  review gate, separate from the editable `SalaryIncomeForm` half.
- `defaultSalaryFromForm16` correctly pre-populates every field that *has* a
  Form 16 source (`grossSalary`, `perquisitesValue`, `exemptHra`/`exemptLta`/
  `exemptOther`, `standardDeduction`, `professionalTax`, `tdsDeducted`) from
  the parsed `ExtractedField<T>.value` when found, 0 otherwise (never a
  guess) — verified against `Form16PartB`'s real field list in
  `packages/pdf-form16/src/types.ts`. `basicSalary`/`hraReceived`/
  `rentPaid`/`isMetroCity` (genuinely not derivable from any Form 16) and
  `ltaReceived`/`otherAllowances` (also genuinely absent from
  `Form16PartB` — only the *exempted* LTA/other amounts are on a Form 16,
  never the raw received amounts) all default to 0/false, but are all
  visible, directly editable, plain input fields in `SalaryIncomeForm` (the
  first three plus `isMetroCity` additionally get an amber-highlighted "not
  on Form 16" callout box; `ltaReceived`/`otherAllowances` are un-highlighted
  but still fully visible and editable in the "Salary & exemptions"
  section) — no field silently reaches `SalaryIncome` bypassing the form the
  user sees.
- `salaryIncomeSchema` (`lib/validation/salaryIncome.ts`) uses `money()`
  (`.min(0, ...)`) on every numeric field — confirmed a negative salary/HRA/
  etc. is rejected by Zod before `confirmForm16Upload`/`updateSalaryIncome`
  ever run, not just clamped downstream by the tax engine.
- `form16/edit/[id]/page.tsx` (the post-confirm edit path) goes through the
  identical `SalaryIncomeForm` + `salaryIncomeSchema` + ownership-scoped
  `findFirst` before rendering — same safety property holds for edits as for
  the initial confirm.

**Priority 5 — validation schemas and masking: no new boundary bugs found;
existing coverage already includes the cases this review specifically went
looking for.** `capitalGainAssetSchema` already has a `.refine()` rejecting
`saleDate < acquisitionDate` (with an explicit same-day-equal test case
already in `test/validation/capitalGain.test.ts`) — the exact check Priority
5 asked to verify exists. `mask.ts`'s `maskValue` already has explicit tests
at the exact `length === keepLast` boundary (fully masked) and
`length === keepLast + 1` (mask exactly one character) for
`maskBankAccountNumber`. `lib/deductionCaps.ts` is confirmed to be a pure
UX-warning layer (`computeChapterVIA` clamps regardless of what's entered,
so no boundary value here can affect the actual computed tax) — read in
full, no bug possible by construction. `profile.ts`'s `dateOfBirth` schema
already rejects a future date. No changes made in this area — the existing
test suite's boundary coverage was more thorough than expected going in.

**Overall confidence**: **Medium-high** for the code that's actually
checkable without a live database — meaningfully higher than before this
review for the specific areas it targeted. Two real, concrete bugs were
found and fixed with regression tests (the `confirmForm16Upload` race,
which had genuine financial-correctness impact via silent salary double-
counting; and the `computeGrossTotalIncome` flooring bug, a real if
display-only wrong number), plus one real seed-script/schema-drift bug
(the missing 80D `metaJson`) that would have silently dropped a deduction
the moment `npx prisma db seed` is finally run for real — exactly the kind
of "logic bug that surfaces the moment a live database exists" this review
was commissioned to find. The Priority 1 LTA/professional-tax claim was
independently verified true, closing out what could have been the highest-
severity finding (a systematic overstatement of every salaried user's tax)
had it turned out to be a mapping-layer oversight rather than a genuine
engine gap. Ownership scoping and `$transaction` atomicity were both
confirmed sound by direct inspection, not assumed. The Form 16 safety gate
and validation-schema boundary cases were both already solid — this pass
found real gaps between what was previously claimed/tested and what the
code actually did, but the *design* of the safety-critical review gate
itself held up. **Not "high," because**: (1) the `upsert`-based race fix,
like every other Prisma-touching change in this and every prior phase, is
unverified against a real Postgres connection — the fix is well-reasoned
and the schema constraint is real, but "does `upsert` actually resolve the
conflict atomically under real concurrent connections against this specific
Neon/Postgres setup" is exactly the class of question this review explicitly
cannot answer; (2) the `saveProfile`/`getOrCreateTaxpayerProfile` race of the
same shape remains unfixed (deliberately, per the reasoning above) — it's a
known, accepted, lower-severity gap, not a clean bill of health; (3) the
sheer surface area of Phase 5 (7 route groups, ~25 files) means this review,
like every prior one, is necessarily a sample of the highest-suspicion
areas (the ones the task specifically flagged plus a full read of every
Server Action) rather than an exhaustive line-by-line audit of every page
component. The single most valuable next step remains unchanged from before
this review: click through the real wizard against a real Neon database the
moment one exists — that will surface an entirely different class of bug
(actual runtime Prisma/Postgres behavior) that no amount of further static
reading can substitute for.

## Phase 6 (ITR JSON export) — done, UNTESTED against a live DB

Built out `packages/itr-schema` (previously placeholder-only) into a real
ITR-1 (Sahaj) / ITR-2 JSON export module for AY 2026-27, plus the
`apps/web` wiring to generate, validate, persist, and download the JSON
from the `/filing` page. **No live Neon database exists yet** — same
blocker as every prior phase touching `apps/web`'s Prisma layer; see "What
still needs live-DB verification" below.

### Step 1: how the real government schema was sourced (read this before trusting the output)

Per the task's explicit instruction to source this live rather than from
memory, the real ITR-1/ITR-2 JSON schemas were fetched directly from
`incometax.gov.in`, not reconstructed from third-party writeups:

- A web search surfaced a direct link into the e-Filing portal's own file
  tree: `incometax.gov.in/iec/foportal/sites/default/files/2026-07/ITR%20
  1_Schema%20change%20document_AY2026-27_V1.1.pdf` (a schema CHANGE
  document, not the schema itself, but confirming the right directory/
  naming convention exists). A follow-up `WebFetch` against the portal's
  downloads page returned (via the fetch tool's own page-content
  summarization, not a raw HTML parse) two specific file paths:
  `/iec/foportal/sites/default/files/2026-06/ITR-1_2026_Main_V1.1.json`
  and `.../ITR-2_2026_Main_V1.1.json`.
- **These exact URLs were then verified directly** (not trusted from the
  fetch summary alone): `curl`'d both from `incometax.gov.in` and got real
  HTTP 200 responses — 148,921 bytes for ITR-1, 390,029 bytes for ITR-2 —
  containing genuine `"$schema": "http://json-schema.org/draft-04/
  schema#"` JSON Schema documents, not an error page or a redirect.
  Vendored verbatim, unmodified, at
  `packages/itr-schema/src/ay2026-27/schema/itr1-schema.json` and
  `itr2-schema.json`.
- **Confidence this is the genuine, current AY 2026-27 government
  schema, not a stale or third-party-reconstructed one**: HIGH.
  Reasoning: (a) fetched directly from the `incometax.gov.in` domain's own
  file path, not a GitHub mirror or vendor blog; (b) the file contents
  themselves carry AY-2026-27-specific literal constants that would be
  wrong for any other year or a generic reconstruction — e.g.
  `Form_ITR1.AssessmentYear`'s required pattern is the literal string
  `"2026"`, and `FilingStatus.ItrFilingDueDate`'s required pattern is the
  literal string `"2026-07-31"` (a genuinely AY-2026-27-specific due date,
  not something a generic schema would hardcode); (c) the schema's own
  embedded `description` fields (e.g. `StateCode`'s "01-Andaman and Nicobar
  islands; 02-Andhra Pradesh; ..." and `CountryCode`'s "93:AFGHANISTAN;
  ...; 91:INDIA; ...") are exactly the kind of obscure, internally
  consistent government codebook detail no LLM would fabricate correctly at
  this length and specificity; (d) the schema's REQUIRED-field shape
  independently corroborates a real, searched-and-confirmed AY 2026-27 law
  change (ITR-1's `PropertyDetails`/income-deduction fields structurally
  support up to two house properties — cross-checked against the AY
  2026-27-specific "up to 2 house properties, up from 1" eligibility change
  found via a separate web search, see `eligibility.ts`'s citations — a
  coincidence this specific between an independently-sourced legal fact and
  the vendored schema's shape would be very unlikely if the schema were
  stale or fabricated). **One honest caveat**: the discovery step (finding
  the exact file URL) went through an AI-summarized fetch of the portal
  page rather than a raw HTML parse — but the file was then independently
  verified byte-for-byte via a direct `curl`, so the actual vendored
  content's authenticity does not depend on trusting that summarization
  step, only on the (verified) fact that this exact URL, on this exact
  domain, returns this exact content.
- Both schemas validated with `ajv-draft-04` (added as a dependency
  alongside plain `ajv`, already a dependency per the original scaffold) —
  plain `ajv` v8's default meta-schemas (draft-07/2019-09/2020-12) reject
  both vendored files outright (`"exclusiveMinimum must be number"`),
  because these are genuine JSON Schema **draft-04** documents (boolean-
  modifier `exclusiveMinimum`/`exclusiveMaximum`, e.g. `{"minimum": 0,
  "exclusiveMinimum": false}`) — confirmed empirically before reaching for
  `ajv-draft-04`, not assumed. This is itself a small piece of corroborating
  evidence: draft-04 is what the actual Income Tax Department schemas are
  historically known to use, not a modern convention an AI-fabricated
  schema would likely pick.

### Step 2: `packages/itr-schema` — what was built

- **`src/jsonSchemaTypes.ts`**: minimal structural typing for the JSON
  Schema draft-04 subset the vendored files use.
- **`src/schemaSkeleton.ts`**: the module that makes mapping to two
  enormous (145KB/380KB), deeply-nested, `additionalProperties: false`
  government schemas tractable. `buildRequiredSkeleton(defs, ref)`
  recursively builds a minimal object satisfying every REQUIRED field
  reachable from a schema node (never touches optional fields — pointless
  under `additionalProperties: false`), filling enum leaves with the
  enum's first value, using a schema's own `default` when present, integers
  with 0, and pattern-constrained strings from a hand-catalogued
  `PATTERN_PLACEHOLDERS` table (an unrecognized pattern throws
  `SchemaSkeletonError` rather than guessing — every pattern actually
  reachable from either schema's required-recursive subtree was catalogued
  by a one-off script before writing this table, and a companion audit
  confirmed neither schema's required-recursive subtree ever contains a
  field whose own type is `array`, so encountering one is also treated as
  an error rather than silently emitting `[]`, which could violate
  `minItems`). `deepMergeOverlay` then layers real, engine-computed data on
  top of this skeleton at the specific paths this app's tax engine actually
  has data for. `roundNumbersDeep`/`compact` round `@cleartax/tax-engine`'s
  paisa-precision figures to whole rupees (every numeric field either
  mapper populates is a whole-rupee `"type": "integer"` field in the real
  schema — confirmed by inspection) and strip `undefined`-valued optional
  keys before merging, respectively.
- **`src/validate.ts`**: `assertValidItr1`/`assertValidItr2`, compiled once
  via `ajv-draft-04` against the real vendored schemas, throwing
  `ItrValidationError` (listing up to 20 specific ajv errors, with a count
  of the rest) on any failure — never returns a "probably fine" result.
  This is the actual enforcement of the task's "never silently emit invalid
  JSON" requirement; both mappers call this as their last step before
  returning.
- **`src/types.ts`**: `ItrExportInput` — the Prisma-independent input type,
  designed the same way `toTaxEngineInput.ts` designed its row shapes.
  Combines `@cleartax/tax-engine`'s own `FullIncomeInput`
  (`TaxComputation.inputSnapshotJson`'s frozen raw input — reused directly
  rather than re-deriving a parallel shape, since it already carries both
  the taxpayer's raw CLAIMED deduction figures and everything needed to
  regenerate the computed result) + `FullTaxLiabilityResult` (the computed
  result, giving both "Usr" claimed and "Deduct" capped Chapter VI-A
  figures the real schema wants) + `ItrTaxpayerProfileInput` (profile
  fields, several — see below — genuinely new) + a required (not optional)
  `otherSourceIncomes` row list, needed specifically because
  `FullIncomeInput.otherSourcesIncome` is a single pre-summed number with
  no source-type breakdown, but ITR-1 eligibility and Schedule OS both need
  to know whether any of it is lottery/game-show winnings (Section 115BB) —
  info the engine-aggregated figure alone can't answer.
- **`src/ay2026-27/eligibility.ts`**: `isEligibleForItr1`, sourced
  2026-07-30 via web search against multiple AY-2026-27-dated sources
  (1finance.co.in, cleartax.in), deliberately not assumed from training
  data — this AY has a real, easy-to-miss rule change (**ITR-1 now allows
  up to TWO house properties, not one** — the historically-correct "one
  property" rule would have been a plausible-looking but wrong assumption,
  flagged explicitly in the file's own header, same spirit as Phase 2's HRA
  metro-city gotcha). Checks: total income ≤ ₹50L, ≤2 house properties, no
  STCG anywhere, no LTCG on non-equity assets, LTCG-112A gain within the
  ₹1,25,000 exemption (zero actual 112A tax), no capital-loss transactions
  (a conservative proxy — flagged in the file header as potentially
  over-disqualifying since this app doesn't track loss carry-forward at
  all), no lottery/game-winnings income. Explicitly documents what it
  CAN'T check (director status, unlisted shares, foreign assets, VDA/crypto
  income, Section 194N TDS) — none of these exist anywhere in this app's
  data model, so the function silently assumes "no" for all of them rather
  than pretending to verify facts it has no way to know.
- **`src/ay2026-27/itr1Mapper.ts`** / **`itr2Mapper.ts`**: build the
  skeleton, overlay real data (personal info via `constants.ts`'s
  `splitName`/`stateNameToCode` — the latter sourced directly from the
  vendored schema's OWN `StateCode` enum `description` string, not a
  third-party state-code list — plus income/deduction/tax figures pulled
  straight from `FullTaxLiabilityResult`), validate, return. `itr1Mapper`
  throws `ItrMappingError` up front (not a confusing ajv error) if called
  on ITR-1-ineligible input. Both files' headers document every scope
  limitation in detail — the three most important, also called out in the
  task's own "confidence" ask:
  1. **ITR-2's `ScheduleCYLA`/`ScheduleBFLA` (loss set-off schedules) are
     populated with the schema's minimal-valid SKELETON ONLY — structurally
     valid, numerically all zero.** The tax engine already nets
     house-property losses internally but exposes no category-by-category
     CYLA/BFLA breakdown to reproduce the department's own apportionment
     schedule. Headline figures (`PartB-TI`/`PartB_TTI`) are correct;
     this specific schedule is not. **The single largest ITR-2 confidence
     gap.**
  2. **Schedule 112A / scrip-wise capital-gains detail is not populated** —
     this app's data model only ever carries a pre-derived net gain per
     transaction (`CapitalGainTransactionInput.gainAmount`), never a
     per-scrip sale-consideration/cost/ISIN breakdown. Aggregate bucket
     totals (what actually drives the tax figures) are correct.
  3. **A genuine, pre-existing `packages/tax-engine` gap surfaced while
     building this mapper**: lottery/game-show winnings
     (`OtherSourceType.LOTTERY_OR_GAME_WINNINGS`) are folded into ordinary
     slab-rate other-sources income by `fullIncome.ts` — the engine has NO
     Section 115BB flat-30%-rate implementation at all. This mapper reports
     such income at face value (matching what the engine actually
     computed) rather than fabricating a 115BB computation the engine never
     performed. A taxpayer with real lottery income gets a JSON whose tax
     figures don't match what the law actually requires. Flagged here and
     in the mapper's own file header; out of scope to fix without touching
     `packages/tax-engine` (forbidden by this phase's scope discipline).
- **`src/registry.ts`**: `ITR_SCHEMA_REGISTRY` (`{"2026-27": {...}}`),
  `getItrMappersForAssessmentYear`, and `mapToItrJson` (picks ITR-1 when
  eligible, else ITR-2) — the version-registry the brief asked for, so a
  future AY is additive (a new `src/ay20XX-XX/` directory + schema files +
  one new registry entry, mirroring `packages/tax-engine`'s own
  `ay2026-27/` convention).
- **63 tests** (`test/schemaSkeleton.test.ts` 16 — including two that
  build a full ITR1/ITR2 skeleton and validate it against the REAL vendored
  schema via `ajv-draft-04` directly; `test/validate.test.ts` 8 — including
  deliberately-broken-output cases: a deleted required field, a wrong type,
  an out-of-list enum value, a malformed PAN, each confirmed to throw
  `ItrValidationError`; `test/ay2026-27/eligibility.test.ts` 13 —
  boundary-value cases at the exact ₹50L threshold, 2-vs-3 house
  properties, the exact ₹1,25,000 LTCG-112A exemption boundary, capital
  losses, lottery income; `test/ay2026-27/itr1Mapper.test.ts` 10,
  `itr2Mapper.test.ts` 7, `registry.test.ts` 6, `index.test.ts` 3 — all
  building real `ItrExportInput`s by running actual `FullIncomeInput`s
  through the REAL `computeFullTaxLiability`, never a hand-typed fake
  result, matching this repo's established testing philosophy). `tsc
  --noEmit` clean.

### Step 3: `apps/web` wiring

- **Schema addition**: `TaxpayerProfile` gained three new nullable columns
  — `email`, `mobileNumber`, `fatherName` — none of which existed anywhere
  in this app's data model before Phase 6 (a genuine gap discovered while
  building the mapper, not anticipated by Phase 4's original design: the
  real ITR JSON's `PersonalInfo.Address` block requires email + mobile, and
  `Verification.Declaration` requires the filer's father's name). Not
  encrypted at rest (not in the same sensitivity class as PAN/Aadhaar/bank
  details, matching `fullName`/`city`/etc.'s existing treatment).
  Deliberately did NOT modify `/profile`'s page/form to collect these —
  per this phase's scope discipline ("do not modify the wizard UI's
  existing pages beyond `/filing`"), a small dedicated form
  (`FilingDetailsForm.tsx`) on `/filing` itself collects them instead,
  shown only when at least one is missing.
- **`lib/mapping/toItrSchemaInput.ts`** (pure, Prisma-row-shape input,
  mirroring `toTaxEngineInput.ts`'s design exactly): `TaxpayerProfileRowForItr`,
  `checkItrProfileCompleteness` (turns "some nullable columns are null"
  into an actionable, human-readable missing-fields list — the single place
  this check lives, so `/filing`'s page, its Server Actions, and its tests
  never duplicate it), `buildItrExportInput` (throws a clear error if
  called on an incomplete profile, per the same "fail loudly, don't
  silently proceed with a fabricated value" principle `@cleartax/itr-schema`
  itself follows).
- **`lib/mapping/enumMaps.ts`**: added `OTHER_SOURCE_TYPE_TO_ITR`, an
  exhaustive `Record<PrismaOtherSourceType, ItrOtherSourceType>` — unlike
  `toTaxEngineInput.ts`'s deliberate choice NOT to map `OtherSourceType`
  through a `Record` (it's used there as a literal string filter, confirmed
  correct in the Phase 5 adversarial review), this crosses into a
  genuinely different package's independently-defined string-union type,
  which is exactly the case an exhaustive map exists for: if either enum
  ever adds a member without a matching update here, `tsc` fails to
  compile instead of silently dropping a value.
- **`lib/loadItrExportInput.ts`** (DB-touching, mirrors
  `lib/loadFullIncomeInput.ts`'s relationship to `toTaxEngineInput.ts`):
  `loadItrExportInputForComputation` re-runs `computeFullTaxLiability` from
  a specific `TaxComputation` row's frozen `inputSnapshotJson` (exactly the
  reproducibility Phase 4 built that column for) rather than trying to
  reconstruct a `FullTaxLiabilityResult` from the flattened
  `TaxComputation` columns, which lost structure (e.g. no per-transaction
  capital-gains breakdown survives in the columns alone).
  `parseInputSnapshot` defensively narrows the JSON at runtime rather than
  blindly casting it.
- **`app/(dashboard)/filing/actions.ts`** (new Server Actions file):
  `saveItrFilingDetails` (validates + persists the three new profile
  fields), `checkItrEligibility` (profile completeness + ITR-1 eligibility,
  read-only), `generateItrJson(taxComputationId, itrTypeOverride?)` — loads
  the export input, determines ITR-1-vs-ITR-2 (defaulting to "ITR-1 if
  eligible, else ITR-2" per the brief, or honoring an explicit taxpayer
  choice; rejects an explicit ITR-1 choice when ineligible rather than
  silently falling back), calls the real mapper (which validates against
  the vendored government schema before ever returning), and only then
  persists an `ItrJsonArtifact` row — an unvalidated payload is never
  written to the database. Every action calls `requireSession()` first,
  matching every other Server Action in this app.
- **`app/api/itr/[id]/download/route.ts`** (new Route Handler): serves a
  persisted `ItrJsonArtifact.jsonPayload` as a downloadable `.json` file —
  this is the actual "always-live deliverable" the brief calls for. Session-
  checked directly (matching `app/api/form16/upload/route.ts`'s existing
  pattern); no further ownership scoping since this is a single-tenant,
  single-credential app (see Phase 0's auth notes) with no second user's
  data to leak.
- **`/filing` page** extended additively (per scope discipline: the ONLY
  wizard page this phase touched): still shows the latest saved
  `TaxComputation` summary unchanged, now also shows `FilingDetailsForm`
  when profile details are incomplete, `GenerateItrSection` (ITR-1/ITR-2
  radio choice — ITR-1 disabled with reasons shown when ineligible,
  "Generate" button, download link on success) once complete, and a history
  list of every previously generated artifact with its own download link.
- **30 new `apps/web` tests**: `test/mapping/toItrSchemaInput.test.ts` (17
  — `checkItrProfileCompleteness` for every individual missing field and
  several combinations, confirms bank details and `addressLine2` are
  correctly NOT required, `buildItrExportInput`'s error-on-incomplete-
  profile behavior, exact field mapping including the null-to-undefined
  distinction for optional fields, and an exhaustive check that all 8
  `OtherSourceType` values map correctly via `OTHER_SOURCE_TYPE_TO_ITR`)
  and `test/validation/itrFilingDetails.test.ts` (13 — email/mobile/
  father's-name boundary and malformed-input cases, mobile-number
  whitespace/dash stripping). **207 `apps/web` tests now** (up from 177),
  **563 tests total repo-wide** (up from 471: +62 in `itr-schema`,
  replacing its 1-test placeholder, +30 in `apps/web`).

### What still needs live-DB verification (same caveat as every prior apps/web phase)

Nothing in this phase's `apps/web` wiring has ever run against a real
Postgres connection — same blocker as Phases 0/4/5. In particular:
`prisma.taxpayerProfile.update` (new `email`/`mobileNumber`/`fatherName`
columns), `prisma.itrJsonArtifact.create`, and the `TaxComputation.
inputSnapshotJson` round-trip through real `jsonb` (assumed to preserve
shape exactly — Prisma's JSON handling for reads/writes was already
exercised structurally in Phase 4/5 but never against a live database) are
all unverified beyond `tsc`'s structural type-checking and this phase's
pure-logic unit tests. `npx prisma format`/`generate`/`validate` all clean;
`npx prisma migrate dev --create-only` was not re-attempted this phase (no
schema-shape reason to expect a different failure mode than Phase 4/5's
already-documented `P1001` connection failure).

### Overall confidence assessment

**High confidence that the vendored schema files are authentic, current
AY 2026-27 government schemas** (see Step 1's sourcing note — this is not
a third-party reconstruction, and the evidence for authenticity doesn't
depend on trusting the discovery step, only the independently-verified
fetched content). **High confidence in the mapper's structural
correctness** — every payload either mapper produces is validated against
the real vendored schema before being returned or persisted, backed by
tests that deliberately break output in several ways and confirm the
validator catches each one, plus two tests that validate a from-scratch
generated skeleton (no real data at all) against the real schema directly.
**Medium confidence in the mapper's numeric/schedule-level FIDELITY to
what the department's own utility would produce for the same data** — the
headline figures (income by head, tax before/after rebate, surcharge,
cess, total liability, refund/payable) are traced directly from
`packages/tax-engine`'s already-adversarially-reviewed output and should
be trustworthy; the three scope limitations documented above (ITR-2's
CYLA/BFLA schedule, Schedule 112A scrip-level detail, and the newly-
discovered Section 115BB lottery-taxation gap in the tax engine itself)
are real, load-bearing gaps versus a professional filing product, not
edge-case trivia. **Consistent with the task's framing**: this JSON is a
downloadable artifact for a human to review carefully before ever
uploading it to the real government portal (this app never files anything
itself, by fixed design — see Phase 7 below) — treat it as a strong,
schema-valid starting point, not a guaranteed-correct final filing,
especially for a taxpayer with capital-gains-heavy or loss-carry-forward
scenarios where the documented gaps are most likely to matter.

### Phase 6 adversarial review (2026-07-30)

Baseline confirmed green first: 563 tests (208 tax-engine + 63 itr-schema +
177+30=207 apps/web + 84 pdf-form16 + 1 filing-provider), `tsc --noEmit`
clean across all workspaces, `eslint` clean (0 errors). Reviewed in priority
order per the task brief; **three real, confirmed bugs found and fixed**,
plus one design pattern independently re-verified as correct-by-consistency
rather than a gap. Final state: **588 tests passing** (+25), typecheck
clean, lint clean (0 errors, same 2 pre-existing React-Compiler warnings on
unrelated files), `next build` compiles successfully (fails only at the
already-documented pre-existing `DATABASE_URL`/`AUTH_SECRET`/etc.
env-var-collection step, same blocker as every prior apps/web phase without
a live DB — not a regression from this review).

#### Priority 1 (highest stakes): the Section 115BB lottery-income gap — assessed, fixed

Confirmed the gap exactly as flagged: `apps/web/lib/mapping/
toTaxEngineInput.ts`'s `sumOtherSourcesIncome` summed EVERY `OtherSourceIncome`
row unconditionally, including `LOTTERY_OR_GAME_WINNINGS`, feeding straight
into `FullIncomeInput.otherSourcesIncome` — taxed at ordinary SLAB rates by
`packages/tax-engine`. Verified the correct treatment via a dedicated web
search (2026-07-30, not assumed from training data, cross-checked against
myitreturn.com, vakilsearch.com, tax2win.in, taxgarden.in, callmyca.com,
sortingtax.com, and — for the surcharge-cap specifics — a search
specifically for the Finance Act's 2nd-proviso-to-section-2(3) text): **flat
30% (Section 115BB), no basic exemption, no Chapter VI-A deductions, no
Section 87A rebate, 4% cess on top (documented ~31.2% effective rate for a
taxpayer otherwise below every surcharge threshold), surcharge CAPPED AT
15%** — the same cap and mechanism as capital gains under 111A/112/112A/
115AD (the 2nd proviso lists 115BB alongside those sections explicitly),
not the taxpayer's ordinary surcharge band. This is a bright-line statutory
rule with no ambiguity, unlike some of the judgment calls flagged in
earlier phases' capital-gains work.

**Assessed as a clean, small, surgical fix (the exact shape the task
anticipated: a new special-rate income bucket handled outside the slab
pipeline, following the capital-gains precedent exactly) and implemented**:

- **`packages/tax-engine/src/ay2026-27/fullIncome.ts`**: added
  `FullIncomeInput.lotteryOrGameWinningsIncome?: number` (optional, defaults
  to 0 — every pre-existing fixture/caller keeps compiling and behaving
  identically), excluded from `slabTaxableIncome` entirely (so Chapter VI-A
  deductions structurally never touch it — no special-case code needed,
  it falls out of the formula), included in `totalIncome` (so it correctly
  affects the Section 87A eligibility threshold and surcharge band for the
  REST of the taxpayer's income, same as capital gains).
- **`packages/tax-engine/src/ay2026-27/computeTaxFull.ts`**: added
  `LOTTERY_TAX_RATE_PERCENT = 30` and a flat-tax computation
  (`lotteryTaxBeforeSurcharge`), never passed through `computeRebate`
  (non-rebatable by construction, matching the capital-gains pattern
  exactly), surcharge computed via `Math.min(slabSurcharge.applicableRate *
  100, CAPITAL_GAINS_SURCHARGE_CAP_PERCENT)` — reusing the existing
  capital-gains 15%-cap constant rather than duplicating it, since it's
  genuinely the same statutory cap. Added to the cess base and grand total
  the same way capital-gains tax already was. `capitalGains.ts`'s file
  header updated to document that the reused constant now also covers
  115BB, with its own citation.
- **10 new tests** in `packages/tax-engine/test/lotteryIncome.test.ts`:
  flat 30% with no basic exemption (a ₹1,00,000 pure-lottery scenario that
  would owe ₹0 under slab treatment owes ₹31,200 — matching the
  independently-documented "31.2% effective rate" figure exactly, a strong
  correctness signal), no 87A rebate even when the taxpayer's slab income
  alone would be fully rebated, surcharge capped at 15% even when the
  taxpayer's total-income band is 25%/37%, Chapter VI-A deductions never
  reduce it, negative input floored at 0, omitted field defaults to 0, and
  a mixed capital-gains + lottery scenario confirming both special-rate
  buckets are independently non-rebatable and additive.
- **Downstream wiring fixed** (justified as directly required to fix this
  bug's real consequences, not scope creep — the task's own scope
  discipline explicitly carves out "confirmed correctness bug" as the
  exception):
  - `apps/web/lib/mapping/toTaxEngineInput.ts`: `sumOtherSourcesIncome` now
    EXCLUDES `LOTTERY_OR_GAME_WINNINGS`; new `sumLotteryOrGameWinningsIncome`
    routes it to the new engine field. 5 new tests.
  - `apps/web/lib/mapping/taxComputationMapping.ts`: `computeGrossTotalIncome`
    and the flattened `surcharge` column both updated to include lottery
    income/surcharge — otherwise the `/summary` page's displayed gross
    income and surcharge would have silently UNDER-reported a lottery-income
    taxpayer's real figures even after the engine fix. (Deliberately did
    NOT add a dedicated `lotteryTax` column to `TaxComputation` — the
    aggregate `totalTaxLiability`/`grossTotalIncome`/`surcharge` columns are
    now all correct, and adding a UI-visible breakdown line would mean
    touching the `/summary` page, out of this review's scope. Flagged below
    as a minor follow-up, not a correctness gap.) 1 new test.
  - `packages/itr-schema/src/ay2026-27/itr2Mapper.ts`: this is where fixing
    the engine's numbers alone would NOT have been enough — the mapper's
    own Schedule OS / Schedule SI / PartB-TI wiring needed the matching
    fix, or the generated JSON would have become INTERNALLY INCONSISTENT
    (e.g. `otherSourcesIncome` now correctly excludes lottery at the engine
    level, but the mapper was still reading `IncChargblSplRate` as a
    hardcoded 0 — meaning lottery income would have silently vanished from
    `PartB-TI.IncFromOS` entirely instead of showing up as special-rate
    income). Fixed: `IncChargblSplRate` now carries the real lottery
    figure (was hardcoded 0 — a second, independent bug this same pass
    caught), `specialRateTaxableIncome`/`taxAtSpecialRates`/`totalSurcharge`
    all now sum capital-gains AND lottery components, `ScheduleSI`'s totals
    follow automatically. **`itr1Mapper.ts` needed no numeric changes**
    (lottery income unconditionally disqualifies ITR-1 via `eligibility.ts`,
    so it's always 0 for ITR-1-eligible input) but got a defensive guard —
    `mapToItr1` now throws `ItrMappingError` if somehow called with nonzero
    115BB tax, mirroring the existing surcharge guard, since
    `ITR1_TaxComputation` has no field to report it in. 5 new tests
    (4 in `itr2Mapper.test.ts`, 1 in `itr1Mapper.test.ts`), including one
    that validates a real lottery-income payload against the REAL vendored
    ITR-2 schema end to end.
  - **A second, independent, pre-existing bug found while wiring this up**:
    `ScheduleOS.IncFrmLottery` (and every `DividendIncUs115*`/
    `DividendDTAA`/`NOT89A` field) is a `DateRangeType` object (quarterly
    breakdown, for Section 234C purposes) in the real vendored schema, NOT
    a plain number — the mapper was assigning bare numbers (including
    literal `0`s) to all of them. This was completely latent: every
    pre-existing test fixture had an empty `otherSourceIncomes` list, so
    `ScheduleOS` itself was never exercised against the real schema by any
    test before this review added one that populates it. Fixed via a new
    `buildDateRange(totalAmount)` helper; the lottery amount (this app
    doesn't track receipt date, so there's no way to attribute it to a
    specific quarter) is placed in the last quarter (`Up16Of3To31Of3`) as a
    documented, conservative judgment call — flagged, not silently guessed,
    and inert either way since this app doesn't compute Section 234C
    interest at all (already-documented `TotIntrstPay: 0`).

**Confidence in this fix**: HIGH. The 30%/no-exemption/no-deduction/
no-rebate specifics and the 15%-surcharge-cap-extends-to-115BB claim were
both independently web-verified (not assumed), the fix follows an
already-adversarially-reviewed precedent (capital gains) field-for-field,
every new code path has a regression test, and the ITR-2 JSON output for a
lottery-income scenario was validated end-to-end against the real
government schema. **Not fixed / flagged**: no dedicated `lotteryTax`
column on `TaxComputation` for a future `/summary`-page breakdown line (see
above — correctness is unaffected, this is a display-granularity nit).

#### Priority 2: ajv validation actually catches invalid output — confirmed solid, coverage strengthened

Read `validate.ts` in full: `ajv-draft-04`, `strict: false`, `allErrors:
true`, compiled once per schema, throws `ItrValidationError` (never returns
a boolean the caller could ignore). The existing `validate.test.ts` already
had good negative coverage (deleted required field, wrong type, out-of-enum
value, malformed PAN, empty payload) — but **every one of those deliberately
broke ITR-1 output only**; there was no negative test at all for the much
larger ITR-2 schema (390KB vs. 145KB, and the form most taxpayers with any
capital gains/lottery income will actually get). Ran a scratch check (5
throwaway tests, then folded the 3 most valuable into the permanent suite,
deleted the rest): confirmed `assertValidItr2` correctly throws on (a) a
deleted required top-level schedule, (b) an unexpected extra field
(`additionalProperties: false` is genuinely enforced, not silently
ignored), (c) a value below its schema minimum, (d) a deleted nested
required sibling field inside `ScheduleSI` (confirms `$ref` resolution
reaches nested definitions correctly, not just the top level). All five
scratch checks passed on the first try — **no bug found**, wiring is
correct. 3 new permanent tests added to `validate.test.ts`.

#### Priority 3: schema-skeleton generator — one real fabrication bug found and fixed

Read `schemaSkeleton.ts` in full, then empirically audited it: built full
ITR-1 and ITR-2 skeletons with `buildRequiredSkeleton` (no overlay at all)
and enumerated every non-zero/non-empty leaf value produced. Cross-checked
each one against whether the corresponding mapper (`itr1Mapper.ts`/
`itr2Mapper.ts`) actually overlays it with real data unconditionally in
every code path.

**Found one real bug**: `PartB_TTI.Refund.BankAccountDtls.BankDtlsFlag` is
a required field whose real schema `default` is `"Y"`. `itr2Mapper.ts`'s
`bankAccountDtls` construction only ever set `AddtnlBankDetails` when the
taxpayer had bank details on file, and fell back to a bare `{}` when they
didn't — `deepMergeOverlay(skeleton, {})` leaves the skeleton's own default
value completely untouched. Net effect: **a taxpayer who never entered bank
details (an entirely ordinary case) would get a generated ITR-2 JSON that
falsely claims `BankDtlsFlag: "Y"` — "yes, bank details are provided" —
with no actual bank details anywhere in the payload.** This is exactly the
failure mode Priority 3 was checking for: not an obviously-fake 0/"", but a
plausible-looking, schema-valid, WRONG value that a user could upload
without noticing. Fixed: both branches of `bankAccountDtls` now set
`BankDtlsFlag` explicitly (`"Y"` when populated, `"N"` when not), so the
skeleton's default is never allowed to silently survive. 2 new regression
tests (one per branch), both validated against the real schema.

Also checked the ITR-1 equivalent: ITR-1's `BankAccountDtls` definition has
NO required fields at all (no `BankDtlsFlag` concept there), so ITR-1 was
never affected — confirmed by inspection, not assumed.

Every other skeleton-only leaf surfaced by the audit (state/country code
enum first-values, Y/N flags, PAN/email pattern fallbacks, the vendor-code
placeholder, etc.) was confirmed to be unconditionally overlaid with real
data by the mapper in every code path that can actually be reached with a
complete `ItrExportInput` — none of the rest are fabrication risks in
practice. Every genuinely-skeleton-only field that CAN reach production
output (the parts of the schema this app truly has no data for — foreign
assets, AMT, ESOP deferral, etc.) resolves to an unambiguous 0/""/"-",
consistent with the file's own stated design goal.

#### Priority 4: download route authorization — confirmed correct, consistent with the rest of the codebase

Read `app/api/itr/[id]/download/route.ts` in full. Session-checked directly
via the cookie + `verifySessionToken`, matching the established
`app/api/form16/upload/route.ts` pattern (not relying on `proxy.ts` alone).
Does NOT scope the `ItrJsonArtifact` lookup by `taxpayerProfileId` — but
verified this is genuinely consistent with every other DB-touching Server
Action in this codebase, not a one-off gap: `app/(dashboard)/filing/
actions.ts`'s `generateItrJson` and `checkItrEligibility` both use the same
bare `prisma.taxComputation.findUnique({ where: { id } })` pattern with no
ownership scoping either. `lib/getOrCreateTaxpayerProfile.ts` confirms why
this is safe: exactly ONE `TaxpayerProfile` row is ever meant to exist
app-wide (a documented, enforced single-tenant invariant — see that file's
own doc comment), so there is genuinely no second taxpayer's data any ID
could ever resolve to. No bug, no change made.

#### Priority 5: eligibility routing and mapper correctness — re-verified, no bugs found

`eligibility.test.ts` already had strong boundary coverage before this
review: exact ₹50,00,000 threshold (both sides, accounting for Section
288A's nearest-₹10 rounding), exactly 2 vs. 3 house properties, the exact
₹1,25,000 LTCG-112A exemption boundary (both sides), capital-loss
disqualification, and lottery-income disqualification — matching what the
task suggested probing for. Independently re-verified the AY 2026-27
"ITR-1 now allows up to TWO house properties" claim via a fresh web search
(2026-07-30): confirmed via 1finance.co.in, cleartax.in, upstox.com, and
others, all citing the same 30 March 2026 CBDT notification; the ₹50L
total-income limit is confirmed unchanged, and the ₹1,25,000 Section 112A
carve-out for staying on ITR-1 is confirmed current. No discrepancy found
between the code's citations and fresh sources — the claim holds.

One minor, low-stakes documentation nit noticed but NOT fixed (not a
functional bug — nothing behaves incorrectly): `ITR1_AGRICULTURAL_INCOME_LIMIT`
is exported with its own inline comment ("not modeled anywhere in this
app") but is never referenced in `isEligibleForItr1`'s body, and the file
header's bullet list presents "Agricultural income up to ₹5,000 only" as an
enforced rule without the same explicit "this function can't actually check
this" callout the OTHER unmodeled conditions (director status, foreign
assets, etc.) get one paragraph later. Cosmetic only; flagged for a future
docs pass rather than touched here.

#### Overall confidence assessment for this review

**High confidence** the highest-stakes finding (Section 115BB) is now
correctly fixed end-to-end — engine, mapping layer, and ITR-2 JSON export
all agree, backed by tests that verify against the real government schema,
not just internal consistency. **High confidence** in the validation
wiring (Priority 2) and the skeleton generator's honesty (Priority 3, after
the one fix). **High confidence** the download route and eligibility logic
(Priorities 4-5) were already correct. This review found bugs the same way
every prior phase's review did: by constructing adversarial/negative cases
rather than trusting the happy path, and by tracing a fix's consequences
all the way through to the actual JSON bytes a taxpayer would upload,
not just the tax-engine numbers. 588 tests passing (up from 563), typecheck
and lint both clean, `next build` compiles (env-var collection failure only,
pre-existing and expected without a live DB).

## Next steps (pick up here)

1. **Waiting on the user** for a GitHub repo (+ push access) and a Neon
   connection string. Once shared: push the repo, confirm CI goes green for
   real, then run `npx prisma migrate dev --name init_data_model` against
   the REAL Phase 4 schema (no longer the `AppMeta` placeholder — that was
   removed in Phase 4) to prove the Neon adapter path works end-to-end,
   review the generated migration SQL once, then run `npx prisma db seed`
   and confirm the field-encryption extension round-trips PAN/Aadhaar/bank
   data correctly against a real Postgres instance (see Phase 4's "Not
   tested" notes above — this is the single most important thing to verify
   for real the moment a DB exists). Not blocking further phases — all
   remaining phases through Phase 7 are pure code with no external account
   dependency.
2. ~~Get an adversarial review pass on `packages/tax-engine`~~ — done (Phase
   1 scope), see "Phase 1 adversarial review" above. No bugs found.
3. ~~Recommend an adversarial review pass on Phase 2~~ — done, see "Phase 2
   adversarial review" above. One real bug found and fixed (grandfathered-
   property indexed gain leaking into `totalIncome`). Before this module is
   trusted for a user with a self-occupied home loan whose purpose isn't
   plain acquisition/construction completed within 5 years, revisit
   simplification #3 (₹30,000 vs ₹2,00,000 interest cap) — it's the one gap
   that can understate tax owed rather than overstate it.
4. ~~Start Phase 3~~ — done, see "Phase 3 (Form 16 PDF parsing pipeline)"
   above. ~~Get an adversarial review pass on it~~ — done, see "Phase 3
   adversarial review" above. 4 more real bugs found and fixed (a
   `totalTaxByEmployer` label collision picking an intermediate figure
   instead of the final one, an unbounded-wildcard `exemptionHra`
   collision, a `receiptNumber` blank-field misattribution into the
   adjacent BSR code, and a `derivePanDobPassword` silent-invalid-date
   bug). `exemptionLta`'s bare-keyword fallback is flagged as the most
   likely remaining fragility if this ever needs another pass, along with
   testing the decrypt path against a real password-protected Form 16 if
   the user ever supplies one.
5. ~~Start Phase 4~~ — done, see "Phase 4 (data model + persistence)" above.
   Full Prisma schema landed (`TaxpayerProfile`, `Form16Upload`,
   `SalaryIncome`, `HousePropertyIncome`, `CapitalGainAsset`,
   `OtherSourceIncome`, `Deduction`, `TaxComputation`, `ItrJsonArtifact`,
   `FilingAttempt`, replacing `AppMeta`), AES-256-GCM field encryption
   extension for PAN/Aadhaar/bank fields, seed script written.
   ~~Get an adversarial review pass on it~~ — done, see "Phase 4 adversarial
   review" above. Two real bugs found and fixed (a dead-code base64
   validation gap in `loadKey()` that could silently accept a
   corrupted/mistyped encryption key, and missing `createManyAndReturn`/
   `updateManyAndReturn` handlers that could have let plaintext PII reach
   Postgres) plus a doc-comment inaccuracy corrected in `schema.prisma`; 39
   `apps/web` tests now (was 29), 333 repo-wide. **Migrations and the
   encryption extension's real-DB round trip remain untested** — no live
   Neon connection exists yet (see Phase 4's "Not done / deferred" and the
   adversarial review's confidence assessment above); this is still the top
   item once the user shares Neon credentials (step 1 above). Also flagged,
   not fixed: a cascade-delete ordering risk between `TaxpayerProfile` →
   `ItrJsonArtifact`/`FilingAttempt` that only matters once a whole-profile-
   delete feature exists (none does yet) — test against the real DB then.
6. ~~Start Phase 5~~ — done, see "Phase 5 (wizard UI)" above. All seven
   wizard steps built (`profile`/`form16`/`income`/`deductions`/
   `regime-comparison`/`summary`/`filing`), the enum/shape mapping layer
   (`lib/mapping/toTaxEngineInput.ts` + `lib/loadFullIncomeInput.ts`) built
   and thoroughly unit-tested (33 tests, including real-engine end-to-end
   assemblies), 176 new `apps/web` tests (470 total repo-wide). One schema
   addition (`Deduction.metaJson`, justified and documented). ~~No
   adversarial review pass has been run on this phase yet~~ — done, see
   "Phase 5 adversarial review" above. Three real bugs found and fixed (the
   `confirmForm16Upload` race condition, now closed with a `@unique`
   constraint + `upsert`; a `computeGrossTotalIncome` flooring bug that
   overstated the persisted display-only gross-total-income figure; and a
   stale `prisma/seed.ts` that would have silently dropped its seeded 80D
   deduction the moment the seed script is finally run for real), plus the
   Priority-1 LTA/professional-tax gap independently confirmed as a genuine
   engine limitation rather than a mapping-layer bug. 177 `apps/web` tests
   now, 471 repo-wide. Medium-high confidence — see that section's full
   assessment for what's still unverifiable without a live database
   (chiefly: does the new `upsert` actually resolve the race atomically
   against real concurrent Postgres connections, and the
   `saveProfile`/`getOrCreateTaxpayerProfile` single-profile race of the same
   shape, flagged but deliberately left unfixed).
7. ~~Start Phase 6~~ — done, see "Phase 6 (ITR JSON export)" above. Real
   ITR-1/ITR-2 JSON schemas vendored from `incometax.gov.in` directly (not
   a third-party reconstruction — see Phase 6's sourcing note for exactly
   how and the confidence assessment), `packages/itr-schema` built out with
   a schema-skeleton generator, ITR-1 eligibility check (including a real
   AY 2026-27 rule change — 2 house properties now allowed, not 1),
   ITR-1/ITR-2 mappers validated against the real schema via `ajv-draft-04`,
   and a version registry. `apps/web` wiring: three new `TaxpayerProfile`
   columns (email/mobileNumber/fatherName — a genuine data-model gap
   discovered while building this), a small `/filing`-only form to collect
   them, `generateItrJson`/`checkItrEligibility` Server Actions, a download
   route, and a history list of generated artifacts. 63 new `itr-schema`
   tests + 30 new `apps/web` tests, 563 tests total repo-wide (up from
   471). A genuine pre-existing `packages/tax-engine` gap was discovered
   in the process (Section 115BB lottery/game-winnings income isn't taxed
   at its special flat rate — folded into ordinary slab income instead) —
   flagged prominently, not fixed here (out of this phase's scope
   discipline). **Next**: start Phase 7 (filing provider stub — the mock-
   only ERI/GSP simulation, `packages/filing-provider`, still
   placeholder-only). No adversarial review pass has been run on Phase 6
   yet — worth doing before this module is trusted, same as every prior
   phase, particularly re-checking the `ScheduleCYLA`/`ScheduleBFLA`
   skeleton-only gap and the eligibility check's capital-loss proxy logic.

## Phase checklist (from the approved plan)

- [~] Phase 0 — Scaffold (core done; GitHub/Neon wiring pending user input)
- [x] Phase 1 — Tax engine core + tests (adversarial review pass complete, no bugs found)
- [x] Phase 2 — Tax engine extended (HRA, house property, capital gains, deductions, regime compare) — adversarial review pass complete, see "Phase 2 adversarial review"; one bug fixed, ₹30,000 self-occupied-interest-cap gap flagged as highest remaining priority
- [x] Phase 3 — Form 16 parsing pipeline (built and tested, 3 real parser bugs found/fixed during the original build; adversarial review pass complete, see "Phase 3 adversarial review" — 4 more real bugs found/fixed, 84 tests total)
- [~] Phase 4 — Data model + persistence (schema, encryption extension, seed script all done; adversarial review pass complete, see "Phase 4 adversarial review" — 2 real bugs found/fixed (dead-code base64 key validation, missing createManyAndReturn/updateManyAndReturn handlers), 1 doc-comment fix, cascade-ordering risk flagged; migrations + encryption extension's real-Postgres round trip still UNTESTED — no live Neon connection yet)
- [x] Phase 5 — Wizard UI (all 7 steps built — profile, Form 16 upload/review, income, deductions, regime comparison, summary, filing stub; mapping layer built and unit-tested, 177 apps/web tests, 471 total repo-wide; adversarial review pass complete, see "Phase 5 adversarial review" — 3 real bugs found/fixed (confirmForm16Upload race + @unique constraint, computeGrossTotalIncome flooring bug, stale seed.ts metaJson gap), LTA/professional-tax gap confirmed as genuine engine limitation not a bug; UNTESTED end-to-end against a live database/Blob storage)
- [x] Phase 6 — ITR JSON export (`packages/itr-schema` built out: real vendored AY 2026-27 ITR-1/ITR-2 government schemas, schema-skeleton generator, ITR-1 eligibility check, both mappers validated via `ajv-draft-04`, version registry; `apps/web` wiring on `/filing` — new profile fields, generate/download flow, artifact history; 563 tests repo-wide; see "Phase 6" above for the full sourcing/confidence writeup and documented scope gaps (ScheduleCYLA/BFLA skeleton-only, no Schedule 112A scrip detail, a newly-found tax-engine Section 115BB gap); no adversarial review pass yet, UNTESTED against a live database)
- [ ] Phase 7 — Filing provider stub
- [ ] Phase 8 — Deploy to Vercel
- [ ] Phase 9 — End-to-end QA pass (also where Playwright/e2e tests deferred from every DB-blocked phase, including this one, should finally be written)
