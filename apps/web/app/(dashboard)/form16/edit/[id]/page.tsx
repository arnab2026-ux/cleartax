import { notFound } from "next/navigation";
import { getCurrentTaxpayerProfile } from "@/lib/getCurrentTaxpayerProfile";
import { decimalToNumber } from "@/lib/mapping/toTaxEngineInput";
import { prisma } from "@/lib/db";
import { updateSalaryIncome } from "../../actions";
import { SalaryIncomeForm } from "../../SalaryIncomeForm";

export default async function EditSalaryIncomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentTaxpayerProfile();
  const row = await prisma.salaryIncome.findFirst({ where: { id, taxpayerProfileId: profile.id } });
  if (!row) notFound();

  const initial = {
    employerName: row.employerName,
    grossSalary: decimalToNumber(row.grossSalary),
    basicSalary: decimalToNumber(row.basicSalary),
    hraReceived: decimalToNumber(row.hraReceived),
    rentPaid: decimalToNumber(row.rentPaid),
    isMetroCity: row.isMetroCity,
    ltaReceived: decimalToNumber(row.ltaReceived),
    otherAllowances: decimalToNumber(row.otherAllowances),
    perquisitesValue: decimalToNumber(row.perquisitesValue),
    exemptHra: decimalToNumber(row.exemptHra),
    exemptLta: decimalToNumber(row.exemptLta),
    exemptOther: decimalToNumber(row.exemptOther),
    exemptRetirementSection10: decimalToNumber(row.exemptRetirementSection10),
    standardDeduction: decimalToNumber(row.standardDeduction),
    professionalTax: decimalToNumber(row.professionalTax),
    tdsDeducted: decimalToNumber(row.tdsDeducted),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit salary income</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{row.employerName}</p>
      </div>
      <SalaryIncomeForm
        initial={initial}
        onSubmitAction={updateSalaryIncome.bind(null, id)}
        submitLabel="Save changes"
        redirectTo="/form16"
      />
    </div>
  );
}
