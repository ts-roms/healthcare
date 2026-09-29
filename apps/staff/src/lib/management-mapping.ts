import type { ManagementFigureComparison, ManagementPatientCount } from "./api/types";
import { peso } from "./billing-mapping";
import { shiftDate } from "./clinic-mapping";

/** Display rules for the management dashboard; the API computes every figure. */

export interface RangePreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** Quick ranges ending today (local days, inclusive). */
export function rangePresets(today: string): RangePreset[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDate(monthStart, -1);
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "7d", label: "Last 7 days", from: shiftDate(today, -6), to: today },
    { key: "30d", label: "Last 30 days", from: shiftDate(today, -29), to: today },
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last-month", label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

/** 0.125 → "12.5%"; null → "—". */
export function percentOf(rate: number | null): string {
  if (rate === null) return "—";
  return `${(Math.round(rate * 1000) / 10).toLocaleString("en-PH")}%`;
}

/** A patient count for people: "<5" stays as it is (suppressed by the API), numbers get separators. */
export function countLabel(count: ManagementPatientCount): string {
  return typeof count === "number" ? count.toLocaleString("en-PH") : count;
}

/** A rate between patient counts: "withheld" when the API suppressed it. */
export function patientRateLabel(rate: number | null, suppressed: boolean): string {
  return suppressed ? "withheld (<5)" : percentOf(rate);
}

export type ChangeTone = "better" | "worse" | "neutral";

/**
 * A figure's change against the previous period for people — an arrow, words and a tone (never colour alone):
 * rates in percentage points ("+5.0 points"), money in pesos, other figures in their unit with the percentage.
 * Null when there is nothing to compare (no previous value, or a suppressed count).
 */
export function changeLabel(figure: ManagementFigureComparison): { arrow: "↑" | "↓" | "→"; text: string; tone: ChangeTone } | null {
  const change = figure.change;
  if (!change) return null;
  if (change.direction === "flat") return { arrow: "→", text: "No change vs previous period", tone: "neutral" };
  const arrow = change.direction === "up" ? "↑" : "↓";
  const sign = change.absolute > 0 ? "+" : "−";
  const abs = Math.abs(change.absolute);
  let amount: string;
  if (figure.unit === "rate") amount = `${sign}${(Math.round(abs * 1000) / 10).toFixed(1)} points`;
  else if (figure.unit === "centavos") amount = `${sign}${peso(abs)}`;
  else if (figure.unit === "minutes") amount = `${sign}${abs.toLocaleString("en-PH")} min`;
  else amount = `${sign}${abs.toLocaleString("en-PH")}`;
  if (figure.unit !== "rate" && change.relative !== null) {
    amount += ` (${sign}${(Math.round(Math.abs(change.relative) * 1000) / 10).toLocaleString("en-PH")}%)`;
  }
  const verdict = { better: "better", worse: "worse", unchanged: "no change", neutral: "neither better nor worse" }[change.assessment];
  const tone: ChangeTone = change.assessment === "better" ? "better" : change.assessment === "worse" ? "worse" : "neutral";
  return { arrow, text: `${amount} vs previous period (${verdict})`, tone };
}

/** The CSV sections the API exports; revenue ones need billing report access. */
export const CSV_SECTIONS = [
  "summary",
  "daily",
  "providers",
  "laboratory",
  "lab-tests",
  "lab-instruments",
  "dental-procedures",
  "telemedicine",
  "retention",
  "revenue",
  "revenue-by-category",
  "collections",
  "services",
] as const;
export type CsvSection = (typeof CSV_SECTIONS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** The staff download link for one section with the page's filters. */
export function csvHref(section: CsvSection, filters: { from: string; to: string; facilityId?: string }): string {
  const params = new URLSearchParams({ section, from: filters.from, to: filters.to });
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  return `/management/export?${params.toString()}`;
}

/** The API query for a download request; null when the section is unknown. Malformed filters are dropped. */
export function csvApiQuery(params: URLSearchParams): Record<string, string> | null {
  const section = params.get("section");
  if (!section || !(CSV_SECTIONS as readonly string[]).includes(section)) return null;
  const query: Record<string, string> = { section };
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (value && DATE.test(value)) query[key] = value;
  }
  const facilityId = params.get("facilityId");
  if (facilityId && UUID.test(facilityId)) query.facilityId = facilityId;
  return query;
}
