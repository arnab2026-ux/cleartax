"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { computeAndSaveTaxComputation } from "./actions";

export function ComputeForm({ defaultRegime }: { defaultRegime: "old" | "new" }) {
  const router = useRouter();
  const [regime, setRegime] = useState<"old" | "new">(defaultRegime);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await computeAndSaveTaxComputation(regime);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to compute");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        Regime
        <select
          value={regime}
          onChange={(e) => setRegime(e.target.value as "old" | "new")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="old">Old regime</option>
          <option value="new">New regime</option>
        </select>
      </label>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {pending ? "Computing…" : "Compute & save"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
