import Link from "next/link";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getCurrentTaxpayerProfileOrNull } from "@/lib/getCurrentTaxpayerProfile";
import { prisma } from "@/lib/db";
import { ComputeForm } from "./ComputeForm";
import { Form67Warning } from "../foreign-assets/Form67Warning";

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-zinc-100 py-2 dark:border-zinc-800 ${bold ? "font-semibold" : ""}`}>
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ regime?: string }> }) {
  const { regime: regimeParam } = await searchParams;
  const defaultRegime: "old" | "new" = regimeParam === "new" ? "new" : "old";

  const profile = await getCurrentTaxpayerProfileOrNull();
  if (!profile || !profile.pan || !profile.fullName) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Summary</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Complete your{" "}
          <Link href="/profile" className="font-medium underline">
            profile
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  const latest = await prisma.taxComputation.findFirst({
    where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
    orderBy: { computedAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Summary</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Run the full computation for {CURRENT_ASSESSMENT_YEAR} and save it. Re-run any time after editing income or
          deductions — each run is saved as a new record, not overwritten, so you can compare runs over time.
        </p>
      </div>

      <ComputeForm defaultRegime={defaultRegime} />

      {latest ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Latest computation — {latest.regime === "OLD" ? "Old regime" : "New regime"}
            </h2>
            <span className="text-xs text-zinc-500">{latest.computedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
          </div>
          <Row label="Gross total income" value={formatMoney(latest.grossTotalIncome)} />
          <Row label="Chapter VI-A deductions" value={formatMoney(latest.totalDeductions)} />
          <Row label="Taxable income" value={formatMoney(latest.taxableIncome)} bold />
          <Row label="Tax before rebate (slab)" value={formatMoney(latest.taxBeforeRebate)} />
          <Row label="Capital gains tax" value={formatMoney(latest.capitalGainsTax)} />
          <Row label="Section 87A rebate" value={`-${formatMoney(latest.rebate)}`} />
          <Row label="Tax after rebate" value={formatMoney(latest.taxAfterRebate)} />
          <Row label="Surcharge" value={formatMoney(latest.surcharge)} />
          <Row label="Marginal relief" value={`-${formatMoney(latest.marginalRelief)}`} />
          <Row label="Health & education cess (4%)" value={formatMoney(latest.cess)} />
          <Row label="Total tax liability" value={formatMoney(latest.totalTaxLiability)} bold />
          {Number(latest.foreignTaxCredit) > 0 && (
            <Row label="Foreign tax credit (Sections 90/90A/91)" value={`-${formatMoney(latest.foreignTaxCredit)}`} />
          )}
          <Row label="TDS already deducted" value={formatMoney(latest.tdsCredit)} />
          <Row
            label={Number(latest.netPayableOrRefund) >= 0 ? "Net tax payable" : "Net refund due"}
            value={formatMoney(Math.abs(Number(latest.netPayableOrRefund)))}
            bold
          />
          {Number(latest.foreignTaxCredit) > 0 && (
            <div className="mt-3">
              <Form67Warning compact />
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No computation saved yet — click &ldquo;Compute &amp; save&rdquo; above.</p>
      )}
    </div>
  );
}
