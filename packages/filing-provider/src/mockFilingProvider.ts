/**
 * The only concrete `FilingProvider` implementation this codebase will ever
 * contain (see `types.ts`'s file header for the hard project-wide
 * boundary). **This file makes zero network calls of any kind** — no
 * `fetch`, no `XMLHttpRequest`, no `child_process`, no dependency on any
 * HTTP/networking package. Every export below is a plain, synchronous,
 * pure computation wrapped in a resolved Promise purely to satisfy the
 * `FilingProvider` interface's async shape (matching what a real
 * network-backed implementation would look like) — grep this file for
 * "fetch" or "http" if that ever needs re-confirming; neither should match
 * anything but this comment.
 *
 * STATE MACHINE
 * -------------
 * This provider is stateless (no module-level mutable state, no database,
 * no in-memory store) — every method derives its answer purely from its
 * arguments and the real wall-clock (`Date.now()`), which is what makes a
 * multi-call progression possible without persisting anything here (the
 * caller, `apps/web`'s `FilingAttempt` row, is the actual source of truth
 * for what's already happened).
 *
 *   submitReturn()              -> status "SUBMITTED", ack number encodes
 *                                   the real submission timestamp.
 *   checkStatus(ack)            -> decodes that timestamp; once
 *                                   `ACKNOWLEDGEMENT_DELAY_MS` of real time
 *                                   has passed since submission, reports
 *                                   "ACKNOWLEDGED" (simulating mock-CPC
 *                                   receipt processing), otherwise still
 *                                   "SUBMITTED". An unrecognized ack number
 *                                   (wrong format) reports "FAILED".
 *   eVerify(ack, method)        -> re-derives the current status via
 *                                   checkStatus(); succeeds (-> "VERIFIED")
 *                                   only once the mock has reached
 *                                   "ACKNOWLEDGED" or later, otherwise
 *                                   returns `success: false` with an
 *                                   explanatory event (not an error — a
 *                                   normal, expected outcome when a user
 *                                   tries to e-verify too soon).
 *
 * Once a caller has recorded "VERIFIED" (via `eVerify`) in its own
 * persisted `FilingAttempt.status`, it should stop calling `checkStatus`
 * for that acknowledgement number — `checkStatus` only ever reports
 * "SUBMITTED" or "ACKNOWLEDGED" for a well-formed ack number (it has no way
 * to remember a later `eVerify` call happened, being stateless by design),
 * so re-calling it after verification would incorrectly appear to regress
 * the status. This mirrors how `apps/web`'s Server Actions actually use
 * this package — see `app/(dashboard)/filing/actions.ts`.
 */
import type { EVerifyMethod, EVerifyResult, FilingMeta, FilingProvider, FilingStatusEvent, FilingStatusResult, FilingStatusValue, FilingSubmissionResult } from "./types";

/**
 * Real ITR-V acknowledgement numbers are 15 plain digits (verified via web
 * search 2026-07-30, e.g. a real published example: "531951460281123" — a
 * 15-digit number combining assessment year, a sequence number, and the
 * filing date, per the Income Tax Department's own ITR-V FAQ). This mock
 * deliberately does NOT reproduce that exact shape: every number this
 * function generates carries an unmistakable "MOCK" prefix specifically so
 * it can never be confused for a real government-issued acknowledgement
 * number, while still being digit-heavy enough to look plausible in a UI
 * for testing purposes. The 13 digits immediately after "MOCK" are the
 * real submission timestamp in milliseconds since epoch (good until the
 * year 2286) — this is what lets `checkStatus` derive elapsed time from
 * the acknowledgement number alone, without this provider needing to keep
 * any state of its own.
 */
const ACK_PREFIX = "MOCK";
const ACK_PATTERN = /^MOCK(\d{13})\d{6}$/;

/** How long (real wall-clock ms) after submission `checkStatus` starts reporting "ACKNOWLEDGED" instead of "SUBMITTED". Short on purpose — this is a UI-testing simulation, not a real multi-day CPC processing delay. */
export const ACKNOWLEDGEMENT_DELAY_MS = 5_000;

/** Exposed for this package's own tests (constructing a "backdated" acknowledgement number without waiting on a real clock) — not part of the `FilingProvider` interface. */
export function encodeAcknowledgementNumber(submittedAtMs: number): string {
  const timestampPart = Math.max(0, Math.trunc(submittedAtMs)).toString().padStart(13, "0").slice(-13);
  const randomPart = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `${ACK_PREFIX}${timestampPart}${randomPart}`;
}

