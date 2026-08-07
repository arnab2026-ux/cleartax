"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { COUNTRY_CODE_UNITED_STATES, FOREIGN_COUNTRY_OPTIONS } from "@cleartax/itr-schema";
import {
  FOREIGN_ASSET_OWNERSHIPS,
  FOREIGN_ASSET_TYPES,
  FOREIGN_INCOME_NATURES,
  foreignAssetSchema,
  type ForeignAssetFormValues,
} from "@/lib/validation/foreignAsset";
import { createForeignAsset } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

const ASSET_LABELS: Record<(typeof FOREIGN_ASSET_TYPES)[number], string> = {
  A3_FOREIGN_EQUITY_DEBT_INTEREST: "A3 — Foreign shares / RSUs / bonds (the securities themselves)",
  A2_FOREIGN_CUSTODIAL_ACCOUNT: "A2 — Foreign brokerage / custodial account (E*TRADE, Fidelity, Schwab…)",
  A1_FOREIGN_DEPOSITORY_ACCOUNT: "A1 — Foreign bank account (savings / current / fixed deposit)",
  A4_FOREIGN_CASH_VALUE_INSURANCE: "A4 — Foreign cash-value insurance or annuity contract",
  B_FINANCIAL_INTEREST_IN_ENTITY: "B — Financial interest in a foreign entity",
  C_IMMOVABLE_PROPERTY: "C — Immovable property outside India",
  D_OTHER_CAPITAL_ASSET: "D — Other capital asset outside India",
  E_SIGNING_AUTHORITY_ACCOUNT: "E — Account where you have signing authority (not already listed above)",
  F_TRUST_OUTSIDE_INDIA: "F — Trust created outside India",
  G_OTHER_FOREIGN_SOURCE_INCOME: "G — Other foreign-source income",
};

/** Per-table guidance for the fields whose meaning genuinely shifts between tables. */
const ASSET_HINTS: Partial<Record<(typeof FOREIGN_ASSET_TYPES)[number], string>> = {
  A3_FOREIGN_EQUITY_DEBT_INTEREST:
    "For RSUs/ESOPs: the entity is your employer's parent company, the date is the VEST date (a grant confers no interest), and the initial value is the fair market value on that date — the same figure already taxed as a perquisite in your Form 16.",
  A2_FOREIGN_CUSTODIAL_ACCOUNT:
    "Report the ACCOUNT here — peak and closing balance of the whole account including idle cash. The shares inside it are reported separately as an A3 row. Both rows are required; this is not double reporting.",
  A1_FOREIGN_DEPOSITORY_ACCOUNT: "A plain foreign bank account. A brokerage account is A2, not A1.",
};

const OWNERSHIP_LABELS: Record<(typeof FOREIGN_ASSET_OWNERSHIPS)[number], string> = {
  OWNER: "Owner (legal owner / direct)",
  BENEFICIAL_OWNER: "Beneficial owner",
  BENIFICIARY: "Beneficiary",
};

const NATURE_LABELS: Record<(typeof FOREIGN_INCOME_NATURES)[number], string> = {
  NONE: "No amount paid or credited",
  DIVIDEND: "Dividend",
  INTEREST: "Interest",
  SALE_PROCEEDS: "Proceeds from sale or redemption",
  OTHER: "Other income",
};

const EMPTY: ForeignAssetFormValues = {
  assetType: "A3_FOREIGN_EQUITY_DEBT_INTEREST",
  countryCode: COUNTRY_CODE_UNITED_STATES,
  description: undefined,
  entityName: undefined,
  entityAddress: undefined,
  zipCode: undefined,
  natureOfEntity: undefined,
  accountNumber: undefined,
  ownership: "OWNER",
  acquisitionDate: "",
  initialValue: 0,
  peakValue: 0,
  closingValue: 0,
  incomeAccrued: 0,
  incomeNature: "NONE",
  grossProceeds: 0,
  incomeTaxableInIndia: 0,
};

