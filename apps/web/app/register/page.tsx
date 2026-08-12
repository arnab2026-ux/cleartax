"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registrationSchema } from "@/lib/validation/registration";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function RegisterPage() {
  const router = useRouter();
  const [values, setValues] = useState({
    inviteCode: "",
    fullName: "",
    email: "",
    phone: "",
    pan: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set(field: keyof typeof values) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Validated client-side purely for fast feedback. The route re-validates
    // with this same schema — a Route Handler is a public endpoint and cannot
    // trust anything this form did.
    const parsed = registrationSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the details above");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Registration failed");
        return;
      }
      // Registration signs you in, so go straight to the first wizard step —
      // which is also where the date of birth gets filled in, since
      // registration does not collect it and the old regime's age bands
      // depend on it.
      router.push("/profile");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-10 dark:bg-black">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-200 p-8 dark:border-zinc-800"
      >
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create an account</h1>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Accounts are by invitation only. Your PAN, Aadhaar and bank details are encrypted before they are stored.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Invite code
          <input
            type="text"
            required
            value={values.inviteCode}
            onChange={set("inviteCode")}
            className={inputClass}
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Full name
          <input type="text" required value={values.fullName} onChange={set("fullName")} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" required value={values.email} onChange={set("email")} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Mobile number
          <input
            type="tel"
            required
            placeholder="98765 43210"
            value={values.phone}
            onChange={set("phone")}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          PAN
          <input
            type="text"
            required
            placeholder="ABCDE1234F"
            autoCapitalize="characters"
            value={values.pan}
            onChange={set("pan")}
            className={`${inputClass} uppercase`}
          />
          <span className="text-xs text-zinc-500">One account per PAN.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            value={values.password}
            onChange={set("password")}
            className={inputClass}
          />
          <span className="text-xs text-zinc-500">
            At least 12 characters. A memorable phrase beats a short complicated one.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Confirm password
          <input
            type="password"
            required
            value={values.confirmPassword}
            onChange={set("confirmPassword")}
            className={inputClass}
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <a href="/login" className="font-medium underline">
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
}
