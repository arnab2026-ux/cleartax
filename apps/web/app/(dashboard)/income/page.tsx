import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { getCurrentTaxpayerProfile } from "@/lib/getCurrentTaxpayerProfile";
import { prisma } from "@/lib/db";
import { deleteCapitalGainAsset, deleteHouseProperty, deleteOtherSourceIncome } from "./actions";
import { CapitalGainForm } from "./CapitalGainForm";
import { DeleteRowButton } from "./DeleteRowButton";
import { HousePropertyForm } from "./HousePropertyForm";
import { OtherSourceForm } from "./OtherSourceForm";

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function IncomePage() {
  const profile = await getCurrentTaxpayerProfile();

  const [houseProperties, capitalGainAssets, otherSourceIncomes] = await Promise.all([
    prisma.housePropertyIncome.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR }, orderBy: { createdAt: "asc" } }),
    prisma.capitalGainAsset.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR }, orderBy: { createdAt: "asc" } }),
    prisma.otherSourceIncome.findMany({ where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Other income</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          House property, capital gains, and other-sources income for {CURRENT_ASSESSMENT_YEAR}. Salary income is
          entered on the Form 16 step.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">House property</h2>
        <HousePropertyForm />
        {houseProperties.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {houseProperties.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                    {p.propertyType === "SELF_OCCUPIED" ? "Self-occupied" : "Let-out"}
                    {p.address ? ` — ${p.address}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Net income/loss (last computed): {formatMoney(p.netIncomeOrLoss)} · Loan interest: {formatMoney(p.homeLoanInterest)}
                  </p>
                </div>
                <DeleteRowButton action={deleteHouseProperty.bind(null, p.id)} confirmMessage="Remove this property?" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Capital gains</h2>
        <CapitalGainForm />
        {capitalGainAssets.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {capitalGainAssets.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                    {a.description || a.assetType} — {formatDate(a.acquisitionDate)} → {formatDate(a.saleDate)}
                  </p>
                  <p className="text-xs text-zinc-500">Gain/loss: {formatMoney(a.computedGainAmount)}</p>
                </div>
                <DeleteRowButton action={deleteCapitalGainAsset.bind(null, a.id)} confirmMessage="Remove this transaction?" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Other-sources income</h2>
        <OtherSourceForm />
        {otherSourceIncomes.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {otherSourceIncomes.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                    {o.sourceType.replaceAll("_", " ")} {o.description ? `— ${o.description}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">{formatMoney(o.amount)}</p>
                </div>
                <DeleteRowButton action={deleteOtherSourceIncome.bind(null, o.id)} confirmMessage="Remove this income?" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
