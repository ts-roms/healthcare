/**
 * Pure rules of the management dashboard (apps/api composes the figures; each domain counts its own rows).
 */

/** Longest range the dashboard reads at once, in days (inclusive). */
export const MAX_RANGE_DAYS = 366;
/** Default range: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;

/** `date` (YYYY-MM-DD) moved by `days` calendar days. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Every local day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) days.push(day);
  return days;
}

/** The range asked for, or the default ending today; an error message when it is not usable. */
export function resolveRange(query: { from?: string; to?: string }, today: string): { from: string; to: string } | { error: string } {
  const to = query.to ?? (query.from && query.from > today ? query.from : today);
  const from = query.from ?? shiftDate(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) return { error: "The range starts after it ends" };
  if (daysBetween(from, to).length > MAX_RANGE_DAYS) return { error: `Choose at most ${MAX_RANGE_DAYS} days` };
  return { from, to };
}

/**
 * Which facilities the caller may report on, from their grants of the dashboard permission: an organization-wide grant
 * covers every facility (and the whole-organization view); facility grants cover those facilities only.
 */
export function reportableFacilities(
  grants: ReadonlyArray<{ facilityId: string | null }>,
  facilityIds: readonly string[],
): { all: boolean; facilityIds: string[] } {
  if (grants.some((g) => g.facilityId === null)) return { all: true, facilityIds: [...facilityIds] };
  const granted = new Set(grants.map((g) => g.facilityId));
  return { all: false, facilityIds: facilityIds.filter((id) => granted.has(id)) };
}

/** One row per day of the range, with zero where a source had nothing that day. */
export function dailySeries<K extends string>(
  days: readonly string[],
  sources: Array<{ key: K; rows: ReadonlyArray<{ date: string } & Record<string, unknown>>; field: string }>,
) {
  return days.map((date) => {
    const row: { date: string } & Record<K, number> = { date } as { date: string } & Record<K, number>;
    for (const source of sources) {
      const value = source.rows.find((r) => r.date === date)?.[source.field];
      (row as Record<string, unknown>)[source.key] = typeof value === "number" ? value : 0;
    }
    return row;
  });
}

/** `part / whole` to three decimals, or null without a whole. */
export function rate(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 1000 : null;
}

// ---- Privacy: small-cell suppression ------------------------------------------------------------------------------

/**
 * Small-cell suppression threshold. Any **patient count** from 1 to SMALL_CELL_THRESHOLD − 1 (1–4) is returned as
 * {@link SUPPRESSED} ("<5"), and a rate whose numerator or denominator is such a count is withheld. Zero is shown (it
 * identifies nobody). Event counts (consultations, tests, procedures) and money are not patient counts.
 *
 * Why: a cell with very few patients (one practitioner's patients in a day, a rarely used service, a small retention
 * cohort) can single out a person when combined with what staff already know (Data Privacy Act; NPC guidance on
 * aggregate disclosure). Five is a common minimum cell size in health statistics. It is a platform choice, not a
 * regulatory figure — **confirm it with the organization's Data Protection Officer** before relying on it.
 */
export const SMALL_CELL_THRESHOLD = 5;

/** How a suppressed patient count is shown (JSON and CSV). */
export const SUPPRESSED = "<5" as const;

/** A patient count as disclosed: exact from the threshold up (and 0), otherwise "<5". */
export type PatientCount = number | typeof SUPPRESSED;

export function isSmallCell(n: number): boolean {
  return n > 0 && n < SMALL_CELL_THRESHOLD;
}

export function suppressCount(n: number): PatientCount {
  return isSmallCell(n) ? SUPPRESSED : n;
}

/** A rate between patient counts, withheld when either count is a small cell (the rate would reveal it). */
export function patientRate(part: number, whole: number): { rate: number | null; suppressed: boolean } {
  if (isSmallCell(part) || isSmallCell(whole)) return { rate: null, suppressed: true };
  return { rate: rate(part, whole), suppressed: false };
}