/** Exposed for this package's own tests. Returns `null` for anything that isn't a well-formed mock acknowledgement number. */
export function decodeSubmittedAtMs(acknowledgementNumber: string): number | null {
  const match = ACK_PATTERN.exec(acknowledgementNumber);
  if (!match) return null;
  return Number(match[1]);
}

function makeEvent(status: FilingStatusValue, atMs: number, detail: string): FilingStatusEvent {
  return { status, at: new Date(atMs).toISOString(), detail };
}

async function submitReturn(itrJson: unknown, meta: FilingMeta): Promise<FilingSubmissionResult> {
  if (itrJson === null || itrJson === undefined) {
    throw new Error("mockFilingProvider.submitReturn: itrJson payload is required.");
  }
  if (!meta?.assessmentYear || !meta.itrType) {
    throw new Error("mockFilingProvider.submitReturn: meta.assessmentYear and meta.itrType are required.");
  }

  const now = Date.now();
  const acknowledgementNumber = encodeAcknowledgementNumber(now);
  const event = makeEvent(
    "SUBMITTED",
    now,
    `Simulation only: no data was sent anywhere. The mock filing provider "accepted" this ${meta.itrType} submission for AY ${meta.assessmentYear} locally.`,
  );

  return {
    acknowledgementNumber,
    status: "SUBMITTED",
    statusHistory: [event],
  };
}

async function checkStatus(acknowledgementNumber: string): Promise<FilingStatusResult> {
  const now = Date.now();
  const submittedAtMs = decodeSubmittedAtMs(acknowledgementNumber);

  if (submittedAtMs === null) {
    return {
      acknowledgementNumber,
      status: "FAILED",
      event: makeEvent(
        "FAILED",
        now,
        "Simulation only: this acknowledgement number was not recognized by the mock filing provider (not a real government lookup).",
      ),
    };
  }

  const elapsedMs = now - submittedAtMs;
  const status: FilingStatusValue = elapsedMs >= ACKNOWLEDGEMENT_DELAY_MS ? "ACKNOWLEDGED" : "SUBMITTED";
  const detail =
    status === "ACKNOWLEDGED"
      ? "Simulation only: the mock filing provider now reports this return as received/acknowledged (no real CPC processing occurred)."
      : "Simulation only: the mock filing provider still reports this return as submitted, not yet acknowledged.";

  return { acknowledgementNumber, status, event: makeEvent(status, now, detail) };
}

async function eVerify(acknowledgementNumber: string, method: EVerifyMethod): Promise<EVerifyResult> {
  if (method !== "AADHAAR_OTP" && method !== "NET_BANKING") {
    throw new Error(`mockFilingProvider.eVerify: unsupported method "${String(method)}".`);
  }

  const now = Date.now();
  const current = await checkStatus(acknowledgementNumber);

  if (current.status === "FAILED") {
    return {
      acknowledgementNumber,
      success: false,
      status: "FAILED",
      event: makeEvent("FAILED", now, "Simulation only: e-verification failed — acknowledgement number not recognized."),
    };
  }

  if (current.status === "SUBMITTED") {
    return {
      acknowledgementNumber,
      success: false,
      status: "SUBMITTED",
      event: makeEvent(
        "SUBMITTED",
        now,
        "Simulation only: e-verification isn't available yet — the mock filing provider hasn't acknowledged this return. Check status again shortly and retry.",
      ),
    };
  }

  // current.status is "ACKNOWLEDGED" (or, defensively, "VERIFIED" already —
  // treated as an idempotent success either way, since a caller re-trying
  // eVerify on an already-verified return should not see an error).
  const methodLabel = method === "AADHAAR_OTP" ? "Aadhaar OTP" : "net banking";
  return {
    acknowledgementNumber,
    success: true,
    status: "VERIFIED",
    event: makeEvent(
      "VERIFIED",
      now,
      `Simulation only: e-verification via ${methodLabel} "succeeded" locally. No real OTP was sent and no real bank/Aadhaar service was contacted.`,
    ),
  };
}

/** The single `FilingProvider` instance this codebase exposes — see this file's header and `types.ts`'s for why no other implementation will ever exist here. */
export const mockFilingProvider: FilingProvider = {
  submitReturn,
  checkStatus,
  eVerify,
};
