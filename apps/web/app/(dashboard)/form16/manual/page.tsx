import { createManualSalaryIncome } from "../actions";
import { SalaryIncomeForm } from "../SalaryIncomeForm";

const EMPTY: Parameters<typeof SalaryIncomeForm>[0]["initial"] = {
  employerName: "",
  grossSalary: 0,
  basicSalary: 0,
  hraReceived: 0,
  rentPaid: 0,
  isMetroCity: false,
  ltaReceived: 0,
  otherAllowances: 0,
  perquisitesValue: 0,
  exemptHra: 0,
  exemptLta: 0,
  exemptOther: 0,
  exemptRetirementSection10: 0,
  standardDeduction: 0,
  professionalTax: 0,
  tdsDeducted: 0,
};

export default function ManualSalaryIncomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Enter salary income manually</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          For employers without a parseable Form 16 (scanned PDF, cash salary, etc).
        </p>
      </div>
      <SalaryIncomeForm initial={EMPTY} onSubmitAction={createManualSalaryIncome} submitLabel="Save salary income" redirectTo="/form16" />
    </div>
  );
}
