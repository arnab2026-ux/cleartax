/**
 * Display-time masking for PII fields that are encrypted at rest
 * (`TaxpayerProfile.pan` / `.aadhaar` / `.bankAccountNumber` — see
 * `lib/prismaFieldEncryption.ts`). Masking here is a UI/display concern
 * only — it does not affect what's stored or how it's encrypted; the
 * decrypted plaintext still round-trips through server components/actions,
 * this just controls what's rendered by default (reveal is an explicit
 * client-side toggle in the profile UI).
 *
 * Convention: mask every character except the last `keepLast`, preserving
 * the original length (so the masked string still visually hints at the
 * real value's length, matching common Indian fintech UI conventions like
 * "XXXXX1234F" for a masked PAN).
 */
function maskValue(value: string | null | undefined, keepLast: number): string {
  if (!value) return "";
  if (value.length <= keepLast) return "X".repeat(value.length);
  return "X".repeat(value.length - keepLast) + value.slice(value.length - keepLast);
}

/** e.g. "ABCDE1234F" -> "XXXXX1234F" (keeps the last 5 characters — PAN's digit+checksum-letter suffix). */
export function maskPan(pan: string | null | undefined): string {
  return maskValue(pan, 5);
}

/** e.g. "234567890123" -> "XXXXXXXX0123" (keeps the last 4 digits). */
export function maskAadhaar(aadhaar: string | null | undefined): string {
  return maskValue(aadhaar, 4);
}

/** e.g. "000123456789012" -> "XXXXXXXXXXX9012" (keeps the last 4 digits). */
export function maskBankAccountNumber(accountNumber: string | null | undefined): string {
  return maskValue(accountNumber, 4);
}
