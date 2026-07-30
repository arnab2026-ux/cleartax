"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { simpleDeductionSchema, type SimpleDeductionFormValues } from "@/lib/validation/deduction";
import { createSimpleDeduction } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const EMPTY: SimpleDeductionFormValues = { amount: 0, description: undefined };

export function SimpleDeductionForm({ section, placeholder }: { section: "SECTION_80C" | "SECTION_80CCD_1B"; placeholder: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SimpleDeductionFormValues>({ resolver: zodResolver(simpleDeductionSchema), defaultValues: EMPTY });

  async function onSubmit(values: SimpleDeductionFormValues) {
    setServerError(null);
    const result = await createSimpleDeduction(section, values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    reset(EMPTY);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Description
        <input className={inputClass} placeholder={placeholder} {...register("description")} />
      </label>
      <label className={labelClass}>
        Amount
        <input type="number" step="0.01" className={inputClass} {...register("amount", { valueAsNumber: true })} />
        {errors.amount && <span className={errorClass}>{errors.amount.message}</span>}
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        Add
      </button>
      {serverError && <p className={errorClass}>{serverError}</p>}
    </form>
  );
}
