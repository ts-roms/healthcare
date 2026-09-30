import * as React from "react";
import { cn } from "../lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Month grid for a `YYYY-MM-DD` "today" in the facility's zone (the caller computes it; no clock is read here).
 * `marked` days (`YYYY-MM-DD`) are ringed; the marker is also announced to screen readers.
 */
export function MiniCalendar({ today, marked = [], className }: { today: string; marked?: string[]; className?: string }) {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const markedSet = new Set(marked);
  const title = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  return (
    <section aria-label={title} className={cn("rounded-xl border border-border/70 bg-card p-3 shadow-xs", className)}>
      <h2 className="mb-2 text-section font-semibold">{title}</h2>
      <div className="grid grid-cols-7 gap-y-1 text-center text-meta">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-muted-foreground">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />;
          const iso = `${y}-${pad(m)}-${pad(day)}`;
          const isToday = day === d;
          return (
            <span
              key={iso}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "tabular mx-auto flex size-8 items-center justify-center rounded-full text-table",
                isToday
                  ? "bg-primary font-semibold text-primary-foreground"
                  : markedSet.has(iso)
                    ? "bg-primary-subtle font-medium text-primary-deep"
                    : "text-foreground",
              )}
            >
              {day}
              {markedSet.has(iso) ? <span className="sr-only"> (has entries)</span> : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}

export interface AgendaEntry {
  id: string;
  /** Short label, e.g. "Consultation". */
  tag: string;
  title: string;
  /** e.g. "09:00 – 09:30". */
  time: string;
  /** Day-of-month number and weekday shown in the date chip. */
  day: string;
  weekday: string;
  href?: string;
}

export function AgendaList({
  title = "Agenda",
  entries,
  empty = "Nothing scheduled.",
  className,
}: {
  title?: string;
  entries: AgendaEntry[];
  empty?: string;
  className?: string;
}) {
  return (
    <section aria-label={title} className={className}>
      <h2 className="mb-2 text-section font-semibold">{title}</h2>
      {entries.length === 0 ? <p className="text-table text-muted-foreground">{empty}</p> : null}
      <ul className="flex flex-col gap-2">
        {entries.map((e) => {
          const Comp = e.href ? "a" : "div";
          return (
            <li key={e.id}>
              <Comp href={e.href} className={cn("flex items-center gap-3 rounded-xl bg-primary-subtle p-3", e.href && "hover:bg-primary-subtle/70")}>
                <span className="flex w-10 shrink-0 flex-col items-center leading-tight">
                  <span className="tabular text-section-lg font-semibold">{e.day}</span>
                  <span className="text-meta text-muted-foreground">{e.weekday}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-0.5 inline-block rounded-full bg-primary px-2 text-[10px] font-medium text-primary-foreground">{e.tag}</span>
                  <span className="block truncate text-table font-semibold">{e.title}</span>
                  <span className="block text-meta text-muted-foreground">{e.time}</span>
                </span>
              </Comp>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
