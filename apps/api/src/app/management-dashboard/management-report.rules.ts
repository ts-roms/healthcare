import { shiftDate } from "./management-dashboard.rules";
import type { ReportCadence } from "./management-report.schema";

/**
 * Pure rules of scheduled management reports (no database): which period a schedule reports on and when it is due.
 * A weekly report covers the previous Monday to Sunday and is due from the Monday after; a monthly one covers the
 * previous calendar month and is due from the 1st. Dates are local calendar days (the facility's time zone, else
 * Asia/Manila), as on the dashboard.
 */
export interface ReportPeriod {
  from: string;
  to: string;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The period a report produced on `today` covers: the last complete week or month before today. */
export function periodEndingBefore(cadence: ReportCadence, today: string): ReportPeriod {
  if (cadence === "weekly") {
    // The most recent Sunday strictly before today, and the Monday six days earlier.
    const to = shiftDate(today, -isoWeekday(today));
    return { from: shiftDate(to, -6), to };
  }
  const [year, month] = today.split("-").map(Number) as [number, number];
  const firstOfThisMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = shiftDate(firstOfThisMonth, -1);
  return { from: `${to.slice(0, 8)}01`, to };
}

/**
 * Whether a report for `period` is due on `today`: the period has ended and today is on or after the day the
 * schedule reports (Monday for weekly, the 1st for monthly). `periodEndingBefore` already yields only ended periods,
 * so this guards callers that pass a period from elsewhere.
 */
export function isDue(period: ReportPeriod, today: string): boolean {
  return period.to < today;
}

/** The periods a schedule has not yet reported, oldest first, at most `limit` back from today (catch-up after downtime). */
export function duePeriods(cadence: ReportCadence, today: string, alreadyProduced: ReadonlySet<string>, limit = 3): ReportPeriod[] {
  const periods: ReportPeriod[] = [];
  let cursor = today;
  for (let i = 0; i < limit; i += 1) {
    const period = periodEndingBefore(cadence, cursor);
    if (!alreadyProduced.has(period.from)) periods.unshift(period);
    cursor = period.from;
  }
  return periods;
}

/** A file name for a stored table, like the screen's export. */
export function reportFileName(table: string, period: ReportPeriod): string {
  return `management-${table}-${period.from}-to-${period.to}.csv`;
}
