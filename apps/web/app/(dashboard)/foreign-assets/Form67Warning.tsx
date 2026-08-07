/**
 * The Form 67 warning. Rendered wherever a foreign tax credit is claimed or
 * displayed (`/foreign-assets` and `/filing`), because without Form 67 the
 * credit is simply DENIED — the taxpayer would file a return claiming relief
 * they never became entitled to, and this app cannot file Form 67 for them
 * (it never submits anything to the portal; a fixed project boundary).
 *
 * Rule 128(8)/(9). The deadline was relaxed by CBDT Notification No. 100/2022
 * dated 18-08-2022: Form 67 may now be furnished on or before the END OF THE
 * ASSESSMENT YEAR (31 March 2027 for AY 2026-27), provided the return itself
 * is filed within the Section 139(1) or 139(4) window — it used to be due by
 * the return's own due date. For an updated return under Section 139(8A),
 * Form 67 must be filed on or before the date of that updated return.
 *
 * A server component: it renders identical static markup everywhere and needs
 * no interactivity, so there is no reason to ship it to the client.
 */
export function Form67Warning({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">Form 67 must be filed separately — this app cannot do it for you.</p>
      <p>
        A foreign tax credit is <strong>denied outright</strong> unless Form 67 is furnished on the income-tax e-filing
        portal. Filing the return alone is not enough: the credit shown here will simply not be allowed.
      </p>
      {!compact && (
        <>
          <p>
            <strong>Deadline (AY 2026-27):</strong> on or before <strong>31 March 2027</strong> (the end of the
            assessment year), as long as the return itself is filed within the Section 139(1) or 139(4) window. If you
            file an updated return under Section 139(8A), Form 67 must go in on or before that return&rsquo;s date.
          </p>
          <p>
            <strong>Where:</strong> incometax.gov.in &rarr; e-File &rarr; Income Tax Forms &rarr; File Income Tax Forms
            &rarr; Form 67. You will need a certificate or statement of the tax deducted/paid abroad (for US dividends,
            the Form 1042-S or the broker&rsquo;s annual tax statement).
          </p>
          <p className="text-xs">
            Rule 128(8) and (9) of the Income-tax Rules, 1962, as amended by CBDT Notification No. 100/2022 dated
            18 August 2022.
          </p>
        </>
      )}
    </div>
  );
}
