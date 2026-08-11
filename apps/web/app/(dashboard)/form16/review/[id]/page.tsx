import { notFound } from "next/navigation";
import type { Form16ParseResult } from "@cleartax/pdf-form16";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import {
  defaultSalaryFromForm16,
  flattenChapterViaLines,
  flattenPartA,
  flattenPartB,
  flattenQuarterlyTds,
  needsReview,
  reconcileSection10,
} from "@/lib/form16Review";
import { decimalToNumber } from "@/lib/mapping/toTaxEngineInput";
import { prisma } from "@/lib/db";
import { confirmForm16Upload } from "../../actions";
import { SalaryIncomeForm } from "../../SalaryIncomeForm";
import { ExtractedFieldsTable } from "./ExtractedFieldsTable";

function isForm16ParseResult(value: unknown): value is Form16ParseResult {
  return typeof value === "object" && value !== null && "partA" in value && "partB" in value;
}

export default async function ReviewForm16Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getOrCreateTaxpayerProfile();

  const upload = await prisma.form16Upload.findFirst({ where: { id, taxpayerProfileId: profile.id } });
  if (!upload) notFound();

  if (!isForm16ParseResult(upload.rawExtractedJson)) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Review Form 16</h1>
        <p className="text-sm text-red-600 dark:text-red-400">
          This upload has no extracted data to review (parsing failed). Use{" "}
          <a href="/form16/manual" className="font-medium underline">
            manual entry
          </a>{" "}
          instead.
        </p>
      </div>
    );
  }

  const { partA, partB } = upload.rawExtractedJson;

  const existingSalaryIncome = await prisma.salaryIncome.findFirst({ where: { form16UploadId: id } });
  const initial = existingSalaryIncome
    ? {
        employerName: existingSalaryIncome.employerName,
        grossSalary: decimalToNumber(existingSalaryIncome.grossSalary),
        basicSalary: decimalToNumber(existingSalaryIncome.basicSalary),
        hraReceived: decimalToNumber(existingSalaryIncome.hraReceived),
        rentPaid: decimalToNumber(existingSalaryIncome.rentPaid),
        isMetroCity: existingSalaryIncome.isMetroCity,
        ltaReceived: decimalToNumber(existingSalaryIncome.ltaReceived),
        otherAllowances: decimalToNumber(existingSalaryIncome.otherAllowances),
        perquisitesValue: decimalToNumber(existingSalaryIncome.perquisitesValue),
        exemptHra: decimalToNumber(existingSalaryIncome.exemptHra),
        exemptLta: decimalToNumber(existingSalaryIncome.exemptLta),
        exemptOther: decimalToNumber(existingSalaryIncome.exemptOther),
        exemptRetirementSection10: decimalToNumber(existingSalaryIncome.exemptRetirementSection10),
        standardDeduction: decimalToNumber(existingSalaryIncome.standardDeduction),
        professionalTax: decimalToNumber(existingSalaryIncome.professionalTax),
        tdsDeducted: decimalToNumber(existingSalaryIncome.tdsDeducted),
      }
    : defaultSalaryFromForm16(partA, partB);

  const flagged = needsReview(partB);
  const chapterViaLines = flattenChapterViaLines(partB);

  // Does the certificate's own section 10 total agree with the heads we
  // identified? A shortfall means exemption is about to be taxed.
  const section10 = reconcileSection10(
    partB,
    initial.exemptHra + initial.exemptLta + initial.exemptOther + initial.exemptRetirementSection10
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Review Form 16</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Everything below was extracted heuristically from the uploaded PDF — check it carefully, especially anything
          flagged low-confidence or not found, then edit the fields below before confirming.
        </p>
        {flagged && (
          <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Some key fields were not found or extracted with low confidence — double-check the salary figures below.
          </p>
        )}
        {upload.parseStatus === "CONFIRMED" && (
          <p className="mt-2 rounded-md bg-green-100 px-3 py-2 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-300">
            Already confirmed. You can re-review and re-confirm if anything needs correcting.
          </p>
        )}
      </div>

      {section10.unattributed !== null && (
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          Your Form 16 claims {section10.reportedTotal?.toLocaleString("en-IN")} of total exemption under section 10, but
          only {section10.identifiedTotal.toLocaleString("en-IN")} could be matched to a specific exemption. The
          remaining {section10.unattributed.toLocaleString("en-IN")} will be taxed unless you add it below — put it under
          the retirement exemptions field if it is gratuity, commuted pension, leave encashment or VRS, and under other
          exemptions otherwise.
        </p>
      )}

      <ExtractedFieldsTable rows={flattenPartA(partA)} title="Part A — TDS certificate details" />
      <ExtractedFieldsTable rows={flattenPartB(partB)} title="Part B — salary breakup & tax computation" />

      {chapterViaLines.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Chapter VI-A deductions on this Form 16 (informational — add these on the Deductions step)
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            {chapterViaLines.map((line, i) => (
              <li key={i}>
                {line.section}: {line.rows[0]?.found ? line.rows[0].value : "not found"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {flattenQuarterlyTds(partA).length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Quarterly TDS (informational)</h3>
          {flattenQuarterlyTds(partA).map((q) => (
            <ExtractedFieldsTable key={q.quarter} rows={q.rows} title={q.quarter} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Confirm salary income</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Edit any field below, then confirm — only what you confirm here is saved as your salary income.
        </p>
        <SalaryIncomeForm initial={initial} onSubmitAction={confirmForm16Upload.bind(null, id)} submitLabel="Confirm salary income" redirectTo="/form16" />
      </div>
    </div>
  );
}
