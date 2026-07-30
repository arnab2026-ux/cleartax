"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { HOUSE_PROPERTY_TYPES, housePropertySchema, type HousePropertyFormValues } from "@/lib/validation/houseProperty";
import { createHouseProperty } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const EMPTY: HousePropertyFormValues = {
  propertyType: "SELF_OCCUPIED",
  address: undefined,
  annualLetableValue: 0,
  municipalTaxesPaid: 0,
  homeLoanInterest: 0,
};

export function HousePropertyForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HousePropertyFormValues>({ resolver: zodResolver(housePropertySchema), defaultValues: EMPTY });

  const propertyType = watch("propertyType");

  async function onSubmit(values: HousePropertyFormValues) {
    setServerError(null);
    const result = await createHouseProperty(values);
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
          Property type
          <select className={inputClass} {...register("propertyType")}>
            {HOUSE_PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "SELF_OCCUPIED" ? "Self-occupied" : "Let-out"}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Address (optional)
          <input className={inputClass} {...register("address")} />
        </label>
        {propertyType === "LET_OUT" && (
          <>
            <label className={labelClass}>
              Annual rent received
              <input type="number" step="0.01" className={inputClass} {...register("annualLetableValue", { valueAsNumber: true })} />
              {errors.annualLetableValue && <span className={errorClass}>{errors.annualLetableValue.message}</span>}
            </label>
            <label className={labelClass}>
              Municipal taxes paid
              <input type="number" step="0.01" className={inputClass} {...register("municipalTaxesPaid", { valueAsNumber: true })} />
              {errors.municipalTaxesPaid && <span className={errorClass}>{errors.municipalTaxesPaid.message}</span>}
            </label>
          </>
        )}
        <label className={labelClass}>
          Home loan interest paid
          <input type="number" step="0.01" className={inputClass} {...register("homeLoanInterest", { valueAsNumber: true })} />
          {errors.homeLoanInterest && <span className={errorClass}>{errors.homeLoanInterest.message}</span>}
        </label>
      </div>
      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Add property"}
      </button>
    </form>
  );
}
