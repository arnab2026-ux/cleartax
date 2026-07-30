"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { OTHER_SOURCE_TYPES, otherSourceIncomeSchema, type OtherSourceIncomeFormValues } from "@/lib/validation/otherSource";
import { createOtherSourceIncome } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const SOURCE_LABELS: Record<(typeof OTHER_SOURCE_TYPES)[number], string> = {
  SAVINGS_INTEREST: "Savings account interest",
  FIXED_DEPOSIT_INTEREST: "Fixed deposit interest",
  RECURRING_DEPOSIT_INTEREST: "Recurring deposit interest",
  DIVIDEND: "Dividend",
  FAMILY_PENSION: "Family pension",
  LOTTERY_OR_GAME_WINNINGS: "Lottery / game show winnings",
  GIFT: "Gift",
  OTHER: "Other",
};

const EMPTY: OtherSourceIncomeFormValues = {
  sourceType: "SAVINGS_INTEREST",
  description: undefined,
  amount: 0,
  tdsDeducted: 0,
};

export function OtherSourceForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OtherSourceIncomeFormValues>({ resolver: zodResolver(otherSourceIncomeSchema), defaultValues: EMPTY });

  async function onSubmit(values: OtherSourceIncomeFormValues) {
    setServerError(null);
    const result = await createOtherSourceIncome(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    reset(EMPTY);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Source
          <select className={inputClass} {...register("sourceType")}>
            {OTHER_SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Description (optional)
          <input className={inputClass} {...register("description")} />
        </label>
        <label className={labelClass}>
          Amount
          <input type="number" step="0.01" className={inputClass} {...register("amount", { valueAsNumber: true })} />
          {errors.amount && <span className={errorClass}>{errors.amount.message}</span>}
        </label>
        <label className={labelClass}>
          TDS deducted
          <input type="number" step="0.01" className={inputClass} {...register("tdsDeducted", { valueAsNumber: true })} />
          {errors.tdsDeducted && <span className={errorClass}>{errors.tdsDeducted.message}</span>}
        </label>
      </div>
      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Add income"}
      </button>
    </form>
  );
}