// ---- Previous-period comparison -----------------------------------------------------------------------------------

/** The equal-length period immediately before `range` (local days, inclusive). */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const days = daysBetween(range.from, range.to).length;
  return { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) };
}

/** What a figure measures: a rate's change reads in percentage points, the others in their own unit. */
export type FigureUnit = "count" | "patients" | "rate" | "minutes" | "centavos";
/** Which direction is an improvement ("neither" for volumes that are not targets either way). */
export type Better = "up" | "down" | "neither";
type FigureValue = number | typeof SUPPRESSED | null;

export interface FigureComparison {
  key: string;
  unit: FigureUnit;
  better: Better;
  /** The figure in the period (a patient count may be "<5"; null when there is nothing to measure). */
  current: FigureValue;
  /** The same figure over the previous equal period. */
  previous: FigureValue;
  /** Null when either value is unknown or suppressed. */
  change: {
    /** current − previous (for a rate a fraction: 0.05 = 5 percentage points). */
    absolute: number;
    /** (current − previous) ÷ previous; null when the previous value was 0, and for rates. */
    relative: number | null;
    direction: "up" | "down" | "flat";
    assessment: "better" | "worse" | "unchanged" | "neutral";
  } | null;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The figure beside its previous-period value, with the change and whether it is an improvement. */
export function compareFigure(key: string, unit: FigureUnit, better: Better, current: FigureValue, previous: FigureValue): FigureComparison {
  if (typeof current !== "number" || typeof previous !== "number") return { key, unit, better, current, previous, change: null };
  const absolute = round4(current - previous);
  const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  const assessment = direction === "flat" ? "unchanged" : better === "neither" ? "neutral" : direction === better ? "better" : "worse";
  const relative = unit === "rate" || previous === 0 ? null : round4((current - previous) / Math.abs(previous));
  return { key, unit, better, current, previous, change: { absolute, relative, direction, assessment } };
}

// ---- Retention ----------------------------------------------------------------------------------------------------

/** Retention: patients seen in the period who were also seen in this many months before it started. */
export const RETENTION_LOOKBACK_MONTHS = 12;
/** Return: another encounter on a later local day within this many days of the first encounter in the period. */
export const RETURN_WINDOW_DAYS = 90;

/** `date` (YYYY-MM-DD) moved by whole calendar months, clamped to the month's last day. */
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** Retention counts as disclosed: small cells suppressed, rates withheld when they would reveal one. */
export function retentionFigures(counts: { seen: number; retained: number; returnCohort: number; returned: number }) {
  const retention = patientRate(counts.retained, counts.seen);
  const returns = patientRate(counts.returned, counts.returnCohort);
  return {
    lookbackMonths: RETENTION_LOOKBACK_MONTHS,
    returnWindowDays: RETURN_WINDOW_DAYS,
    seen: suppressCount(counts.seen),
    retained: suppressCount(counts.retained),
    /** retained ÷ seen. */
    retentionRate: retention.rate,
    retentionRateSuppressed: retention.suppressed,
    returnCohort: suppressCount(counts.returnCohort),
    returned: suppressCount(counts.returned),
    /** returned ÷ returnCohort. */
    returnRate: returns.rate,
    returnRateSuppressed: returns.suppressed,
  };
}

// ---- Revenue gating -----------------------------------------------------------------------------------------------

/**
 * Whether grants of a permission cover every facility in `scope`: an organization-wide grant, or a facility grant on
 * each (a grant narrowed to a department covers no whole facility). Revenue is shown only then.
 */
export function coversAll(grants: ReadonlyArray<{ facilityId: string | null; departmentId?: string | null }>, scope: readonly string[]): boolean {
  const relevant = grants.filter((g) => !g.departmentId);
  if (relevant.some((g) => g.facilityId === null)) return true;
  const granted = new Set(relevant.map((g) => g.facilityId));
  return scope.length > 0 && scope.every((id) => granted.has(id));
}
