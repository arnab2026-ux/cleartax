"use client";

import { useRouter } from "next/navigation";

/** Mirrors the fetch-then-navigate pattern `app/login/page.tsx` already uses — the logout route returns JSON, not a redirect, so a plain `<form action="...">` would leave the user staring at raw JSON. */
export function SignOutButton() {
  const router = useRouter();

  async function handleClick() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 sm:text-sm dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      Sign out
    </button>
  );
}
