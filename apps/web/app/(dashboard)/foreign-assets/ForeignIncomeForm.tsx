"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { COUNTRY_CODE_UNITED_STATES, FOREIGN_COUNTRY_OPTIONS } from "@cleartax/itr-schema";
import {
  FOREIGN_INCOME_HEADS,
  FOREIGN_TAX_RELIEF_SECTIONS,
  foreignSourceIncomeSchema,
  type ForeignSourceIncomeFormValues,
} from "@/lib/validation/foreignAsset";
import { createForeignSourceIncome } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const HEAD_LABELS: Record<(typeof FOREIGN_INCOME_HEADS)[number], string> = {
  OTHER_SOURCES: "Other sources — foreign dividends or interest",
  CAPITAL_GAINS: "Capital gains — sale of a foreign asset",
  SALARY: "Salary — including an RSU/ESOP vesting perquisite",
  HOUSE_PROPERTY: "House property — rent from a foreign property",
};

const RELIEF_LABELS: Record<(typeof FOREIGN_TAX_RELIEF_SECTIONS)[number], string> = {
  SECTION_90: "Section 90 — country has a DTAA with India (e.g. the USA)",
  SECTION_90A: "Section 90A — agreement with a specified association",
  SECTION_91: "Section 91 — no DTAA with that country (unilateral relief)",
};

const EMPTY: ForeignSourceIncomeFormValues = {
  countryCode: COUNTRY_CODE_UNITED_STATES,
  taxIdentificationNumber: "",
  head: "OTHER_SOURCES",
  description: undefined,
  incomeAmount: 0,
  foreignTaxPaid: 0,
  dtaaRateCapPercent: undefined,
  dtaaArticle: undefined,
  reliefSection: "SECTION_90",
  alreadyIncludedInIndianIncome: false,
  form67Filed: false,
};

export function ForeignIncomeForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [capTreatyRate, setCapTreatyRate] = useState(true);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ForeignSourceIncomeFormValues>({
    resolver: zodResolver(foreignSourceIncomeSchema),
    defaultValues: EMPTY,
  });

  const head = watch("head");
  const alreadyIncluded = watch("alreadyIncludedInIndianIncome");

  async function onSubmit(values: ForeignSourceIncomeFormValues) {
    setServerError(null);
    // Same pattern as the capital-gains form's indexation option: an optional
    // numeric field is only sent when it is actually being claimed, never as
    // a zero (see lib/validation/shared.ts on why this app avoids z.coerce).
    const payload = { ...values, dtaaRateCapPercent: capTreatyRate ? values.dtaaRateCapPercent : undefined };
    const result = await createForeignSourceIncome(payload);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    reset(EMPTY);
    setCapTreatyRate(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Country the income arose in
          <select className={inputClass} {...register("countryCode")}>
            {FOREIGN_COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {errors.countryCode && <span className={errorClass}>{errors.countryCode.message}</span>}
        </label>
        <label className={labelClass}>
          Your tax ID in that country
          <input className={inputClass} placeholder="US SSN/ITIN, or your passport number" {...register("taxIdentificationNumber")} />
          {errors.taxIdentificationNumber && <span className={errorClass}>{errors.taxIdentificationNumber.message}</span>}
        </label>
        <label className={labelClass}>
          Head of income
          <select className={inputClass} {...register("head")}>
            {FOREIGN_INCOME_HEADS.map((h) => (
              <option key={h} value={h}>
                {HEAD_LABELS[h]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Description (optional)
          <input className={inputClass} placeholder="e.g. Acme Corp dividends 2025-26" {...register("description")} />
        </label>
        <label className={labelClass}>
          Gross foreign income (₹, before foreign tax)
          <input type="number" step="0.01" className={inputClass} {...register("incomeAmount", { valueAsNumber: true })} />
          {errors.incomeAmount && <span className={errorClass}>{errors.incomeAmount.message}</span>}
        </label>
        <label className={labelClass}>
          Foreign tax paid / withheld (₹)
          <input type="number" step="0.01" className={inputClass} {...register("foreignTaxPaid", { valueAsNumber: true })} />
          {errors.foreignTaxPaid && <span className={errorClass}>{errors.foreignTaxPaid.message}</span>}
        </label>
      </div>

      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Enter the <strong>gross</strong> income — the tax withheld abroad is claimed back as a credit, it is not a
        deduction from income. Convert the foreign tax at the SBI telegraphic transfer buying rate on the last day of
        the month <em>before</em> the month it was paid or deducted (Rule 128(5)(ii)) — note that is a different rule
        from the one used for Schedule FA asset values above.
      </p>

      <div className="flex flex-col gap-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
        <label className={labelClass}>
          Relief claimed under
          <select className={inputClass} {...register("reliefSection")}>
            {FOREIGN_TAX_RELIEF_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {RELIEF_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={capTreatyRate} onChange={(e) => setCapTreatyRate(e.target.checked)} />
          A treaty rate caps what that country was entitled to charge
        </label>
        {capTreatyRate && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Treaty rate (%)
              <input type="number" step="0.01" className={inputClass} placeholder="25" {...register("dtaaRateCapPercent", { valueAsNumber: true })} />
              {errors.dtaaRateCapPercent && <span className={errorClass}>{errors.dtaaRateCapPercent.message}</span>}
            </label>
            <label className={labelClass}>
              Treaty article (optional, for your records)
              <input className={inputClass} placeholder="Article 10(2)(b)" {...register("dtaaArticle")} />
            </label>
          </div>
        )}
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Foreign tax charged <em>above</em> the treaty rate is ignored entirely (proviso to Rule 128(5)(i)) — it is not
          creditable and not deductible. For US dividends the India-US treaty rate is <strong>25%</strong> (Article
          10(2)(b)); the 15% rate applies only to a company holding 10% or more of the voting stock, never to an
          individual RSU holder. If 30% was withheld because no Form W-8BEN was on file, the extra 5% is lost.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" className="mt-1" {...register("alreadyIncludedInIndianIncome")} />
          <span>
            This income is <strong>already recorded elsewhere</strong> in this app (salary from Form 16, a capital-gain
            transaction, or a house property) — record it here only for the foreign tax credit, do not add it to my
            income again.
          </span>
        </label>
        {errors.alreadyIncludedInIndianIncome && <span className={errorClass}>{errors.alreadyIncludedInIndianIncome.message}</span>}
        {head === "SALARY" && !alreadyIncluded && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            An RSU/ESOP vesting perquisite is already taxed as salary through your Form 16 — tick the box above, or it
            will be taxed twice.
          </p>
        )}
        {head === "CAPITAL_GAINS" && !alreadyIncluded && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Enter the sale itself in the Income step as a capital gain (asset type &ldquo;Foreign shares&rdquo;), then
            tick the box above so it is not counted twice.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" {...register("form67Filed")} />
          I have already filed Form 67 for this on the e-filing portal
        </label>
      </div>

      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Add foreign income"}
      </button>
    </form>
  );
}
