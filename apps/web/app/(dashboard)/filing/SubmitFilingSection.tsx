"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkFilingAttemptStatus, eVerifyFilingAttempt, submitFilingAttempt } from "./actions";

export interface ArtifactFilingAttemptView {
  id: string;
  status: string;
  acknowledgementNumber: string | null;
  statusHistory: { status: string; at: string; detail: string }[];
}

export interface ArtifactFilingRow {
  id: string;
  itrType: string;
  /** ISO timestamp. */
  generatedAt: string;
  downloadHref: string;
  /** The most recent `FilingAttempt` for this artifact, if any have been made. */
  attempt: ArtifactFilingAttemptView | null;
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted (simulated)",
  ACKNOWLEDGED: "Acknowledged (simulated)",
  VERIFIED: "E-verified (simulated)",
  FAILED: "Failed (simulated)",
};

function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * The "Submit" section of `/filing`, per Phase 7. **Core safety property of
 * this component (do not remove or soften): the banner below must always be
 * visible whenever this section renders, right next to every submit
 * control** — the same role the Form 16 review gate played for Phase 3/5.
 * This app never contacts any real government system; every button here
 * calls `mockFilingProvider` (via the Server Actions in `./actions.ts`)
 * which makes zero network calls and only ever writes to this app's own
 * database.
 */
export function SubmitFilingSection({ artifacts }: { artifacts: ArtifactFilingRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByArtifact, setErrorByArtifact] = useState<Record<string, string>>({});

  if (artifacts.length === 0) {
    return null;
  }

  async function handleSubmit(artifactId: string) {
    setBusyId(artifactId);
    setErrorByArtifact((prev) => ({ ...prev, [artifactId]: "" }));
    const result = await submitFilingAttempt(artifactId);
    setBusyId(null);
    if (!result.ok) {
      setErrorByArtifact((prev) => ({ ...prev, [artifactId]: result.error ?? "Could not run the simulated submission." }));
      return;
    }
    router.refresh();
  }

  async function handleCheckStatus(attemptId: string, artifactId: string) {
    setBusyId(attemptId);
    setErrorByArtifact((prev) => ({ ...prev, [artifactId]: "" }));
    const result = await checkFilingAttemptStatus(attemptId);
    setBusyId(null);
    if (!result.ok) {
      setErrorByArtifact((prev) => ({ ...prev, [artifactId]: result.error ?? "Could not check the simulated status." }));
      return;
    }
    router.refresh();
  }

  async function handleEVerify(attemptId: string, artifactId: string, method: "AADHAAR_OTP" | "NET_BANKING") {
    setBusyId(attemptId);
    setErrorByArtifact((prev) => ({ ...prev, [artifactId]: "" }));
    const result = await eVerifyFilingAttempt(attemptId, method);
    setBusyId(null);
    if (!result.ok) {
      setErrorByArtifact((prev) => ({ ...prev, [artifactId]: result.error ?? "Could not run the simulated e-verification." }));
      return;
    }
    if (!result.data?.success) {
      setErrorByArtifact((prev) => ({
        ...prev,
        [artifactId]: result.data?.event.detail ?? "Simulated e-verification did not succeed yet.",
      }));
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">ITR JSON files and mock filing</h2>

      <div
        role="alert"
        className="rounded-md border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
      >
        <p className="font-semibold">This is a simulation. No data is sent anywhere.</p>
        <p className="mt-1">
          Real e-filing requires ERI/GSP credentials this app does not have, and this app is deliberately built to never attempt real
          submission to the Income Tax Department&apos;s e-filing portal. &quot;Submit&quot;, &quot;Check status&quot;, and
          &quot;E-verify&quot; below only write to this app&apos;s own database — use the downloaded ITR JSON to file yourself on the
          official portal (incometax.gov.in) or through an authorized intermediary.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {artifacts.map((artifact) => {
          const attempt = artifact.attempt;
          const isBusy = busyId === artifact.id || (attempt !== null && busyId === attempt.id);
          return (
            <li key={artifact.id} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {artifact.itrType} — generated {formatTimestamp(artifact.generatedAt)}
                </span>
                <a href={artifact.downloadHref} className="font-medium text-blue-600 underline dark:text-blue-400">
                  Download JSON
                </a>
              </div>

              {!attempt && (
                <button
                  type="button"
                  onClick={() => handleSubmit(artifact.id)}
                  disabled={isBusy}
                  className="w-fit rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {isBusy ? "Submitting (simulated)…" : "Submit (simulated)"}
                </button>
              )}

              {attempt && (
                <div className="flex flex-col gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <p>
                    Status: <span className="font-medium text-zinc-900 dark:text-zinc-100">{STATUS_LABEL[attempt.status] ?? attempt.status}</span>
                    {attempt.acknowledgementNumber && (
                      <>
                        {" "}
                        — mock acknowledgement number:{" "}
                        <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{attempt.acknowledgementNumber}</code>
                      </>
                    )}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCheckStatus(attempt.id, artifact.id)}
                      disabled={isBusy || attempt.status === "VERIFIED"}
                      className="w-fit rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      Check status (simulated)
                    </button>
                    {attempt.status !== "VERIFIED" && attempt.status !== "FAILED" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEVerify(attempt.id, artifact.id, "AADHAAR_OTP")}
                          disabled={isBusy}
                          className="w-fit rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                        >
                          E-verify via Aadhaar OTP (simulated)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEVerify(attempt.id, artifact.id, "NET_BANKING")}
                          disabled={isBusy}
                          className="w-fit rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                        >
                          E-verify via net banking (simulated)
                        </button>
                      </>
                    )}
                  </div>

                  {attempt.statusHistory.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-800">
                      {attempt.statusHistory.map((event, idx) => (
                        <li key={`${event.at}-${idx}`}>
                          {formatTimestamp(event.at)} — {STATUS_LABEL[event.status] ?? event.status}: {event.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {errorByArtifact[artifact.id] && <p className="text-xs text-red-600 dark:text-red-400">{errorByArtifact[artifact.id]}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
