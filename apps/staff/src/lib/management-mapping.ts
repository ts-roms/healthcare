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
