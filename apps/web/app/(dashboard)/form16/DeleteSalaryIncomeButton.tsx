"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteSalaryIncome } from "./actions";

export function DeleteSalaryIncomeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!confirm("Remove this salary income entry?")) return;
    setPending(true);
    await deleteSalaryIncome(id);
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
    >
      Remove
    </button>
  );
}
