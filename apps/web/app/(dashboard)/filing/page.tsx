import Link from "next/link";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getTaxpayerProfileOrNull } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

/**
 * Deliberately minimal — ITR JSON export (Phase 6) and the mock filing
 * provider (Phase 7) haven't been built yet. This step exists so the
 * wizard's stepper nav has somewhere to land, and so a taxpayer who's
 * already computed their tax has a place to see that reflected, without
 * this phase reaching into Phase 6/7's scope.
 */
export default async function FilingPage() {
  const profile = await getTaxpayerProfileOrNull();
  const latest = profile
    ? await prisma.taxComputation.findFirst({
        where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
        orderBy: { computedAt: "desc" },
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Filing</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          ITR JSON export and filing status will appear here once built. This step is a placeholder for now.
        </p>
      </div>

      {latest ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Latest saved computation ({latest.regime === "OLD" ? "old regime" : "new regime"})
          </h2>
          <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {Number(latest.netPayableOrRefund) >= 0 ? "Payable: " : "Refund: "}
            {formatMoney(Math.abs(Number(latest.netPayableOrRefund)))}
          </p>
          <p className="text-xs text-zinc-500">
            Computed {latest.computedAt.toISOString().slice(0, 16).replace("T", " ")} — see{" "}
            <Link href="/summary" className="underline">
              full breakdown
            </Link>
            .
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          No computation saved yet — go to{" "}
          <Link href="/summary" className="font-medium underline">
            Summary
          </Link>{" "}
          first.
        </p>
      )}
    </div>
  );
}
