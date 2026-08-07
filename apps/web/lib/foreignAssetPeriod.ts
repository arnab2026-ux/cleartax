/**
 * The single place that derives Schedule FA's reporting period from an
 * assessment year — Phase 11.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ============================================================================
 * Every other date in this app runs on the Indian FINANCIAL year: AY 2026-27
 * means 1 April 2025 to 31 March 2026. Schedule FA does NOT. It runs on the
 * CALENDAR year ending 31 December falling within that previous year, so for
 * AY 2026-27 the reporting period is **1 January 2025 to 31 December 2025**.
 *
 * This is the single most common real-world Schedule FA mistake, and it is
 * easy to make because nothing else in an ITR behaves this way. Rather than
 * let the correct dates be re-derived (and eventually mis-derived) at each
 * call site, they are computed once here and rendered directly into the UI
 * copy, so what the user is asked for and what the ITR JSON claims can never
 * drift apart.
 *
 * SOURCES (verified 2026-08-01):
 *  - Income Tax Department, "Step-by-Step Guide to Fill FSI, TR, and FA
 *    Schedule in ITR", incometax.gov.in/iec/foportal/sites/default/files/
 *    2026-03/: assets must be reported if "held at any time during the
 *    relevant calendar year ending on December 31st", and — the worked
 *    example that pins the offset beyond doubt — "For Assessment Year
 *    2025-26, the calendar year ending on December 31st comprises the period
 *    from January 1, 2024, to December 31, 2024."
 *  - The wording changed from "accounting period" to the explicit "calendar
 *    year ending as on 31st December" in the AY 2022-23 ITR forms notified by
 *    CBDT Notification No. 21/2022 dated 30-03-2022, and has been
 *    calendar-year ever since (taxguru.in's "Key Changes in Income Tax
 *    Returns (ITRs) for AY 2022-23"). So this is stable, not a one-year
 *    quirk.
 *  - Corroborated for AY 2026-27 specifically by nbaoffice.com, vested.blog
 *    and tax2win.in, all of which state the AY 2026-27 period as 1 January
 *    2025 to 31 December 2025.
 *
 * ============================================================================
 * VALUATION RATE (stated here because it belongs with the period)
 * ============================================================================
 * Values are converted to INR at the State Bank of India TELEGRAPHIC
 * TRANSFER BUYING RATE on the relevant date: the date of the peak balance,
 * the date of investment, or 31 December for the closing value (departmental
 * guide, same source). For a weekend/holiday with no published rate, the
 * immediately preceding working day's rate applies.
 *
 * NOTE this is a DIFFERENT rule from the one for converting foreign TAX
 * (Rule 128(5)(ii): TTBR on the last day of the month immediately PRECEDING
 * the month in which the tax was paid or deducted). The two are frequently
 * conflated; they must not be.
 */

export interface ForeignAssetReportingPeriod {
  /** Calendar year reported on, e.g. 2025 for AY 2026-27. */
  calendarYear: number;
  /** 1 January of `calendarYear`, UTC. */
  start: Date;
  /** 31 December of `calendarYear`, UTC. */
  end: Date;
  /** Human-readable period for UI copy, e.g. "1 January 2025 to 31 December 2025". */
  label: string;
}

/** `"2026-27"` -> 2026. Throws on a malformed assessment year rather than silently returning NaN and producing a nonsense period. */
function assessmentYearStart(assessmentYear: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(assessmentYear.trim());
  if (!match) {
    throw new Error(`Malformed assessment year "${assessmentYear}" — expected the "YYYY-YY" form this app uses everywhere, e.g. "2026-27".`);
  }
  return Number(match[1]);
}

/**
 * For AY `Y`-`Y+1`, the previous year is `Y-1` April to `Y` March, and the
 * calendar year ending 31 December WITHIN that previous year is `Y-1`.
 * So AY 2026-27 -> calendar 2025. Expressed as `start - 1` rather than a
 * magic constant so the derivation is auditable.
 */
export function foreignAssetReportingPeriod(assessmentYear: string): ForeignAssetReportingPeriod {
  const calendarYear = assessmentYearStart(assessmentYear) - 1;
  return {
    calendarYear,
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 11, 31)),
    label: `1 January ${calendarYear} to 31 December ${calendarYear}`,
  };
}

/**
 * Whether a date falls inside the Schedule FA reporting period. Used only to
 * WARN in the UI (an acquisition date before the period is perfectly normal —
 * an asset bought in 2019 and still held in 2025 is reported with its
 * original acquisition date), never to block a save: this app must not refuse
 * to record a disclosure it merely finds surprising.
 */
export function isWithinForeignAssetPeriod(date: Date, assessmentYear: string): boolean {
  const period = foreignAssetReportingPeriod(assessmentYear);
  return date.getTime() >= period.start.getTime() && date.getTime() <= period.end.getTime();
}
