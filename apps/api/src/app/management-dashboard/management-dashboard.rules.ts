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

/** The period of the same length ending the day before `from` — what the range is compared with. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = daysBetween(from, to).length;
  return { from: shiftDate(from, -days), to: shiftDate(from, -1) };
}

/** The headline figures, the same for the range and the period before it. Amounts in centavos. */
export interface KeyFigures {
  patientsSeen: number;
  newPatients: number;
  consultations: number;
  noShowRate: number | null;
  averageWaitMinutes: number | null;
  netInvoiced: number;
  netCollected: number;
  labTestsReleased: number;
  labTurnaroundMinutes: number | null;
  dentalProcedures: number;
}

export function keyFigures(parts: {
  patients: { registered: number };
  clinic: {
    appointments: { noShowRate: number | null };
    visits: { averageWaitMinutes: number | null };
    encounters: { completed: number; patientsSeen: number };
  };
  laboratory: { released: number; averageTurnaroundMinutes: number | null };
  dental: { procedures: number };
  billing: { invoices: { netTotal: number }; netCollected: number };
}): KeyFigures {
  return {
    patientsSeen: parts.clinic.encounters.patientsSeen,
    newPatients: parts.patients.registered,
    consultations: parts.clinic.encounters.completed,
    noShowRate: parts.clinic.appointments.noShowRate,
    averageWaitMinutes: parts.clinic.visits.averageWaitMinutes,
    netInvoiced: parts.billing.invoices.netTotal,
    netCollected: parts.billing.netCollected,
    labTestsReleased: parts.laboratory.released,
    labTurnaroundMinutes: parts.laboratory.averageTurnaroundMinutes,
    dentalProcedures: parts.dental.procedures,
  };
}

// ---- CSV export ----------------------------------------------------------------------------------------------------

export const EXPORT_TABLES = ["summary", "daily", "services", "categories", "providers"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

type Cell = string | number | null;

/**
 * RFC 4180 CSV (CRLF, quoted when needed). A cell starting with = + - @ (or a tab / carriage return) is prefixed with
 * an apostrophe so spreadsheets never run it as a formula — names come from staff-entered data.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  const cell = (value: Cell) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Centavos as pesos with two decimals (a plain number for spreadsheets). */
export const pesos = (centavos: number) => (centavos / 100).toFixed(2);

const SUMMARY_ROWS: Array<[keyof KeyFigures, string, (v: number) => Cell]> = [
  ["patientsSeen", "Patients seen", (v) => v],
  ["newPatients", "New patients registered", (v) => v],
  ["consultations", "Consultations completed", (v) => v],
  ["noShowRate", "No-show rate", (v) => v],
  ["averageWaitMinutes", "Average wait, check-in to consultation (minutes)", (v) => v],
  ["netInvoiced", "Invoiced, net (PHP)", pesos],
  ["netCollected", "Collected less refunds (PHP)", pesos],
  ["labTestsReleased", "Laboratory tests released", (v) => v],
  ["labTurnaroundMinutes", "Laboratory turnaround, collection to release (minutes)", (v) => v],
  ["dentalProcedures", "Dental procedures", (v) => v],
];

/** Summary rows: each key figure for the range and the period before it. */
export function summaryRows(
  current: KeyFigures,
  previous: KeyFigures,
  ranges: { from: string; to: string; previousFrom: string; previousTo: string },
): Cell[][] {
  return [
    ["Figure", `${ranges.from} to ${ranges.to}`, `${ranges.previousFrom} to ${ranges.previousTo}`],
    ...SUMMARY_ROWS.map(([key, label, format]): Cell[] => {
      const a = current[key];
      const b = previous[key];
      return [label, a === null ? null : format(a), b === null ? null : format(b)];
    }),
  ];
}
