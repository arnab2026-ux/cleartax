import { CURRENT_ASSESSMENT_YEAR } from "@/lib/assessmentYear";
import { foreignAssetReportingPeriod } from "@/lib/foreignAssetPeriod";
import { getOrCreateTaxpayerProfile } from "@/lib/getOrCreateTaxpayerProfile";
import { prisma } from "@/lib/db";
import { DeleteRowButton } from "../income/DeleteRowButton";
import { deleteForeignAsset, deleteForeignSourceIncome } from "./actions";
import { ForeignAssetForm } from "./ForeignAssetForm";
import { ForeignIncomeForm } from "./ForeignIncomeForm";
import { Form67Warning } from "./Form67Warning";

function formatMoney(value: unknown): string {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

/** Table letter out of the Prisma enum value ("A3_FOREIGN_EQUITY_DEBT_INTEREST" -> "A3"). */
function tableLetter(assetType: string): string {
  return assetType.split("_")[0] as string;
}

export default async function ForeignAssetsPage() {
  const profile = await getOrCreateTaxpayerProfile();
  const period = foreignAssetReportingPeriod(CURRENT_ASSESSMENT_YEAR);

  const [foreignAssets, foreignIncomes] = await Promise.all([
    prisma.foreignAsset.findMany({
      where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
      orderBy: { createdAt: "asc" },
    }),
    prisma.foreignSourceIncome.findMany({
      where: { taxpayerProfileId: profile.id, assessmentYear: CURRENT_ASSESSMENT_YEAR },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const isRor = profile.residentialStatus === "ROR";
  const claimsCredit = foreignIncomes.some((i) => Number(i.foreignTaxPaid) > 0);
  const unfiledForm67 = foreignIncomes.filter((i) => Number(i.foreignTaxPaid) > 0 && !i.form67Filed);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Foreign assets &amp; income</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Schedule FA (foreign asset disclosure), Schedule FSI (foreign income) and Schedule TR (tax relief) for{" "}
          {CURRENT_ASSESSMENT_YEAR}. Holding any foreign asset means you must file ITR-2, whatever the asset is worth.
        </p>
      </div>

      {/* The calendar-year trap: stated once, prominently, in the user's own
          terms. Everything else in an ITR runs 1 April to 31 March; this
          schedule does not, and mis-reading it is the single most common
          Schedule FA error. */}
      <div className="flex flex-col gap-2 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
        <p className="font-semibold">Report the CALENDAR year {period.calendarYear} — not the financial year.</p>
        <p>
          For {CURRENT_ASSESSMENT_YEAR}, Schedule FA covers assets held at any time between{" "}
          <strong>{period.label}</strong>. This is the one part of your return that does not run 1 April to 31 March.
          Disclose anything you held for even a single day in that window, including assets you have since sold.
        </p>
        <p>
          There is <strong>no minimum value</strong> below which disclosure can be skipped — the reporting obligation
          applies however small the asset.
        </p>
        <p>
          Non-disclosure can attract a penalty of ₹10,00,000 per year under Section 43 of the Black Money (Undisclosed
          Foreign Income and Assets and Imposition of Tax) Act, 2015. Since 1 October 2024 that penalty does not apply
          where the undisclosed assets are <em>not</em> immovable property and their aggregate value stayed at or below
          ₹20,00,000 during the financial year (Finance (No. 2) Act 2024). That relief is from the penalty only, not
          from the duty to report — and it does not cover foreign immovable property at any value.
        </p>
      </div>

      {!isRor && (
        <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <p className="font-semibold">
            Your residential status is {profile.residentialStatus === "RNOR" ? "Resident but Not Ordinarily Resident" : "Non-Resident"}.
          </p>
          <p className="mt-1">
            Schedule FA applies only to a Resident and Ordinarily Resident individual, so anything you record below will
            be kept for your records but <strong>will not appear in the generated ITR JSON</strong>. Foreign income and
            the foreign tax credit are unaffected and still reported. Change this on the Profile step if it is wrong.
          </p>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Foreign assets (Schedule FA)</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Vested RSUs or ESOPs need <strong>two</strong> rows and that is correct, not duplication: the shares
            themselves as an <strong>A3</strong> row, and the brokerage account holding them as an <strong>A2</strong>{" "}
            row. A plain foreign bank account is <strong>A1</strong>.
          </p>
        </div>
        <ForeignAssetForm periodLabel={period.label} />
        {foreignAssets.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {foreignAssets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold dark:bg-zinc-800">
                      {tableLetter(a.assetType)}
                    </span>{" "}
                    {a.description || a.entityName || a.countryName} — {a.countryName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Held from {formatDate(a.acquisitionDate)} · Initial {formatMoney(a.initialValue)} · Peak{" "}
                    {formatMoney(a.peakValue)} · Closing {formatMoney(a.closingValue)}
                    {Number(a.incomeAccrued) > 0 ? ` · Income ${formatMoney(a.incomeAccrued)}` : ""}
                    {Number(a.grossProceeds) > 0 ? ` · Sale proceeds ${formatMoney(a.grossProceeds)}` : ""}
                  </p>
                </div>
                <DeleteRowButton action={deleteForeignAsset.bind(null, a.id)} confirmMessage="Remove this foreign asset?" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Foreign income &amp; tax credit (Schedules FSI / TR)
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Unlike Schedule FA above, this runs on the ordinary financial year. Foreign dividends are taxed at your
            normal slab rate as income from other sources; the tax withheld abroad comes back as a credit, capped at the
            Indian tax on that same income (Rule 128).
          </p>
        </div>
        <Form67Warning />
        <ForeignIncomeForm />
        {foreignIncomes.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {foreignIncomes.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                    {i.description || i.head.replaceAll("_", " ").toLowerCase()} — {i.countryName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Income {formatMoney(i.incomeAmount)} · Foreign tax {formatMoney(i.foreignTaxPaid)}
                    {i.dtaaRateCapPercent !== null ? ` · Treaty rate ${Number(i.dtaaRateCapPercent)}%` : ""} ·{" "}
                    {i.reliefSection.replace("SECTION_", "Section ")}
                    {i.alreadyIncludedInIndianIncome ? " · already counted in another income head" : " · added to other-sources income"}
                  </p>
                  {Number(i.foreignTaxPaid) > 0 && (
                    <p className={`text-xs ${i.form67Filed ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                      {i.form67Filed ? "Form 67 filed" : "Form 67 NOT filed — the credit will be denied without it"}
                    </p>
                  )}
                </div>
                <DeleteRowButton action={deleteForeignSourceIncome.bind(null, i.id)} confirmMessage="Remove this foreign income?" />
              </li>
            ))}
          </ul>
        )}
        {claimsCredit && unfiledForm67.length > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            {unfiledForm67.length} foreign-income {unfiledForm67.length === 1 ? "entry claims" : "entries claim"} a tax
            credit without Form 67 filed. File it on the portal before 31 March 2027, or that credit will be denied.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">If you sold foreign shares</h2>
        <p>
          Record the sale itself on the <strong>Income</strong> step as a capital gain, choosing the asset type{" "}
          <strong>&ldquo;Foreign shares (incl. US RSUs/ESOPs)&rdquo;</strong>. Shares in a foreign company are not
          &ldquo;listed&rdquo; for Indian tax purposes even when they trade on NASDAQ or the NYSE, so they take the
          24-month long-term holding period and the flat 12.5% Section 112 rate — not the 12-month period, the ₹1,25,000
          exemption, or the 20% short-term rate that apply to Indian listed shares.
        </p>
        <p>
          Your cost base is the fair market value on the vest date — the same amount already taxed as a perquisite in
          your Form 16, so it is not taxed twice.
        </p>
      </section>
    </div>
  );
}
