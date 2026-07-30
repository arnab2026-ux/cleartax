"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { EMPLOYMENT_TYPES, section80CCD2Schema, type Section80CCD2FormValues } from "@/lib/validation/deduction";
import { saveSection80CCD2 } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

export function Section80CCD2Form({ initial }: { initial: Section80CCD2FormValues }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Section80CCD2FormValues>({ resolver: zodResolver(section80CCD2Schema), defaultValues: initial });

  async function onSubmit(values: Section80CCD2FormValues) {
    setServerError(null);
    setSaved(false);
    const result = await saveSection80CCD2(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Employer NPS contribution
        <input type="number" step="0.01" className={inputClass} {...register("employerContribution", { valueAsNumber: true })} />
        {errors.employerContribution && <span className={errorClass}>{errors.employerContribution.message}</span>}
      </label>
      <label className={labelClass}>
        Employment type
        <select className={inputClass} {...register("employmentType")}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "government" ? "Government" : "Private / other"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Save 80CCD(2)"}
      </button>
      {serverError && <p className={errorClass}>{serverError}</p>}
      {saved && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}
    </form>
  );
}
