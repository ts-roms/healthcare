/**
 * Search result parameters of the read-only FHIR interface: paging (`_count`, `_offset` or a `_cursor` from a `next`
 * link), `_lastUpdated` (`ge`/`le`), and `_type` and `_since` on `Patient/$everything`. Parsed here, as pure
 * functions, so the rules are the same wherever they apply.
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
  /**
   * The last match of the previous page (from a `next` link): the page starts after it in the stable order, so pages
   * never overlap or skip while records are added or removed in between. With a cursor, `offset` is 0.
   */
  cursor?: Cursor;
}

/** Where a page starts: the last match of the page before, in the stable order (type, then id). */
export interface Cursor {
  resourceType: string;
  id: string;
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

/** Parameters of `Patient/$everything`: paging, the types wanted, and resources changed since an instant. */
export interface EverythingParameters {
  paging: Paging;
  /** Compartment types to return (the Patient always comes first); undefined: every type. */
  types?: string[];
  /** An instant with a time zone: only resources whose `meta.lastUpdated` is at or after it. */
  since?: string;
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

/**
 * `_count` and `_offset`, or `_count` and a `_cursor` taken from a `next` link (never both); a `_count` above the
 * maximum is reduced to it (FHIR lets a server return fewer).
 */
export function parsePaging(query: { _count?: QueryValue; _offset?: QueryValue; _cursor?: QueryValue }): Paging {
  const count = nonNegativeInteger("_count", query._count) ?? PAGE_SIZE.default;
  const offset = nonNegativeInteger("_offset", query._offset);
  const cursor = single("_cursor", query._cursor);
  if (cursor !== undefined && offset !== undefined) throw new FhirSearchError("Give _cursor or _offset, not both", "invalid");
  return { count: Math.min(count, PAGE_SIZE.max), offset: offset ?? 0, ...(cursor !== undefined ? { cursor: decodeCursor(cursor) } : {}) };
}

const CURSOR = /^[A-Za-z]+\/[A-Za-z0-9.-]{1,64}$/;

/** The opaque `_cursor` value of a `next` link: the last match's type and id, base64url. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.resourceType}/${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    decoded = "";
  }
  if (!CURSOR.test(decoded) || Buffer.from(decoded, "utf8").toString("base64url") !== value) {
    throw new FhirSearchError("_cursor is not a cursor from a next link of this server", "invalid");
  }
  const [resourceType, id] = decoded.split("/") as [string, string];
  return { resourceType, id };
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

/**
 * `Patient/$everything` parameters: paging, `_type` (comma-separated compartment types; unknown ones are invalid) and
 * `_since` (an instant with a time zone). `_since` is honoured only when `_type` names only types whose resources
 * carry a reliable `meta.lastUpdated` (`reliableTypes`): answering it for the other types would silently miss
 * changes, so it is refused as not supported, naming the types allowed. `start` and `end` stay not supported.
 */
export function parseEverythingParameters(
  query: { _count?: QueryValue; _offset?: QueryValue; _cursor?: QueryValue; _type?: QueryValue; _since?: QueryValue; [k: string]: QueryValue },
  options: { compartmentTypes: readonly string[]; reliableTypes: readonly string[] },
): EverythingParameters {
  for (const name of ["_lastUpdated", "start", "end"]) {
    if (query[name] !== undefined) throw new FhirSearchError(`Patient/$everything does not support ${name}`, "not-supported");
  }
  const paging = parsePaging(query);
  const typeValue = single("_type", query._type);
  let types: string[] | undefined;
  if (typeValue !== undefined) {
    types = [
      ...new Set(
        typeValue
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    const unknown = types.filter((t) => !options.compartmentTypes.includes(t));
    if (types.length === 0 || unknown.length > 0) {
      throw new FhirSearchError(
        `_type: unknown resource type(s) ${unknown.join(", ") || "(none given)"}; choose from ${options.compartmentTypes.join(", ")}`,
        "invalid",
      );
    }
  }
  const since = single("_since", query._since);
  if (since !== undefined) {
    if (!INSTANT.test(since) || Number.isNaN(Date.parse(since))) {
      throw new FhirSearchError(`_since: give an instant with a time zone (e.g. 2026-09-01T08:00:00+08:00), not ${since}`, "invalid");
    }
    const unreliable = (types ?? options.compartmentTypes).filter((t) => !options.reliableTypes.includes(t));
    if (!types || unreliable.length > 0) {
      throw new FhirSearchError(
        `_since needs _type naming only types with a reliable last-updated time (${options.reliableTypes.join(", ")}); ` +
          (types ? `not ${unreliable.join(", ")}` : "without _type every type would be included"),
        "not-supported",
      );
    }
  }
  return { paging, ...(types ? { types } : {}), ...(since !== undefined ? { since } : {}) };
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

/** Whether a resource's `meta.lastUpdated` is at or after `_since` (a resource without one never matches). */
export function matchesSince(since: string | undefined, lastUpdated: string | undefined): boolean {
  if (since === undefined) return true;
  const at = lastUpdated ? Date.parse(lastUpdated) : Number.NaN;
  return !Number.isNaN(at) && at >= Date.parse(since);
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
