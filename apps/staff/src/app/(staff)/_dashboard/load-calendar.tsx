import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import type { ClinicLoadDay } from "@/lib/api/types";
import { shiftDate } from "@/lib/clinic-mapping";
import { type LoadLevel, loadLevel, openSlots } from "@/lib/dashboard-today";

const WEEKDAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LEVEL_LABEL: Record<Exclude<LoadLevel, "none">, string> = { light: "Light", busy: "Busy", full: "Nearly full" };
const LEVEL_CLASS: Record<LoadLevel, string> = { none: "bg-transparent", light: "bg-primary/20", busy: "bg-primary/50", full: "bg-primary" };

/**
 * A month of the facility's days, each with a bar for how full it is (the appointments holding a slot against the slots the
 * schedules offer), and today's figures under it. The month is in the address (`?month=`), so the arrows are links.
 */
export function LoadCalendar({
  month,
  today,
  days,
  todayDay,
  previousHref,
  nextHref,
  todayHref,
  openDayHref,
}: {
  /** `YYYY-MM` */
  month: string;
  today: string;
  days: readonly ClinicLoadDay[];
  /** Today's figures, whichever month is shown. */
  todayDay: ClinicLoadDay | null;
  previousHref: string;
  nextHref: string;
  todayHref: string;
  /** Where "Open day" goes; absent when the viewer may not open appointments. */
  openDayHref?: string;
}) {
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 0; i < 31; i++) {
    const date = shiftDate(first, i);
    if (!date.startsWith(month)) break;
    cells.push(date);
  }
  while (cells.length % 7) cells.push(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const title = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  const todayLabel = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${today}T12:00:00Z`),
  );

  return (
    <section aria-label={title} className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-section-lg font-semibold">{title}</h2>
        <Button asChild variant="outline" size="icon-sm" className="ml-auto">
          <Link href={previousHref} aria-label="Previous month" scroll={false}>
            <ChevronLeftIcon />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={todayHref} scroll={false}>
            Today
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
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const day = byDate.get(date);
          const level = day ? loadLevel(day) : "none";
          const isToday = date === today;
          return (
            <span key={date} className="flex flex-col items-center gap-0.5 py-0.5">
              <span
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "tabular flex size-8 items-center justify-center rounded-full text-table",
                  isToday
                    ? "bg-primary font-semibold text-primary-foreground ring-2 ring-primary/30 ring-offset-1"
                    : level === "none"
                      ? "text-muted-foreground"
                      : "font-medium",
                )}
              >
                {Number(date.slice(8))}
                {isToday ? <span className="sr-only"> (today)</span> : null}
                {level !== "none" ? <span className="sr-only">, {LEVEL_LABEL[level].toLowerCase()}</span> : null}
              </span>
              <span aria-hidden className={cn("h-1 w-5 rounded-full", LEVEL_CLASS[level])} />
            </span>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
        {(["light", "busy", "full"] as const).map((level) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("h-1 w-4 rounded-full", LEVEL_CLASS[level])} /> {LEVEL_LABEL[level]}
          </span>
        ))}
      </p>
      {todayDay ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-muted/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">Today · {todayLabel}</p>
            <p className="text-table text-muted-foreground">
              {todayDay.scheduled} {todayDay.scheduled === 1 ? "appointment" : "appointments"} · {openSlots(todayDay)} open{" "}
              {openSlots(todayDay) === 1 ? "slot" : "slots"}
            </p>
          </div>
          {openDayHref ? (
            <Link href={openDayHref} className="shrink-0 text-table font-medium text-primary underline underline-offset-2">
              Open day
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
