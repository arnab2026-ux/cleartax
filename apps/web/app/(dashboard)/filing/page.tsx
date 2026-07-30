import Link from "next/link";
import { isEligibleForItr1 } from "@cleartax/itr-schema";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getTaxpayerProfileOrNull } from "@/lib/getOrCreateTaxpayerProfile";
import { checkItrProfileCompleteness } from "@/lib/mapping/toItrSchemaInput";
import { loadItrExportInputForComputation } from "@/lib/loadItrExportInput";
import { prisma } from "@/lib/db";
import { FilingDetailsForm } from "./FilingDetailsForm";
import { GenerateItrSection } from "./GenerateItrSection";

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

/**
 * Phase 6: extends the Phase 5 placeholder additively. Still shows the
 * latest saved `TaxComputation` summary (unchanged from before), and now
 * also offers real ITR JSON generation: a small form for the taxpayer
 * details the ITR JSON schema needs but `/profile` never collected
 * (`FilingDetailsForm`), then (once those are complete) ITR-1/ITR-2
 * generation + download (`GenerateItrSection`) plus a history of
 * previously generated artifacts. Phase 7's mock filing-provider status
 * will land here too, additively, once built.
 */
export default async function FilingPage() {
  const profile = await getTaxpayerProfileOrNull();
  const latest = profile
    ? await prisma.taxComputation.findFirst({
        where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
        orderBy: { computedAt: "desc" },
      })
    : null;

  const artifacts = profile
    ? await prisma.itrJsonArtifact.findMany({
        where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
        orderBy: { generatedAt: "desc" },
      })
    : [];

  const completeness = profile ? checkItrProfileCompleteness(profile) : { complete: false, missingFields: [] };

  let itr1Eligible = false;
  let itr1IneligibleReasons: string[] = [];
  if (latest && completeness.complete) {
    try {
      const input = await loadItrExportInputForComputation(latest.id);
      const eligibility = isEligibleForItr1(input);
      itr1Eligible = eligibility.eligible;
      itr1IneligibleReasons = eligibility.reasons;
    } catch {
      // Leave itr1Eligible false / reasons empty — GenerateItrSection will
      // still render, and generateItrJson (the Server Action) will surface
      // any real error clearly if the taxpayer tries to generate anyway.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Filing</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Generate and download your ITR JSON here. Filing status tracking (Phase 7, a mock filing provider — this app never submits a real
          return anywhere) will appear here once built.
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

      {latest && !completeness.complete && (
        <FilingDetailsForm
          initial={{
            fatherName: profile?.fatherName ?? undefined,
            email: profile?.email ?? undefined,
            mobileNumber: profile?.mobileNumber ?? undefined,
          }}
        />
      )}

      {latest && completeness.complete && (
        <GenerateItrSection taxComputationId={latest.id} itr1Eligible={itr1Eligible} itr1IneligibleReasons={itr1IneligibleReasons} />
      )}

      {artifacts.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Previously generated ITR JSON files</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="flex items-center justify-between gap-2">
                <span>
                  {artifact.itrType} — {artifact.generatedAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                <a href={`/api/itr/${artifact.id}/download`} className="font-medium text-blue-600 underline dark:text-blue-400">
                  Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
