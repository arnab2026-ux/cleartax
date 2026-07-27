/**
 * Small numeric helpers shared across the AY 2026-27 computation modules.
 *
 * Rates are represented as integer percentages (e.g. 15 for 15%) rather than
 * decimal fractions (0.15) specifically to avoid binary floating-point
 * representation error (0.15 is not exactly representable in IEEE754, and
 * compounding several such multiplications across slabs/rebate/surcharge/cess
 * can otherwise produce off-by-a-fraction-of-a-paisa results that break exact
 * boundary-value test assertions). `percentOf` divides by 100 only once per
 * call, and `roundPaisa` cleans up any residual floating-point noise after
 * each arithmetic step.
 */

/** amount * ratePercent / 100, e.g. percentOf(20000, 5) === 1000 */
export function percentOf(amount: number, ratePercent: number): number {
  return (amount * ratePercent) / 100;
}

/** Round to the nearest paisa (2 decimal places) to clean up float noise. */
export function roundPaisa(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Section 288A / 288B rounding: ignore (truncate) any paise, then round to
 * the nearest multiple of ten rupees — if the last digit is 5 or more, round
 * up; otherwise round down. Verified against charteredclub.com's worked
 * example (₹62,923.25 → ignore paise → ₹62,923 → last digit 3 < 5 → ₹62,920)
 * and the statutory text of Sections 288A/288B of the Income-tax Act, 1961.
 *
 * Section 288A rounds *total income* to the nearest ₹10 before tax is
 * computed on it; Section 288B rounds the *final tax payable* (not any
 * sub-head like surcharge or cess individually) to the nearest ₹10. Both
 * use the same rounding procedure, so this single helper serves both.
 */
export function roundToNearestTen(amount: number): number {
  const rupees = Math.floor(amount + 1e-9); // ignore paise; epsilon guards float noise
  const remainder = rupees % 10;
  if (remainder === 0) return rupees;
  if (remainder >= 5) return rupees + (10 - remainder);
  return rupees - remainder;
}
