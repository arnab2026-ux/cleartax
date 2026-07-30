import Link from "next/link";
import { compareRegimes } from "@cleartax/tax-engine";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getTaxpayerProfileOrNull } from "@/lib/getOrCreateTaxpayerProfile";
import { loadFullIncomeInputForProfile } from "@/lib/loadFullIncomeInput";
import { computeGrossTotalIncome } from "@/lib/mapping/taxComputationMapping";
import type { FullTaxLiabilityResult } from "@cleartax/tax-engine";

function formatMoney(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function ComparisonRow({ label, oldValue, newValue }: { label: string; oldValue: number; newValue: number }) {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{label}</td>
      <td className="py-2 pr-4 text-right font-mono text-zinc-800 dark:text-zinc-200">{formatMoney(oldValue)}</td>
      <td className="py-2 text-right font-mono text-zinc-800 dark:text-zinc-200">{formatMoney(newValue)}</td>
    </tr>
  );
}

export default async function RegimeComparisonPage() {
  const profile = await getTaxpayerProfileOrNull();
  if (!profile || !profile.pan || !profile.fullName) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Compare regimes</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Complete your{" "}
          <Link href="/profile" className="font-medium underline">
            profile
          </Link>{" "}
          first (PAN and date of birth are needed to compute age-based slabs).
        </p>
      </div>
    );
  }

  const { age, fullIncomeInput } = await loadFullIncomeInputForProfile(profile.id, profile.dateOfBirth);

  const comparison = compareRegimes(fullIncomeInput, age);
  const { old: oldResult, new: newResult } = comparison;

  const rows: { label: string; old: (r: FullTaxLiabilityResult) => number; new: (r: FullTaxLiabilityResult) => number }[] = [
    { label: "Gross total income", old: (r) => computeGrossTotalIncome(r), new: (r) => computeGrossTotalIncome(r) },
    { label: "Chapter VI-A deductions", old: (r) => r.income.deductions.totalDeduction, new: (r) => r.income.deductions.totalDeduction },
    { label: "Taxable income", old: (r) => r.income.totalIncome, new: (r) => r.income.totalIncome },
    { label: "Slab tax before rebate", old: (r) => r.slabTaxBeforeRebate, new: (r) => r.slabTaxBeforeRebate },
    { label: "Section 87A rebate", old: (r) => r.rebate.rebateApplied, new: (r) => r.rebate.rebateApplied },
    { label: "Capital gains tax", old: (r) => r.capitalGainsTaxBeforeSurcharge, new: (r) => r.capitalGainsTaxBeforeSurcharge },
    { label: "Surcharge", old: (r) => r.slabSurcharge.surchargeAfterRelief + r.capitalGainsSurcharge, new: (r) => r.slabSurcharge.surchargeAfterRelief + r.capitalGainsSurcharge },
    { label: "Health & education cess", old: (r) => r.cess.cess, new: (r) => r.cess.cess },
    { label: "Total tax liability", old: (r) => r.totalTaxLiabilityRounded, new: (r) => r.totalTaxLiabilityRounded },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Old vs new regime</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Computed for age {age} from everything entered so far for {CURRENT_ASSESSMENT_YEAR}.
        </p>
      </div>

      <div
        className={`rounded-lg px-4 py-3 text-sm font-medium ${
          comparison.recommendedRegime === "old"
            ? "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200"
            : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
        }`}
      >
        Recommended: {comparison.recommendedRegime === "old" ? "Old regime" : "New regime"} — saves{" "}
        {formatMoney(comparison.savingsFromRecommendedRegime)} vs. the other regime.
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium text-zinc-500">Line item</th>
              <th className="py-2 pr-4 text-right font-medium text-zinc-500">Old regime</th>
              <th className="py-2 text-right font-medium text-zinc-500">New regime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ComparisonRow key={row.label} label={row.label} oldValue={row.old(oldResult)} newValue={row.new(newResult)} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3">
        <Link
          href={`/summary?regime=old`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
        >
          Proceed with old regime
        </Link>
        <Link
          href={`/summary?regime=new`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
        >
          Proceed with new regime
        </Link>
        <Link
          href={`/summary?regime=${comparison.recommendedRegime}`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Proceed with recommended regime
        </Link>
      </div>
    </div>
  );
}
