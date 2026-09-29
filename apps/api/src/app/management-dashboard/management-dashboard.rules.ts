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
