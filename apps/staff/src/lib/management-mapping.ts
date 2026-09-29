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

/**
 * How a figure moved against the previous period, as text (arrow + words, never colour alone). Counts and amounts
 * change in percent, rates in percentage points, durations in minutes. Whether up is good depends on the figure, so
 * the text stays neutral.
 */
export function comparison(current: number | null, previous: number | null, kind: "count" | "rate" | "minutes"): string {
  if (current === null || previous === null) return "no comparison";
  if (current === previous) return "no change";
  const arrow = current > previous ? "▲" : "▼";
  if (kind === "rate") return `${arrow} ${Math.abs(Math.round((current - previous) * 1000) / 10).toLocaleString("en-PH")} pts`;
  if (kind === "minutes") return `${arrow} ${Math.abs(current - previous).toLocaleString("en-PH")} min`;
  if (previous === 0) return `${arrow} from none`;
  return `${arrow} ${Math.abs(Math.round(((current - previous) / previous) * 100)).toLocaleString("en-PH")}%`;
}

/** "the previous 30 days" / "the previous day". */
export function previousLabel(from: string, to: string): string {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return days === 1 ? "the previous day" : `the previous ${days} days`;
}

export const EXPORT_TABLES: Array<{ key: string; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "daily", label: "Daily" },
  { key: "services", label: "Services" },
  { key: "categories", label: "Categories" },
  { key: "providers", label: "Providers" },
];