export function ForeignAssetForm({ periodLabel }: { periodLabel: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ForeignAssetFormValues>({ resolver: zodResolver(foreignAssetSchema), defaultValues: EMPTY });

  const assetType = watch("assetType");
  const isAccountLike =
    assetType === "A1_FOREIGN_DEPOSITORY_ACCOUNT" || assetType === "A2_FOREIGN_CUSTODIAL_ACCOUNT" || assetType === "E_SIGNING_AUTHORITY_ACCOUNT";
  const isSecurity = assetType === "A3_FOREIGN_EQUITY_DEBT_INTEREST";
  const showTaxableInIndia = !assetType.startsWith("A");

  async function onSubmit(values: ForeignAssetFormValues) {
    setServerError(null);
    const result = await createForeignAsset(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save");
      return;
    }
    reset(EMPTY);
    router.refresh();
  }

  const hint = ASSET_HINTS[assetType];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Which Schedule FA table?
          <select className={inputClass} {...register("assetType")}>
            {FOREIGN_ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ASSET_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {hint && <p className="text-xs text-zinc-600 sm:col-span-2 dark:text-zinc-400">{hint}</p>}

        <label className={labelClass}>
          Country
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
          Your label for this (optional)
          <input className={inputClass} placeholder="e.g. Acme Corp RSUs" {...register("description")} />
        </label>

        <label className={labelClass}>
          {isAccountLike ? "Financial institution name" : "Name of entity / person"}
          <input className={inputClass} {...register("entityName")} />
          {errors.entityName && <span className={errorClass}>{errors.entityName.message}</span>}
        </label>
        <label className={labelClass}>
          Address
          <input className={inputClass} {...register("entityAddress")} />
          {errors.entityAddress && <span className={errorClass}>{errors.entityAddress.message}</span>}
        </label>
        <label className={labelClass}>
          ZIP / postal code
          <input className={inputClass} maxLength={8} {...register("zipCode")} />
          {errors.zipCode && <span className={errorClass}>{errors.zipCode.message}</span>}
        </label>
        {isAccountLike && (
          <label className={labelClass}>
            Account number
            <input className={inputClass} {...register("accountNumber")} />
            {errors.accountNumber && <span className={errorClass}>{errors.accountNumber.message}</span>}
          </label>
        )}
        {!isAccountLike && (
          <label className={labelClass}>
            Nature of the entity / asset
            <input className={inputClass} placeholder="e.g. Company" {...register("natureOfEntity")} />
            {errors.natureOfEntity && <span className={errorClass}>{errors.natureOfEntity.message}</span>}
          </label>
        )}
        <label className={labelClass}>
          Ownership
          <select className={inputClass} {...register("ownership")}>
            {FOREIGN_ASSET_OWNERSHIPS.map((o) => (
              <option key={o} value={o}>
                {OWNERSHIP_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {isAccountLike ? "Account opening date" : isSecurity ? "Date the interest was acquired (RSU vest date)" : "Date of acquisition"}
          <input type="date" className={inputClass} {...register("acquisitionDate")} />
          {errors.acquisitionDate && <span className={errorClass}>{errors.acquisitionDate.message}</span>}
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
        <legend className="px-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          Values in ₹ for {periodLabel}
        </legend>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Convert using the State Bank of India telegraphic transfer buying rate on the relevant date — the date of the
          peak, the date of investment, or 31 December for the closing value. For a weekend or holiday, use the
          immediately preceding working day&rsquo;s rate.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className={labelClass}>
            {isSecurity ? "Initial value of investment" : "Value at cost / initial value"}
            <input type="number" step="0.01" className={inputClass} {...register("initialValue", { valueAsNumber: true })} />
            {errors.initialValue && <span className={errorClass}>{errors.initialValue.message}</span>}
          </label>
          <label className={labelClass}>
            Peak value during the year
            <input type="number" step="0.01" className={inputClass} {...register("peakValue", { valueAsNumber: true })} />
            {errors.peakValue && <span className={errorClass}>{errors.peakValue.message}</span>}
          </label>
          <label className={labelClass}>
            Closing value on 31 December
            <input type="number" step="0.01" className={inputClass} {...register("closingValue", { valueAsNumber: true })} />
            {errors.closingValue && <span className={errorClass}>{errors.closingValue.message}</span>}
          </label>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          The peak is the <strong>highest</strong> value on any single day of the calendar year — for shares, the highest
          price during the year times the number held on that day. Measure it across the whole year, not just up to a
          sale: a holding sold in June still has a real peak and a closing value of zero.
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          Income paid or credited during the year
          <input type="number" step="0.01" className={inputClass} {...register("incomeAccrued", { valueAsNumber: true })} />
          {errors.incomeAccrued && <span className={errorClass}>{errors.incomeAccrued.message}</span>}
        </label>
        <label className={labelClass}>
          Nature of that amount
          <select className={inputClass} {...register("incomeNature")}>
            {FOREIGN_INCOME_NATURES.map((n) => (
              <option key={n} value={n}>
                {NATURE_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        {isSecurity && (
          <label className={labelClass}>
            Gross sale / redemption proceeds
            <input type="number" step="0.01" className={inputClass} {...register("grossProceeds", { valueAsNumber: true })} />
            {errors.grossProceeds && <span className={errorClass}>{errors.grossProceeds.message}</span>}
          </label>
        )}
        {showTaxableInIndia && (
          <label className={labelClass}>
            Of that, amount chargeable to tax in India
            <input type="number" step="0.01" className={inputClass} {...register("incomeTaxableInIndia", { valueAsNumber: true })} />
            {errors.incomeTaxableInIndia && <span className={errorClass}>{errors.incomeTaxableInIndia.message}</span>}
          </label>
        )}
      </div>

      {serverError && <p className={errorClass}>{serverError}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Add foreign asset"}
      </button>
    </form>
  );
}
