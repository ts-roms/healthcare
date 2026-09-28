import { type AnyColumn, and, inArray, type SQL, sql } from "drizzle-orm";

/**
 * Shared vocabulary for the patient timeline (composed in apps/api from each domain's read query). Every domain
 * returns its rows for one page window; the API merges them.
 *
 * Entries are ordered newest first by (occurredAt, source, id), all descending: `occurredAt` is an instant with
 * microsecond precision (as PostgreSQL stores it), `source` names the kind of row within its domain (e.g.
 * `lab_order`), `id` is the row's UUID. The order is total, so a cursor never skips or repeats an entry, even when
 * several entries share a timestamp.
 */
export interface TimelinePosition {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (see {@link timelineInstant}). */
  at: string;
  source: string;
  id: string;
}

/** What one source returns for one page of a patient's timeline. */
export interface TimelineWindow {
  /** Only rows strictly after this position in timeline order (i.e. older); null for the first page. */
  before: TimelinePosition | null;
  /** Only rows that occurred at or after this instant. */
  from: Date | null;
  /** Only rows that occurred before this instant. */
  to: Date | null;
  /** Only rows of these facilities; null for every facility. Rows without a facility are left out when set. */
  facilityIds: string[] | null;
  /** At most this many rows (callers ask for one more than a page, to know whether another page exists). */
  limit: number;
}

/** A timestamp as fixed-width UTC ISO text with microseconds: sorts lexicographically, round-trips exactly. */
export function timelineInstant(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Rows of `source` strictly older than `before` in timeline order. At the cursor's own instant, a source that sorts
 * before the cursor's source comes after it (all its rows qualify), one that sorts after it came earlier (none do),
 * and the cursor's own source continues by id.
 */
export function timelineBefore(source: string, at: AnyColumn | SQL, id: AnyColumn | SQL, before: TimelinePosition): SQL {
  const instant = sql`${before.at}::timestamptz`;
  if (source < before.source) return sql`${at} <= ${instant}`;
  if (source > before.source) return sql`${at} < ${instant}`;
  return sql`(${at} < ${instant} OR (${at} = ${instant} AND ${id} < ${before.id}::uuid))`;
}

/** The window's time range and cursor for one source (the facility filter depends on the table, so callers add it). */
export function timelineRange(source: string, at: AnyColumn | SQL, id: AnyColumn | SQL, window: TimelineWindow): SQL | undefined {
  return and(
    window.from ? sql`${at} >= ${window.from.toISOString()}::timestamptz` : undefined,
    window.to ? sql`${at} < ${window.to.toISOString()}::timestamptz` : undefined,
    window.before ? timelineBefore(source, at, id, window.before) : undefined,
  );
}

/** The window's facility filter for a facility column (rows without a facility never match a filter). */
export function timelineFacility(column: AnyColumn, window: TimelineWindow): SQL | undefined {
  if (!window.facilityIds) return undefined;
  return window.facilityIds.length ? inArray(column, window.facilityIds) : sql`false`;
}
