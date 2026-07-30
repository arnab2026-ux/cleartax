"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { CAPITAL_ASSET_TYPES, capitalGainAssetSchema, type CapitalGainAssetFormValues } from "@/lib/validation/capitalGain";
import { createCapitalGainAsset } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const ASSET_LABELS: Record<(typeof CAPITAL_ASSET_TYPES)[number], string> = {
  LISTED_EQUITY_OR_EQUITY_MF: "Listed equity / equity mutual fund",
  UNLISTED_SHARES: "Unlisted shares",
  DEBT_MUTUAL_FUND: "Debt / specified mutual fund",
  IMMOVABLE_PROPERTY: "Immovable property",
  GOLD: "Gold",
  OTHER_ASSET: "Other asset",
};

const EMPTY: CapitalGainAssetFormValues = {
  assetType: "LISTED_EQUITY_OR_EQUITY_MF",
  description: undefined,
  acquisitionDate: "",
  saleDate: "",
  acquisitionCost: 0,
  saleValue: 0,
  expenses: 0,
  acquiredBeforeRegimeChange: false,
  indexedGainAmount: undefined,
};

export function CapitalGainForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [claimIndexation, setClaimIndexation] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CapitalGainAssetFormValues>({ resolver: zodResolver(capitalGainAssetSchema), defaultValues: EMPTY });

  const assetType = watch("assetType");
  const acquiredBeforeRegimeChange = watch("acquiredBeforeRegimeChange");
  const showGrandfatheringOption = assetType === "IMMOVABLE_PROPERTY" && acquiredBeforeRegimeChange;

  async function onSubmit(values: CapitalGainAssetFormValues) {
    setServerError(null);
    // indexedGainAmount is only meaningful when the grandfathering option is
    // actually being claimed — see lib/validation/shared.ts's `money()`
    // comment on why this app avoids z.coerce (and therefore doesn't try to
    // treat "0" as "not applicable" at the schema level).
    const payload = { ...values, indexedGainAmount: showGrandfatheringOption && claimIndexation ? values.indexedGainAmount : undefined };
    const result = await createCapitalGainAsset(payload);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    reset(EMPTY);
    setClaimIndexation(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Asset type
          <select className={inputClass} {...register("assetType")}>
            {CAPITAL_ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ASSET_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Description (optional)
          <input className={inputClass} {...register("description")} placeholder="e.g. HDFC Flexicap Fund" />
        </label>
        <label className={labelClass}>
          Acquisition date
          <input type="date" className={inputClass} {...register("acquisitionDate")} />
          {errors.acquisitionDate && <span className={errorClass}>{errors.acquisitionDate.message}</span>}
        </label>
        <label className={labelClass}>
          Sale date
          <input type="date" className={inputClass} {...register("saleDate")} />
          {errors.saleDate && <span className={errorClass}>{errors.saleDate.message}</span>}
        </label>
        <label className={labelClass}>
          Acquisition cost
          <input type="number" step="0.01" className={inputClass} {...register("acquisitionCost", { valueAsNumber: true })} />
          {errors.acquisitionCost && <span className={errorClass}>{errors.acquisitionCost.message}</span>}
        </label>
        <label className={labelClass}>
          Sale value
          <input type="number" step="0.01" className={inputClass} {...register("saleValue", { valueAsNumber: true })} />
          {errors.saleValue && <span className={errorClass}>{errors.saleValue.message}</span>}
        </label>
        <label className={labelClass}>
          Expenses (brokerage etc.)
          <input type="number" step="0.01" className={inputClass} {...register("expenses", { valueAsNumber: true })} />
          {errors.expenses && <span className={errorClass}>{errors.expenses.message}</span>}
        </label>
      </div>

      {assetType === "IMMOVABLE_PROPERTY" && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" {...register("acquiredBeforeRegimeChange")} />
            Acquired before 23 July 2024 (eligible for the indexation grandfathering option)
          </label>
          {showGrandfatheringOption && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={claimIndexation} onChange={(e) => setClaimIndexation(e.target.checked)} />
                Claim the 20%-with-indexation option (I know the indexed cost)
              </label>
              {claimIndexation && (
                <label className={labelClass}>
                  Indexed gain amount (sale value − indexed cost of acquisition)
                  <input type="number" step="0.01" className={inputClass} {...register("indexedGainAmount", { valueAsNumber: true })} />
                </label>
              )}
            </>
          )}
        </div>
      )}

      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Add capital gain"}
      </button>
    </form>
  );
}
