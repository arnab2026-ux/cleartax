"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateItrJson } from "./actions";

export interface GenerateItrSectionProps {
  taxComputationId: string;
  itr1Eligible: boolean;
  itr1IneligibleReasons: string[];
}

/**
 * The interactive "generate my ITR JSON" control. `itr1Eligible`/
 * `itr1IneligibleReasons` are computed server-side (`/filing`'s
 * `page.tsx`, via `isEligibleForItr1` from `@cleartax/itr-schema`) and
 * passed down as props rather than re-checked client-side, so this
 * component stays a thin, stateless-on-mount client island.
 */
export function GenerateItrSection({ taxComputationId, itr1Eligible, itr1IneligibleReasons }: GenerateItrSectionProps) {
  const router = useRouter();
  const [itrType, setItrType] = useState<"ITR1" | "ITR2">(itr1Eligible ? "ITR1" : "ITR2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ artifactId: string; itrType: "ITR1" | "ITR2" } | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await generateItrJson(taxComputationId, itrType);
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? "Could not generate the ITR JSON.");
      return;
    }
    setResult(response.data);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Generate ITR JSON</h2>

      <fieldset className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="itrType"
            value="ITR1"
            checked={itrType === "ITR1"}
            disabled={!itr1Eligible}
            onChange={() => setItrType("ITR1")}
          />
          ITR-1 (Sahaj) {!itr1Eligible && <span className="text-xs text-zinc-500">— not eligible</span>}
        </label>
        {!itr1Eligible && itr1IneligibleReasons.length > 0 && (
          <ul className="ml-6 list-disc text-xs text-zinc-500">
            {itr1IneligibleReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="itrType" value="ITR2" checked={itrType === "ITR2"} onChange={() => setItrType("ITR2")} />
          ITR-2
        </label>
      </fieldset>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Generating…" : `Generate ${itrType} JSON`}
      </button>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {result.itrType} JSON generated and validated against the government schema.{" "}
          <a href={`/api/itr/${result.artifactId}/download`} className="font-medium underline">
            Download it here
          </a>
          .
        </p>
      )}

      <p className="text-xs text-zinc-500">
        This JSON is validated against the real ITR-1/ITR-2 schema the Income Tax Department&apos;s own e-filing portal uses, but this app
        never submits it anywhere — download it and upload it yourself via the official portal or offline utility. Review it carefully
        first; see this project&apos;s notes on exactly how confident to be in its correctness.
      </p>
    </div>
  );
}
