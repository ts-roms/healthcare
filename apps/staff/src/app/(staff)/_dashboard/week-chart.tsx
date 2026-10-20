import Link from "next/link";
import { cn } from "@healthcare/ui/lib/utils";
import type { WeekBar } from "@/lib/dashboard-today";

/** The week's appointments, a bar a day with today picked out, and how many follow-ups fall due in the next days. */
export function WeekChart({ bars, followUps }: { bars: WeekBar[]; followUps: number | null }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <section aria-label="This week" className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-section-lg font-semibold">This week</h2>
        <span className="ml-auto text-table text-muted-foreground">Appointments</span>
      </div>
      <ul className="mt-4 flex h-36 items-end gap-3">
        {bars.map((bar) => (
          <li
            key={bar.date}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            role="img"
            aria-label={`${bar.label}: ${bar.count} appointments`}
          >
            <span className={cn("tabular text-table", bar.today ? "font-semibold" : "text-foreground")}>{bar.count}</span>
            <span
              className={cn("w-full rounded-md", bar.today ? "bg-primary" : "bg-primary/25")}
              // A day with none still shows a sliver, so the row of bars reads as a row.
              style={{ height: `${Math.max(4, Math.round((bar.count / max) * 96))}px` }}
            />
            <span className={cn("text-meta", bar.today ? "font-semibold text-primary" : "text-muted-foreground")}>{bar.label}</span>
          </li>
        ))}
      </ul>
      {followUps !== null ? (
        <p className="mt-4 flex items-center gap-2 border-t pt-3 text-table text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground">
              {followUps} {followUps === 1 ? "follow-up" : "follow-ups"}
            </b>{" "}
            due in the next 7 days
          </span>
          <Link href="/clinic/care-plans" className="ml-auto font-medium text-primary underline underline-offset-2">
            Review
          </Link>
        </p>
      ) : null}
    </section>
  );
}
