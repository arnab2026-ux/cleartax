import { z } from "zod";
import { money, optionalText } from "./shared";

/** Section 80C or 80CCD(1B): a single amount + optional description — one Deduction row per instrument. */
export const simpleDeductionSchema = z.object({
  amount: money("Amount"),
  description: optionalText(300, "Description"),
});
export type SimpleDeductionFormValues = z.infer<typeof simpleDeductionSchema>;

/**
 * Section 80D: one form, split server-side (in `app/(dashboard)/deductions/actions.ts`)
 * into up to three `Deduction` rows (self+family / parents / preventive
 * checkup — see `schema.prisma`'s `Deduction.metaJson` doc comment for why
 * three rows are needed instead of one), which
 * `lib/mapping/toTaxEngineInput.ts`'s `reconstructSection80D` regroups back
 * into `Section80DInput` at computation time.
 */
export const section80DSchema = z.object({
  selfAndFamilyPremium: money("Self & family premium"),
  selfOrFamilyHasSenior: z.boolean(),
  parentsPremium: money("Parents' premium"),
  parentsHaveSenior: z.boolean(),
  preventiveHealthCheckup: money("Preventive health check-up spend"),
});
export type Section80DFormValues = z.infer<typeof section80DSchema>;

export const EMPLOYMENT_TYPES = ["government", "other"] as const;

/** Section 80CCD(2): employer's NPS contribution — cap depends on employment type (see `Deduction.metaJson`). */
export const section80CCD2Schema = z.object({
  employerContribution: money("Employer NPS contribution"),
  employmentType: z.enum(EMPLOYMENT_TYPES),
});
export type Section80CCD2FormValues = z.infer<typeof section80CCD2Schema>;
