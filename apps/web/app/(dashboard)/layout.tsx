import Link from "next/link";
import { SignOutButton } from "./SignOutButton";

const STEPS = [
  { href: "/profile", label: "1. Profile" },
  { href: "/form16", label: "2. Form 16" },
  { href: "/income", label: "3. Income" },
  { href: "/deductions", label: "4. Deductions" },
  { href: "/regime-comparison", label: "5. Compare regimes" },
  { href: "/summary", label: "6. Summary" },
  { href: "/filing", label: "7. Filing" },
] as const;

/**
 * Every page under this layout reads real per-taxpayer data from Prisma
 * (and is gated by session cookies via `proxy.ts`) — none of it is ever
 * safe to statically prerender at build time. Without this, `next build`
 * tries to prerender these routes against the build's dummy/unreachable
 * `DATABASE_URL` and fails the whole build. Set at the layout level so
 * every nested page inherits it without repeating the export everywhere.
 */
export const dynamic = "force-dynamic";

/**
 * A simple stepper nav, not a generic wizard framework — every step is a
 * plain, independently-navigable route (Server Component pages reading/
 * writing real Prisma data), so refreshing or returning to any step on a
 * later day resumes correctly rather than losing progress held only in
 * client state. See PROGRESS.md's Phase 5 section for the full design
 * rationale.
 */
export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-1 px-4 py-3 sm:gap-2">
          {STEPS.map((step) => (
            <Link
              key={step.href}
              href={step.href}
              className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 sm:text-sm dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              {step.label}
            </Link>
          ))}
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </div>
      </nav>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  );
}
