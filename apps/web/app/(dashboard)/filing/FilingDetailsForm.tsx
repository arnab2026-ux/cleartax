"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { itrFilingDetailsSchema, type ItrFilingDetailsFormValues } from "@/lib/validation/itrFilingDetails";
import { saveItrFilingDetails } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

/**
 * Collects the three fields the real ITR JSON schema requires that
 * `/profile` never asked for (father's name, email, mobile number — see
 * `schema.prisma`'s `TaxpayerProfile` doc comment). Shown on `/filing`
 * only when at least one is still missing.
 */
export function FilingDetailsForm({ initial }: { initial: Partial<ItrFilingDetailsFormValues> }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ItrFilingDetailsFormValues>({
    resolver: zodResolver(itrFilingDetailsSchema),
    defaultValues: { fatherName: initial.fatherName ?? "", email: initial.email ?? "", mobileNumber: initial.mobileNumber ?? "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const result = await saveItrFilingDetails(values);
    if (!result.ok) {
      setServerError(result.error ?? "Could not save these details.");
      return;
    }
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <div>
        <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Complete your details for ITR JSON generation</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          The government&apos;s ITR JSON format requires these — not collected on the Profile step.
        </p>
      </div>
      <label className={labelClass}>
        Father&apos;s name
        <input className={inputClass} {...register("fatherName")} />
        {errors.fatherName && <span className={errorClass}>{errors.fatherName.message}</span>}
      </label>
      <label className={labelClass}>
        Email address
        <input type="email" className={inputClass} {...register("email")} />
        {errors.email && <span className={errorClass}>{errors.email.message}</span>}
      </label>
      <label className={labelClass}>
        Mobile number (10 digits)
        <input className={inputClass} {...register("mobileNumber")} />
        {errors.mobileNumber && <span className={errorClass}>{errors.mobileNumber.message}</span>}
      </label>
      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
