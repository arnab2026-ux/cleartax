/**
 * The `FilingProvider` interface per the approved plan, plus the request/
 * result shapes it uses — designed the same way `packages/itr-schema`'s
 * `types.ts` and `apps/web/lib/mapping/toTaxEngineInput.ts` design their
 * types: plain, framework-agnostic data shaped so the Prisma-touching glue
 * in `apps/web` (see `app/(dashboard)/filing/actions.ts`) can persist a
 * result onto a `FilingAttempt` row with no awkward translation layer.
 *
 * **Fixed project-wide boundary (see PROGRESS.md's Phase 7 section and the
 * `schema.prisma` `FilingProvider` enum's own doc comment): this app NEVER
 * gets real ERI/GSP government submission.** The Income Tax Department's
 * e-filing API is only available to registered ERI/GSP partners; this
 * project deliberately never attempts real submission. This interface
 * exists so a real implementation COULD be wired in later by someone with
 * actual credentials — but `./mockFilingProvider.ts` is the only
 * implementation this codebase will ever contain.
 *
 * DESIGN NOTE on the Prisma mapping: `FilingStatusValue` is intentionally
 * the exact same string union as `schema.prisma`'s `FilingStatus` enum
 * (SUBMITTED/ACKNOWLEDGED/VERIFIED/FAILED) — not a superset with an extra
 * in-between state like "PROCESSING" — precisely so a caller never needs an
 * enum-to-enum translation table (the class of bug
 * `apps/web/lib/mapping/enumMaps.ts`'s `OTHER_SOURCE_TYPE_TO_ITR` exists to
 * guard against elsewhere in this repo). `submitReturn`'s result maps
 * directly onto `FilingAttempt.acknowledgementNumber`/`.status`/
 * `.statusHistoryJson` at `create` time; `checkStatus`/`eVerify`'s results
 * each carry a single `FilingStatusEvent` a caller appends to the existing
 * `statusHistoryJson` array at `update` time.
 */

/** Mirrors `schema.prisma`'s `FilingStatus` enum exactly — see this file's header for why no additional in-between states exist here. */
export type FilingStatusValue = "SUBMITTED" | "ACKNOWLEDGED" | "VERIFIED" | "FAILED";

/** Mirrors the two e-verification methods the real portal offers for individual taxpayers (the only ones this app's UI needs to simulate). */
export type EVerifyMethod = "AADHAAR_OTP" | "NET_BANKING";

/**
 * One entry in a `FilingAttempt.statusHistoryJson` array
 * (`[{ status: "SUBMITTED", at: "2026-07-30T..." }, ...]` per that column's
 * doc comment) — `detail` is an extra, human-readable field this package
 * adds; harmless extra JSON, not read by anything that assumes the doc
 * comment's minimal shape.
 */
export interface FilingStatusEvent {
  status: FilingStatusValue;
  /** ISO 8601 timestamp. */
  at: string;
  /** Human-readable description of this event, always makes clear the event is simulated. */
  detail: string;
}

/**
 * Everything `submitReturn` needs to know about the return being filed,
 * beyond the JSON payload itself. Deliberately minimal — this app already
 * has `itrJsonArtifactId`/`taxpayerProfileId` on the caller's side (it's
 * the one creating the `FilingAttempt` row), so this only carries fields a
 * filing provider genuinely needs to process the submission.
 */
export interface FilingMeta {
  /** e.g. "2026-27". */
  assessmentYear: string;
  itrType: "ITR1" | "ITR2";
}

/** Result of a successful `submitReturn` call — maps directly onto a new `FilingAttempt` row's `acknowledgementNumber`/`status`/`statusHistoryJson` (as `[statusHistory[0]]` is already a valid `statusHistoryJson` value). */
export interface FilingSubmissionResult {
  acknowledgementNumber: string;
  status: FilingStatusValue;
  statusHistory: FilingStatusEvent[];
}

/** Result of a `checkStatus` call. `event` is meant to be appended to an existing `FilingAttempt.statusHistoryJson` array by the caller. */
export interface FilingStatusResult {
  acknowledgementNumber: string;
  status: FilingStatusValue;
  event: FilingStatusEvent;
}

/** Result of an `eVerify` call. `success: false` means the simulated e-verification did not go through (e.g. the mock provider hasn't "acknowledged" the return yet) — the caller should show `event.detail` to the user, not treat it as a thrown error. */
export interface EVerifyResult {
  acknowledgementNumber: string;
  success: boolean;
  status: FilingStatusValue;
  event: FilingStatusEvent;
}

/**
 * The filing-provider contract itself, per the approved plan. A real
 * implementation (never built in this codebase — see file header) would
 * back these with actual ERI/GSP API calls; `./mockFilingProvider.ts` backs
 * them with pure, local, deterministic simulation.
 */
export interface FilingProvider {
  submitReturn(itrJson: unknown, meta: FilingMeta): Promise<FilingSubmissionResult>;
  checkStatus(acknowledgementNumber: string): Promise<FilingStatusResult>;
  eVerify(acknowledgementNumber: string, method: EVerifyMethod): Promise<EVerifyResult>;
}
