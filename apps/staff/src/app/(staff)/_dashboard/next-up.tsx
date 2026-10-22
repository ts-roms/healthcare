import Link from "next/link";
import { Badge } from "@healthcare/ui/primitives";
import type { NextUpRow } from "@/lib/dashboard-today";

/** The next appointments today: the viewer's own when they are a practitioner, else the facility's. */
export function NextUp({ rows, title, scheduleHref, canOpenRecord }: { rows: NextUpRow[]; title: string; scheduleHref: string; canOpenRecord: boolean }) {
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-section-lg font-semibold">{title}</h2>
        <Link href={scheduleHref} className="ml-auto text-table font-medium text-primary underline underline-offset-2">
          Full schedule
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-table text-muted-foreground">No more appointments today.</p>
      ) : (
        <ul className="mt-3 divide-y border-t">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-3">
              <span className="tabular w-12 shrink-0 font-mono text-table text-primary">{row.time}</span>
              <span className="min-w-0 flex-1">
                {canOpenRecord ? (
                  <Link href={`/patients/${row.patientId}`} className="block truncate text-body font-semibold hover:underline">
                    {row.patientName}
                  </Link>
                ) : (
                  <span className="block truncate text-body font-semibold">{row.patientName}</span>
                )}
                <span className="block truncate text-meta text-muted-foreground">
                  {row.provider} · {row.reason}
                </span>
              </span>
              {row.status === "checked_in" ? (
                <Badge variant="success">Checked in</Badge>
              ) : row.status === "late" ? (
                <Badge variant="warning">{row.lateMinutes} min late</Badge>
              ) : (
                <Badge variant="neutral">Expected</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
