import { type AnyColumn, inArray, type SQL, sql } from "drizzle-orm";

/**
 * Shared vocabulary for management reporting (composed in apps/api from each domain's aggregate query). Every domain
 * counts its own rows inside one window; the API puts the figures side by side.
 */
export interface ReportingWindow {
  /** Rows that happened at or after this instant (the first local day's start). */
  from: Date;
  /** Rows that happened before this instant (the day after the last local day). */
  to: Date;
  /** Only these facilities; null for the whole organization. */
  facilityIds: string[] | null;
  /** Time zone that local days (daily series) are read in. */
  timeZone: string;
}

/** `column` inside the window's time range. */
export function reportingRange(column: AnyColumn | SQL, window: ReportingWindow): SQL {
  return sql`${column} >= ${window.from.toISOString()}::timestamptz AND ${column} < ${window.to.toISOString()}::timestamptz`;
}

/** The window's facility filter for a facility column. */
export function reportingFacility(column: AnyColumn, window: ReportingWindow): SQL | undefined {
  if (!window.facilityIds) return undefined;
  return window.facilityIds.length ? inArray(column, window.facilityIds) : sql`false`;
}

/**
 * The local calendar day (YYYY-MM-DD) of an instant, in the window's time zone — for daily series. Group by the
 * column position (`groupBy(sql`1`)`): the time zone is a bound parameter, so a repeated expression would not match.
 */
export function reportingDay(column: AnyColumn | SQL, window: ReportingWindow): SQL<string> {
  return sql<string>`to_char((${column} at time zone ${window.timeZone})::date, 'YYYY-MM-DD')`;
}
