/**
 * Registration and login input validation — Phase 13.
 *
 * Registration is open to anyone, so this is the outermost boundary of the
 * app for an unauthenticated caller. Everything here is validated
 * server-side; the client form uses the same schemas, but that is for
 * feedback, not enforcement.
 */
import { z } from "zod";
import { PAN_REGEX, normalisePan } from "../blindIndex";

/**
 * Lowercased and trimmed at parse time so the value that reaches the unique
 * index is already canonical. Doing this in the schema rather than at each
 * call site means no code path can accidentally insert "A@b.com" alongside
 * "a@b.com" — the uniqueness guarantee depends on it.
 */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email address is too long"); // RFC 5321 practical maximum

/**
 * Indian mobile numbers, normalised to E.164 (+91XXXXXXXXXX).
 *
 * Accepts the forms people actually type — "98765 43210", "098765 43210",
 * "+91 98765 43210", "0091-9876543210" — and rejects anything that is not a
 * ten-digit subscriber number starting 6-9, which is the range TRAI allocates
 * to mobile services. Stored normalised so the same phone always looks the
 * same, even though the column is not unique.
 */
export const phoneField = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .transform((v) => v.replace(/^(?:\+91|0091|91(?=\d{10}$)|0)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), {
    message: "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9",
  })
  .transform((v) => `+91${v}`);

export const panField = z
  .string()
  .trim()
  .transform(normalisePan)
  .refine((v) => PAN_REGEX.test(v), {
    message: "Enter a valid PAN, e.g. ABCDE1234F",
  });

/**
 * Password rules.
 *
 * Length is the requirement that actually matters, so the floor is 12 rather
 * than the more common 8. No composition rules (must contain a symbol, a
 * digit, mixed case): they measurably push people toward predictable
 * substitutions like "Password1!" without adding real entropy, and NIST
 * SP 800-63B advises against mandating them. The upper bound exists because
 * scrypt's cost is driven by input length and an unbounded password is a
 * cheap way to make the server do expensive work.
 */
export const passwordField = z
  .string()
  .min(12, "Use at least 12 characters — length matters more than symbols")
  .max(200, "Password is too long");

/**
 * Registration is invite-only (see app/api/auth/register/route.ts). Trimmed
 * but NOT case-folded: codes are generated from a case-sensitive alphabet, so
 * lowercasing would collapse distinct codes and shrink the keyspace.
 */
export const inviteCodeField = z.string().trim().min(1, "An invite code is required to create an account").max(100);

export const registrationSchema = z
  .object({
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
    fullName: z.string().trim().min(1, "Enter your full name").max(200),
    pan: panField,
    phone: phoneField,
    inviteCode: inviteCodeField,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegistrationFormValues = z.input<typeof registrationSchema>;
export type RegistrationInput = z.output<typeof registrationSchema>;

export const loginSchema = z.object({
  email: emailField,
  // Deliberately NOT `passwordField`: applying the registration rules to a
  // login attempt would reject a legitimate older password and, worse, would
  // tell an attacker which candidate passwords are even worth submitting.
  password: z.string().min(1, "Enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;
