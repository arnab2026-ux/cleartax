/**
 * Validation for the small set of taxpayer details `/filing` collects that
 * `/profile` never did — see `schema.prisma`'s `TaxpayerProfile.email`/
 * `.mobileNumber`/`.fatherName` doc comment for why these exist at all
 * (the real ITR-1/ITR-2 JSON schema requires them; nothing in this app's
 * data model captured them before Phase 6). Deliberately a SEPARATE form/
 * schema from `lib/validation/profile.ts`'s `taxpayerProfileSchema` rather
 * than folding these fields into it — per Phase 6's scope discipline,
 * `/profile`'s page itself was not modified, so its form/schema stays
 * exactly as Phase 5 left it.
 */
import { z } from "zod";

const MOBILE_REGEX = /^\d{10}$/;

export const itrFilingDetailsSchema = z.object({
  fatherName: z.string().trim().min(1, "Father's name is required").max(125),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  mobileNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => MOBILE_REGEX.test(v), "Mobile number must be exactly 10 digits"),
});

export type ItrFilingDetailsFormValues = z.infer<typeof itrFilingDetailsSchema>;
