"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { salaryIncomeSchema, type SalaryIncomeFormValues } from "@/lib/validation/salaryIncome";
import type { ActionResult } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

interface MoneyFieldSpec {
  name: keyof Omit<SalaryIncomeFormValues, "employerName" | "isMetroCity">;
  label: string;
  hint?: string;
}

const HRA_FIELDS: MoneyFieldSpec[] = [
  { name: "basicSalary", label: "Basic salary", hint: "Not on Form 16 — enter manually for an accurate HRA exemption" },
  { name: "hraReceived", label: "HRA received", hint: "Not on Form 16 — enter manually" },
  { name: "rentPaid", label: "Rent paid", hint: "Not on Form 16 — enter manually" },
];

const OTHER_FIELDS: MoneyFieldSpec[] = [
  { name: "grossSalary", label: "Gross salary" },
  { name: "ltaReceived", label: "LTA received" },
  { name: "otherAllowances", label: "Other allowances" },
  { name: "perquisitesValue", label: "Perquisites value" },
  { name: "exemptHra", label: "HRA exemption (Form 16 figure, informational)" },
  { name: "exemptLta", label: "LTA exemption (Form 16 figure, informational)" },
  { name: "exemptOther", label: "Other exemptions (Form 16 figure, informational)" },
  { name: "standardDeduction", label: "Standard deduction" },
  { name: "professionalTax", label: "Professional tax" },
  { name: "tdsDeducted", label: "TDS deducted" },
];

export function SalaryIncomeForm({
  initial,
  onSubmitAction,
  submitLabel,
  redirectTo,
}: {
  initial: SalaryIncomeFormValues;
  onSubmitAction: (values: SalaryIncomeFormValues) => Promise<ActionResult<unknown>>;
  submitLabel: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SalaryIncomeFormValues>({
    resolver: zodResolver(salaryIncomeSchema),
    defaultValues: initial,
  });

  async function onSubmit(values: SalaryIncomeFormValues) {
    setServerError(null);
    const result = await onSubmitAction(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <label className={labelClass}>
        Employer name
        <input className={inputClass} {...register("employerName")} />
        {errors.employerName && <span className={errorClass}>{errors.employerName.message}</span>}
      </label>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <legend className="px-1 text-sm font-medium text-amber-800 dark:text-amber-300">
          HRA details — Form 16 does not include these
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {HRA_FIELDS.map((field) => (
            <label key={field.name} className={labelClass}>
              {field.label}
              <input type="number" step="0.01" className={inputClass} {...register(field.name, { valueAsNumber: true })} />
              {field.hint && <span className="text-xs text-zinc-500">{field.hint}</span>}
              {errors[field.name] && <span className={errorClass}>{errors[field.name]?.message}</span>}
            </label>
          ))}
          <label className={`${labelClass} flex-row items-center gap-2`}>
            <input type="checkbox" {...register("isMetroCity")} />
            Resides in a metro city (Delhi, Mumbai, Kolkata, Chennai)
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Salary &amp; exemptions</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {OTHER_FIELDS.map((field) => (
            <label key={field.name} className={labelClass}>
              {field.label}
              <input type="number" step="0.01" className={inputClass} {...register(field.name, { valueAsNumber: true })} />
              {errors[field.name] && <span className={errorClass}>{errors[field.name]?.message}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      {serverError && <p className={errorClass}>{serverError}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
