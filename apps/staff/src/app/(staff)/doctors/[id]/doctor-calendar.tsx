import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { shiftDate } from "@/lib/clinic-mapping";

const WEEKDAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A month of the doctor's calendar: a dot under each clinic day, an orange one under days of leave, today filled and the
 * next open slot ringed. The month is in the address (`?month=`), so the arrows are links and the page stays server-rendered.
 * Colour is never the only signal: each marked day says so to screen readers and the legend names both dots.
 */
export function DoctorCalendar({
  month,
  today,
  clinicWeekdays,
  leaveDays,
  closedDays,
  nextAvailable,
  previousHref,
  nextHref,
}: {
  /** `YYYY-MM` */
  month: string;
  today: string;
  /** Days of the week (0 = Sunday) with a schedule at this facility. */
  clinicWeekdays: ReadonlySet<number>;
  /** Days of the month this doctor is on leave. */
  leaveDays: ReadonlySet<string>;
  /** Days of the month the whole facility is closed. */
  closedDays: ReadonlySet<string>;
  /** The date of the next open slot, when it falls in this month. */
  nextAvailable: string | null;
  previousHref: string;
  nextHref: string;
}) {
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 0; i < 31; i++) {
    const date = shiftDate(first, i);
    if (!date.startsWith(month)) break;
    days.push(date);
  }
  while (days.length % 7) days.push(null);
  const title = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));

  return (
    <section aria-label={title} className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-section font-semibold">{title}</h2>
        <Button asChild variant="outline" size="icon-sm" className="ml-auto">
          <Link href={previousHref} aria-label="Previous month" scroll={false}>
            <ChevronLeftIcon />
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon-sm">
          <Link href={nextHref} aria-label="Next month" scroll={false}>
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center text-meta">
        {WEEKDAY_HEADS.map((w) => (
          <span key={w} className="py-1 font-medium text-muted-foreground">
            {w}
          </span>
        ))}
        {days.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
          const leave = leaveDays.has(date);
          const closed = closedDays.has(date);
          const clinic = clinicWeekdays.has(dow) && !leave && !closed;
          const isToday = date === today;
          const next = date === nextAvailable;
          return (
            <span key={date} className="flex flex-col items-center gap-0.5 py-0.5">
              <span
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "tabular flex size-8 items-center justify-center rounded-full text-table",
                  isToday ? "bg-primary font-semibold text-primary-foreground" : clinic ? "font-medium text-foreground" : "text-muted-foreground",
                  next && !isToday && "ring-1 ring-primary",
                )}
              >
                {Number(date.slice(8))}
                {isToday ? <span className="sr-only"> (today)</span> : null}
                {next ? <span className="sr-only"> (next open slot)</span> : null}
                {leave ? (
                  <span className="sr-only"> (on leave)</span>
                ) : clinic ? (
                  <span className="sr-only"> (clinic day)</span>
                ) : closed ? (
                  <span className="sr-only"> (facility closed)</span>
                ) : null}
              </span>
              <span aria-hidden className={cn("size-1 rounded-full", leave ? "bg-warning" : clinic ? "bg-primary/70" : "bg-transparent")} />
            </span>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-primary/70" /> Clinic day
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-warning" /> Leave
        </span>
      </p>
    </section>
  );
}
