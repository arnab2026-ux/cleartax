import { z } from "zod";
import { money } from "./shared";

/**
 * Shared by three call sites: the Form 16 review/confirm screen (prefilled
 * from the parser's low-trust output), pure manual entry (no Form 16), and
 * editing an already-confirmed `SalaryIncome` row. All money fields are
 * non-negative — the tax engine's own `Math.max(0, ...)` clamps handle
 * negative inputs defensively, but there's no legitimate reason a salary
 * figure should be negative, so this schema rejects it up front with a
 * clear message instead of silently flooring it.
 */
export const salaryIncomeSchema = z.object({
  employerName: z.string().trim().min(1, "Employer name is required").max(200),
  grossSalary: money("Gross salary"),
  basicSalary: money("Basic salary"),
  hraReceived: money("HRA received"),
  rentPaid: money("Rent paid"),
  isMetroCity: z.boolean(),
  ltaReceived: money("LTA received"),
  otherAllowances: money("Other allowances"),
  perquisitesValue: money("Perquisites value"),
  exemptHra: money("Exempt HRA"),
  exemptLta: money("Exempt LTA"),
  exemptOther: money("Other exemptions"),
  /**
   * Gratuity 10(10) + commuted pension 10(10A) + leave encashment 10(10AA)
   * + VRS 10(10C), summed. Kept separate from `exemptOther` because these
   * survive the new regime and `exemptOther` does not — see
   * `schema.prisma`'s `SalaryIncome.exemptRetirementSection10`.
   */
  exemptRetirementSection10: money("Retirement exemptions under section 10"),
  standardDeduction: money("Standard deduction"),
  professionalTax: money("Professional tax"),
  tdsDeducted: money("TDS deducted"),
});

export type SalaryIncomeFormValues = z.infer<typeof salaryIncomeSchema>;
