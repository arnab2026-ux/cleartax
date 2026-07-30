"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { section80DSchema, type Section80DFormValues } from "@/lib/validation/deduction";
import { saveSection80D } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

export function Section80DForm({ initial }: { initial: Section80DFormValues }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Section80DFormValues>({ resolver: zodResolver(section80DSchema), defaultValues: initial });

  async function onSubmit(values: Section80DFormValues) {
    setServerError(null);
    setSaved(false);
    const result = await saveSection80D(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Self &amp; family premium
          <input type="number" step="0.01" className={inputClass} {...register("selfAndFamilyPremium", { valueAsNumber: true })} />
          {errors.selfAndFamilyPremium && <span className={errorClass}>{errors.selfAndFamilyPremium.message}</span>}
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" {...register("selfOrFamilyHasSenior")} />
          Self/spouse is a senior citizen (60+)
        </label>
        <label className={labelClass}>
          Parents&apos; premium
          <input type="number" step="0.01" className={inputClass} {...register("parentsPremium", { valueAsNumber: true })} />
          {errors.parentsPremium && <span className={errorClass}>{errors.parentsPremium.message}</span>}
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" {...register("parentsHaveSenior")} />
          Parent(s) are senior citizens (60+)
        </label>
        <label className={labelClass}>
          Preventive health check-up spend
          <input type="number" step="0.01" className={inputClass} {...register("preventiveHealthCheckup", { valueAsNumber: true })} />
          {errors.preventiveHealthCheckup && <span className={errorClass}>{errors.preventiveHealthCheckup.message}</span>}
        </label>
      </div>
      {serverError && <p className={errorClass}>{serverError}</p>}
      {saved && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Save 80D"}
      </button>
    </form>
  );
}
