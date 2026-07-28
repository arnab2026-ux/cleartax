# Progress

Read this file first in every session. Update it last, every session — this is
the resumability mechanism across token limits and separate sessions. See the
approved plan at the top of the repo history / conversation for full context;
this file tracks living state only.

## Current status: Phase 2 (tax engine extended) done, Phase 0 external setup pending

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

## Next steps (pick up here)

1. **Waiting on the user** for a GitHub repo (+ push access) and a Neon
   connection string. Once shared: push the repo, confirm CI goes green for
   real, run `npx prisma migrate dev` against the placeholder schema to prove
   the Neon adapter path works end-to-end, then remove the `AppMeta`
   placeholder model when Phase 4 lands the real schema. Not blocking further
   phases — all remaining phases through Phase 7 are pure code with no
   external account dependency.
2. ~~Get an adversarial review pass on `packages/tax-engine`~~ — done (Phase
   1 scope), see "Phase 1 adversarial review" above. No bugs found.
3. Recommend an adversarial review pass on Phase 2 specifically, focused on
   the 5 items in "Uncertain / flagged for review" above — especially #1
   (combined marginal relief) and #2 (capital-loss set-off), which are the
   two most likely to matter for a real user's numbers being off by a
   material amount rather than just an edge case.
4. Start **Phase 3**: Form 16 parsing pipeline.

## Phase checklist (from the approved plan)

- [~] Phase 0 — Scaffold (core done; GitHub/Neon wiring pending user input)
- [x] Phase 1 — Tax engine core + tests (adversarial review pass complete, no bugs found)
- [x] Phase 2 — Tax engine extended (HRA, house property, capital gains, deductions, regime compare) — see "Uncertain / flagged for review" for what a follow-up pass should target
- [ ] Phase 3 — Form 16 parsing pipeline
- [ ] Phase 4 — Data model + persistence
- [ ] Phase 5 — Wizard UI
- [ ] Phase 6 — ITR JSON export
- [ ] Phase 7 — Filing provider stub
- [ ] Phase 8 — Deploy to Vercel
- [ ] Phase 9 — End-to-end QA pass
