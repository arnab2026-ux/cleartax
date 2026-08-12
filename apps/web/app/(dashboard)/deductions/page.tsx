import { getAgeCategory } from "@cleartax/tax-engine";
import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import {
  checkSection80CCap,
  checkSection80CCD1BCap,
  checkSection80DParentsCap,
  checkSection80DPreventiveCheckupCap,
  checkSection80DSelfFamilyCap,
  checkSection80TtaCap,
  checkSection80TtbCap,
  type CapCheck,
} from "@/lib/deductionCaps";
import { computeAgeForAssessmentYear } from "@/lib/dateMath";
import { getCurrentTaxpayerProfile } from "@/lib/getCurrentTaxpayerProfile";
import { interestIncomeForTtaOrTtb, reconstructSection80CCD2, reconstructSection80D, sumSectionAmount } from "@/lib/mapping/toTaxEngineInput";
import { prisma } from "@/lib/db";
import { deleteDeduction } from "./actions";
import { DeleteRowButton } from "../income/DeleteRowButton";
import { Section80CCD2Form } from "./Section80CCD2Form";
import { Section80DForm } from "./Section80DForm";
import { SimpleDeductionForm } from "./SimpleDeductionForm";

function formatMoney(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

function CapBanner({ check, label }: { check: CapCheck; label: string }) {
  return (
    <p className={`text-sm ${check.overCap ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>
      {label}: {formatMoney(check.claimed)} of a {formatMoney(check.cap)} cap
      {check.overCap && ` — ₹${check.excess.toLocaleString("en-IN")} over the cap will be ignored in the computation`}
    </p>
  );
}

export default async function DeductionsPage() {
  const profile = await getCurrentTaxpayerProfile();

  const [deductions, salaryIncomes, otherSourceIncomes] = await Promise.all([
    prisma.deduction.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR }, orderBy: { createdAt: "asc" } }),
    prisma.salaryIncome.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
    prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR } }),
  ]);

  const deductionRows = deductions.map((d) => ({ section: d.section, amount: Number(d.amount), metaJson: d.metaJson }));
  const otherSourceRows = otherSourceIncomes.map((o) => ({ sourceType: o.sourceType, amount: Number(o.amount) }));

  const ageCategory = getAgeCategory(computeAgeForAssessmentYear(profile.dateOfBirth, CURRENT_ASSESSMENT_YEAR));
  const isSenior = ageCategory === "senior" || ageCategory === "superSenior";
  const basicSalaryTotal = salaryIncomes.reduce((sum, s) => sum + Number(s.basicSalary), 0);

  const section80CTotal = sumSectionAmount(deductionRows, "SECTION_80C");
  const section80CCD1BTotal = sumSectionAmount(deductionRows, "SECTION_80CCD_1B");
  const section80D = reconstructSection80D(deductionRows);
  const section80CCD2 = reconstructSection80CCD2(deductionRows, basicSalaryTotal);
  const interestForTtaTtb = interestIncomeForTtaOrTtb(otherSourceRows, ageCategory);

  const eightyC = deductions.filter((d) => d.section === "SECTION_80C");
  const eightyCcd1b = deductions.filter((d) => d.section === "SECTION_80CCD_1B");

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Chapter VI-A deductions</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Old-regime deductions for {CURRENT_ASSESSMENT_YEAR}. Caps shown below come directly from{" "}
          <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">@cleartax/tax-engine</code> — entering more
          than the cap is fine, the computation will simply apply the cap.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Section 80C</h2>
        <CapBanner check={checkSection80CCap(section80CTotal)} label="Total 80C claimed" />
        <SimpleDeductionForm section="SECTION_80C" placeholder="e.g. PPF, ELSS, life insurance" />
        {eightyC.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {eightyC.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {d.description || "80C instrument"} — {formatMoney(Number(d.amount))}
                </span>
                <DeleteRowButton action={deleteDeduction.bind(null, d.id)} confirmMessage="Remove this entry?" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Section 80D (health insurance)</h2>
        <CapBanner
          check={checkSection80DSelfFamilyCap(section80D.selfAndFamilyPremium, section80D.selfOrFamilyHasSenior)}
          label="Self & family (incl. preventive check-up)"
        />
        <CapBanner check={checkSection80DParentsCap(section80D.parentsPremium, section80D.parentsHaveSenior)} label="Parents" />
        <CapBanner check={checkSection80DPreventiveCheckupCap(section80D.preventiveHealthCheckup)} label="Preventive check-up sub-limit" />
        <Section80DForm
          initial={{
            selfAndFamilyPremium: section80D.selfAndFamilyPremium,
            selfOrFamilyHasSenior: section80D.selfOrFamilyHasSenior,
            parentsPremium: section80D.parentsPremium,
            parentsHaveSenior: section80D.parentsHaveSenior,
            preventiveHealthCheckup: section80D.preventiveHealthCheckup,
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Section 80CCD(1B) — additional NPS</h2>
        <CapBanner check={checkSection80CCD1BCap(section80CCD1BTotal)} label="Total 80CCD(1B) claimed" />
        <SimpleDeductionForm section="SECTION_80CCD_1B" placeholder="e.g. NPS Tier I own contribution" />
        {eightyCcd1b.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {eightyCcd1b.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {d.description || "NPS contribution"} — {formatMoney(Number(d.amount))}
                </span>
                <DeleteRowButton action={deleteDeduction.bind(null, d.id)} confirmMessage="Remove this entry?" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Section 80CCD(2) — employer NPS</h2>
        <p className="text-sm text-zinc-500">
          Survives both regimes (14% of basic salary, or 10% for non-government employees under the old regime).
          Basic salary on record: {formatMoney(basicSalaryTotal)}.
        </p>
        <Section80CCD2Form initial={{ employerContribution: section80CCD2.employerContribution, employmentType: section80CCD2.employmentType }} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Section 80TTA / 80TTB — interest income</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Computed automatically from your other-sources interest income (Income step) and age — not manually entered.
        </p>
        {isSenior ? (
          <CapBanner check={checkSection80TtbCap(interestForTtaTtb)} label="80TTB (all bank/post-office interest, 60+)" />
        ) : (
          <CapBanner check={checkSection80TtaCap(interestForTtaTtb)} label="80TTA (savings account interest only)" />
        )}
      </section>
    </div>
  );
}
