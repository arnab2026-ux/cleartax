import Link from "next/link";
import { isEligibleForItr1 } from "@cleartax/itr-schema";
import type { FilingStatusEvent } from "@cleartax/filing-provider";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getTaxpayerProfileOrNull } from "@/lib/getOrCreateTaxpayerProfile";
import { checkItrProfileCompleteness } from "@/lib/mapping/toItrSchemaInput";
import { loadItrExportInputForComputation } from "@/lib/loadItrExportInput";
import { prisma } from "@/lib/db";
import { Form67Warning } from "../foreign-assets/Form67Warning";
import { FilingDetailsForm } from "./FilingDetailsForm";
import { GenerateItrSection } from "./GenerateItrSection";
import { SubmitFilingSection, type ArtifactFilingRow } from "./SubmitFilingSection";

/** Defensively narrows a `FilingAttempt.statusHistoryJson` value back into `FilingStatusEvent[]` — same "don't trust JSON at runtime" pattern as `actions.ts`'s own `parseStatusHistory`. Duplicated here (rather than imported) since `actions.ts` is a `"use server"` module and this is a Server Component running in the same request, not calling through it. */
function parseStatusHistory(value: unknown): FilingStatusEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FilingStatusEvent =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).status === "string" &&
      typeof (item as Record<string, unknown>).at === "string" &&
      typeof (item as Record<string, unknown>).detail === "string",
  );
}

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

  // Phase 7: latest mock FilingAttempt per artifact, for SubmitFilingSection.
  const filingAttempts = profile
    ? await prisma.filingAttempt.findMany({
        where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const latestAttemptByArtifactId = new Map<string, (typeof filingAttempts)[number]>();
  for (const attempt of filingAttempts) {
    if (!latestAttemptByArtifactId.has(attempt.itrJsonArtifactId)) {
      latestAttemptByArtifactId.set(attempt.itrJsonArtifactId, attempt);
    }
  }
  const artifactRows: ArtifactFilingRow[] = artifacts.map((artifact) => {
    const attempt = latestAttemptByArtifactId.get(artifact.id);
    return {
      id: artifact.id,
      itrType: artifact.itrType,
      generatedAt: artifact.generatedAt.toISOString(),
      downloadHref: `/api/itr/${artifact.id}/download`,
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            acknowledgementNumber: attempt.acknowledgementNumber,
            statusHistory: parseStatusHistory(attempt.statusHistoryJson),
          }
        : null,
    };
  });

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
          Generate and download your ITR JSON here, then optionally run it through a mock, fully simulated filing/e-verification flow
          below — this app never submits a real return anywhere. See the simulation notice below the ITR JSON list for details.
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

      {/* Phase 11: the ITR JSON generated below CLAIMS this relief. Without
          Form 67 on the portal it is denied outright, and this app cannot file
          Form 67 — so the warning belongs here, at the point the artifact is
          actually produced, not only on the data-entry step. */}
      {latest && Number(latest.foreignTaxCredit) > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            This return claims a foreign tax credit of{" "}
            <strong>{formatMoney(Number(latest.foreignTaxCredit))}</strong> under Sections 90/90A/91.
          </p>
          <Form67Warning />
        </div>
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

      <SubmitFilingSection artifacts={artifactRows} />
    </div>
  );
}
