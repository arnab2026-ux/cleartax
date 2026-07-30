import Link from "next/link";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { DeleteSalaryIncomeButton } from "./DeleteSalaryIncomeButton";
import { UploadForm } from "./UploadForm";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PARSED: "Parsed — needs review",
  NEEDS_REVIEW: "Needs review (low confidence)",
  CONFIRMED: "Confirmed",
  FAILED: "Failed to parse",
};

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

export default async function Form16Page() {
  const profile = await getOrCreateTaxpayerProfile();

  const [uploads, salaryIncomes] = await Promise.all([
    prisma.form16Upload.findMany({
      where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.salaryIncome.findMany({
      where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const totalGrossSalary = salaryIncomes.reduce((sum, s) => sum + Number(s.grossSalary), 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Form 16 &amp; salary income</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload a Form 16 for each employer you worked for in {CURRENT_ASSESSMENT_YEAR}. Every upload goes through a
          review screen before anything is saved — nothing is trusted automatically.
        </p>
      </div>

      <UploadForm />

      <p className="text-sm text-zinc-500">
        No Form 16, or a scanned PDF with no extractable text?{" "}
        <Link href="/form16/manual" className="font-medium underline">
          Enter salary details manually
        </Link>
        .
      </p>

      {uploads.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Uploads</h2>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {uploads.map((upload) => (
              <li key={upload.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">{upload.employerName ?? "(employer name pending review)"}</p>
                  <p className="text-xs text-zinc-500">{STATUS_LABEL[upload.parseStatus] ?? upload.parseStatus}</p>
                </div>
                {upload.parseStatus !== "FAILED" && (
                  <Link href={`/form16/review/${upload.id}`} className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    {upload.parseStatus === "CONFIRMED" ? "View / re-review" : "Review & confirm"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Confirmed salary income for {CURRENT_ASSESSMENT_YEAR}
        </h2>
        {salaryIncomes.length === 0 ? (
          <p className="text-sm text-zinc-500">No salary income confirmed yet.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {salaryIncomes.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">{s.employerName}</p>
                    <p className="text-xs text-zinc-500">Gross salary: {formatMoney(s.grossSalary)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/form16/edit/${s.id}`} className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      Edit
                    </Link>
                    <DeleteSalaryIncomeButton id={s.id} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Total gross salary across {salaryIncomes.length} employer{salaryIncomes.length === 1 ? "" : "s"}:{" "}
              <strong>{formatMoney(totalGrossSalary)}</strong>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
