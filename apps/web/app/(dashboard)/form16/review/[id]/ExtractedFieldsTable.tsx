import type { ReviewFieldRow } from "@/lib/form16Review";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/** Read-only display of every extracted field next to its confidence + raw source text — the transparency half of the mandatory review step (the editable half is `SalaryIncomeForm`). */
export function ExtractedFieldsTable({ rows, title }: { rows: ReviewFieldRow[]; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Extracted value</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Source text</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((row) => (
              <tr key={row.key} className={row.confidence === "low" || !row.found ? "bg-red-50/50 dark:bg-red-950/20" : undefined}>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{row.label}</td>
                <td className="px-3 py-2 font-mono text-zinc-800 dark:text-zinc-200">
                  {row.found ? row.value : <span className="italic text-zinc-400">not found{row.reason ? ` — ${row.reason}` : ""}</span>}
                </td>
                <td className="px-3 py-2">
                  {row.confidence && (
                    <span className={`rounded px-1.5 py-0.5 font-medium ${CONFIDENCE_STYLE[row.confidence]}`}>{row.confidence}</span>
                  )}
                </td>
                <td className="max-w-[240px] truncate px-3 py-2 text-zinc-500" title={row.sourceText ?? undefined}>
                  {row.sourceText ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
