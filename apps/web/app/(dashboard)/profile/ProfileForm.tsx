"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { maskAadhaar, maskBankAccountNumber, maskPan } from "@/lib/mask";
import { taxpayerProfileSchema, type TaxpayerProfileFormValues } from "@/lib/validation/profile";
import { saveProfile } from "./actions";

export interface ProfileInitialValues extends TaxpayerProfileFormValues {
  isNew: boolean;
}

const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";
const errorClass = "text-xs text-red-600 dark:text-red-400";

/** A masked-by-default field with an explicit reveal toggle, for PAN/Aadhaar/bank account number — the three fields encrypted at rest (see `lib/prismaFieldEncryption.ts`). */
function MaskedField({
  label,
  name,
  value,
  masked,
  revealed,
  onToggle,
  register,
  error,
  placeholder,
}: {
  label: string;
  name: "pan" | "aadhaar" | "bankAccountNumber";
  value: string;
  masked: string;
  revealed: boolean;
  onToggle: () => void;
  register: ReturnType<typeof useForm<TaxpayerProfileFormValues>>["register"];
  error?: string;
  placeholder?: string;
}) {
  const showInput = revealed || !value;
  return (
    <label className={labelClass}>
      <span className="flex items-center justify-between">
        {label}
        {value && (
          <button type="button" onClick={onToggle} className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {revealed ? "Hide" : "Show / edit"}
          </button>
        )}
      </span>
      {showInput ? (
        <input placeholder={placeholder} className={inputClass} {...register(name)} />
      ) : (
        <span className={`${inputClass} font-mono tracking-wide text-zinc-500`}>{masked}</span>
      )}
      {error && <span className={errorClass}>{error}</span>}
    </label>
  );
}

export function ProfileForm({ initial }: { initial: ProfileInitialValues }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<{ pan: boolean; aadhaar: boolean; bankAccountNumber: boolean }>({
    pan: initial.isNew,
    aadhaar: initial.isNew,
    bankAccountNumber: initial.isNew,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TaxpayerProfileFormValues>({
    resolver: zodResolver(taxpayerProfileSchema),
    defaultValues: initial,
  });

  async function onSubmit(values: TaxpayerProfileFormValues) {
    setServerError(null);
    setSaved(false);
    const result = await saveProfile(values);
    if (!result.ok) {
      setServerError(result.error ?? "Failed to save profile");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Full name
          <input className={inputClass} {...register("fullName")} />
          {errors.fullName && <span className={errorClass}>{errors.fullName.message}</span>}
        </label>
        <label className={labelClass}>
          Date of birth
          <input type="date" className={inputClass} {...register("dateOfBirth")} />
          {errors.dateOfBirth && <span className={errorClass}>{errors.dateOfBirth.message}</span>}
        </label>

        <MaskedField
          label="PAN"
          name="pan"
          value={initial.pan}
          masked={maskPan(initial.pan)}
          revealed={revealed.pan}
          onToggle={() => setRevealed((r) => ({ ...r, pan: !r.pan }))}
          register={register}
          error={errors.pan?.message}
          placeholder="ABCDE1234F"
        />
        <MaskedField
          label="Aadhaar"
          name="aadhaar"
          value={initial.aadhaar ?? ""}
          masked={maskAadhaar(initial.aadhaar)}
          revealed={revealed.aadhaar}
          onToggle={() => setRevealed((r) => ({ ...r, aadhaar: !r.aadhaar }))}
          register={register}
          error={errors.aadhaar?.message}
          placeholder="12-digit Aadhaar (optional)"
        />
      </div>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Address</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Address line 1
            <input className={inputClass} {...register("addressLine1")} />
          </label>
          <label className={labelClass}>
            Address line 2
            <input className={inputClass} {...register("addressLine2")} />
          </label>
          <label className={labelClass}>
            City
            <input className={inputClass} {...register("city")} />
          </label>
          <label className={labelClass}>
            State
            <input className={inputClass} {...register("state")} />
          </label>
          <label className={labelClass}>
            Pincode
            <input className={inputClass} {...register("pincode")} />
            {errors.pincode && <span className={errorClass}>{errors.pincode.message}</span>}
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Bank details (for refunds)</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MaskedField
            label="Bank account number"
            name="bankAccountNumber"
            value={initial.bankAccountNumber ?? ""}
            masked={maskBankAccountNumber(initial.bankAccountNumber)}
            revealed={revealed.bankAccountNumber}
            onToggle={() => setRevealed((r) => ({ ...r, bankAccountNumber: !r.bankAccountNumber }))}
            register={register}
            error={errors.bankAccountNumber?.message}
          />
          <label className={labelClass}>
            IFSC
            <input className={inputClass} {...register("bankIfsc")} />
            {errors.bankIfsc && <span className={errorClass}>{errors.bankIfsc.message}</span>}
          </label>
          <label className={labelClass}>
            Bank name
            <input className={inputClass} {...register("bankName")} />
          </label>
        </div>
      </fieldset>

      {serverError && <p className={errorClass}>{serverError}</p>}
      {saved && <p className="text-sm text-green-600 dark:text-green-400">Profile saved.</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isSubmitting ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
