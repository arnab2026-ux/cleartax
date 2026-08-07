import { z } from "zod";
import { optionalPattern, optionalText } from "./shared";

/** Standard PAN format: 5 letters, 4 digits, 1 letter, e.g. "ABCDE1234F". Always uppercased before validation. */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** 12-digit Aadhaar number (no spaces/dashes — the form strips them before validation). */
export const AADHAAR_REGEX = /^\d{12}$/;
/** Standard IFSC format: 4 letters (bank code) + 0 + 6 alphanumeric (branch code). */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Phase 11. Declared, never computed — this app does not implement the
 * Section 6 residency tests (182 days, or 60 days plus 365 days over the four
 * preceding years, plus the two additional RNOR conditions). It matters
 * because Schedule FA applies ONLY to a Resident and Ordinarily Resident
 * individual, and because ITR-1 is unavailable to RNOR/NR filers.
 */
export const RESIDENTIAL_STATUSES = ["ROR", "RNOR", "NR"] as const;

export const taxpayerProfileSchema = z.object({
  residentialStatus: z.enum(RESIDENTIAL_STATUSES),
  pan: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => PAN_REGEX.test(v), "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)"),
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  dateOfBirth: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date")
    .refine((value) => new Date(value).getTime() < Date.now(), "Date of birth must be in the past"),
  aadhaar: optionalPattern(AADHAAR_REGEX, "Aadhaar must be exactly 12 digits", (v) => v.replace(/[\s-]/g, "")),
  addressLine1: optionalText(200, "Address line 1"),
  addressLine2: optionalText(200, "Address line 2"),
  city: optionalText(100, "City"),
  state: optionalText(100, "State"),
  pincode: optionalPattern(/^\d{6}$/, "Pincode must be 6 digits"),
  bankAccountNumber: optionalPattern(/^\d{6,20}$/, "Bank account number must be 6-20 digits"),
  bankIfsc: optionalPattern(IFSC_REGEX, "Enter a valid IFSC code (e.g. HDFC0001234)", (v) => v.toUpperCase()),
  bankName: optionalText(200, "Bank name"),
});

export type TaxpayerProfileFormValues = z.infer<typeof taxpayerProfileSchema>;
