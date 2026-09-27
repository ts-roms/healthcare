/**
 * Search result parameters of the read-only FHIR interface: paging (`_count`, `_offset`) and `_lastUpdated`
 * (`ge`/`le`). Parsed here, as pure functions, so the rules are the same wherever they apply.
 */

/** Page size when `_count` is absent, and the most one page returns (a larger `_count` is reduced to it). */
export const PAGE_SIZE = { default: 50, max: 200 } as const;

/**
 * Offset of dates without a time zone (`_lastUpdated=ge2026-09-01`): the platform's local time, Asia/Manila
 * (UTC+08:00 all year, no daylight saving).
 */
const LOCAL_OFFSET = "+08:00";

export interface Paging {
  /** Matches per page (0 returns only the total). */
  count: number;
  /** Matches skipped before this page. */
  offset: number;
}

export interface LastUpdatedFilter {
  /** Raw parameter values, as given (repeated in the Bundle's links). */
  ge?: string;
  le?: string;
}

export interface SearchParameters {
  paging: Paging;
  lastUpdated: LastUpdatedFilter;
}

export const DEFAULT_PAGING: Paging = { count: PAGE_SIZE.default, offset: 0 };

/** A search parameter the interface cannot honour: `invalid` (malformed) or `not-supported` (well-formed but not offered). */
export class FhirSearchError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "not-supported",
  ) {
    super(message);
    this.name = "FhirSearchError";
  }
}

type QueryValue = string | string[] | undefined | unknown;

function single(name: string, value: QueryValue): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FhirSearchError(`Give ${name} once`, "invalid");
  return value;
}

function nonNegativeInteger(name: string, value: QueryValue): number | undefined {
  const raw = single(name, value);
  if (raw === undefined) return undefined;
  if (!/^\d{1,9}$/.test(raw)) throw new FhirSearchError(`${name} must be a whole number of 0 or more`, "invalid");
  return Number(raw);
}

/** `_count` and `_offset`; a `_count` above the maximum is reduced to it (FHIR lets a server return fewer). */
export function parsePaging(query: { _count?: QueryValue; _offset?: QueryValue }): Paging {
  const count = nonNegativeInteger("_count", query._count) ?? PAGE_SIZE.default;
  return { count: Math.min(count, PAGE_SIZE.max), offset: nonNegativeInteger("_offset", query._offset) ?? 0 };
}

/**
 * `_lastUpdated` with the `ge` and/or `le` prefix (at most one of each), e.g. `_lastUpdated=ge2026-09-01&_lastUpdated=le2026-09-30`.
 * Values are a date (YYYY-MM-DD, Asia/Manila; `le` includes the whole day) or an instant with a time zone.
 */
export function parseLastUpdated(value: QueryValue): LastUpdatedFilter {
  if (value === undefined) return {};
  const values = Array.isArray(value) ? value : [value];
  const filter: LastUpdatedFilter = {};
  for (const raw of values) {
    if (typeof raw !== "string") throw new FhirSearchError("_lastUpdated must be text", "invalid");
    const prefix = /^[a-z]{2}(?=\d)/.exec(raw)?.[0];
    if (prefix !== "ge" && prefix !== "le") {
      throw new FhirSearchError("_lastUpdated supports only the ge and le prefixes, e.g. _lastUpdated=ge2026-09-01", "not-supported");
    }
    if (filter[prefix] !== undefined) throw new FhirSearchError(`Give _lastUpdated=${prefix}… once`, "invalid");
    bounds(raw.slice(2)); // validates
    filter[prefix] = raw.slice(2);
  }
  return filter;
}

/** Search parameters of a patient search. `lastUpdated: false` refuses `_lastUpdated` (the type has no reliable last-updated time). */
export function parseSearchParameters(
  query: { _count?: QueryValue; _offset?: QueryValue; _lastUpdated?: QueryValue },
  options: { lastUpdated: boolean; type: string },
): SearchParameters {
  if (query._lastUpdated !== undefined && !options.lastUpdated) {
    throw new FhirSearchError(`_lastUpdated is not supported for ${options.type}: its records have no reliable last-updated time`, "not-supported");
  }
  return { paging: parsePaging(query), lastUpdated: parseLastUpdated(query._lastUpdated) };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A parameter value as a half-open interval [start, end) in epoch milliseconds: a whole local day, or one instant. */
function bounds(value: string): { start: number; end: number } {
  const date = DATE.exec(value);
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
      throw new FhirSearchError(`_lastUpdated: ${value} is not a date`, "invalid");
    }
    const start = Date.parse(`${value}T00:00:00${LOCAL_OFFSET}`);
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }
  const at = INSTANT.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) throw new FhirSearchError(`_lastUpdated: give a date (YYYY-MM-DD) or an instant with a time zone, not ${value}`, "invalid");
  return { start: at, end: at + 1 };
}

/** Whether a resource's `meta.lastUpdated` satisfies the filter (a resource without one never matches a filter). */
export function matchesLastUpdated(filter: LastUpdatedFilter, lastUpdated: string | undefined): boolean {
  if (filter.ge === undefined && filter.le === undefined) return true;
  const at = lastUpdated ? Date.parse(lastUpdated) : Number.NaN;
  if (Number.isNaN(at)) return false;
  if (filter.ge !== undefined && at < bounds(filter.ge).start) return false;
  if (filter.le !== undefined && at >= bounds(filter.le).end) return false;
  return true;
}
