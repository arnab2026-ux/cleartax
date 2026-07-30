"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "./actions";

/** Generic delete button for a Prisma row, bound to a specific `deleteX(id)` server action via `.bind(null, id)` at the call site. */
export function DeleteRowButton({ action, confirmMessage }: { action: () => Promise<ActionResult>; confirmMessage: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!confirm(confirmMessage)) return;
    setPending(true);
    await action();
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
