import type { ManagementComparisonMode, ManagementFigureChange, ManagementPatientCount } from "./api/types";
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
export function comparison(current: number | "<5" | null, previous: number | "<5" | null, kind: "count" | "rate" | "minutes"): string {
  // A suppressed patient count ("<5") is not compared: the change would reveal it.
  if (typeof current !== "number" || typeof previous !== "number") return "no comparison";
  if (current === previous) return "no change";
  const arrow = current > previous ? "▲" : "▼";
  if (kind === "rate") return `${arrow} ${Math.abs(Math.round((current - previous) * 1000) / 10).toLocaleString("en-PH")} pts`;
  if (kind === "minutes") return `${arrow} ${Math.abs(current - previous).toLocaleString("en-PH")} min`;
  if (previous === 0) return `${arrow} from none`;
  return `${arrow} ${Math.abs(Math.round(((current - previous) / previous) * 100)).toLocaleString("en-PH")}%`;
}

/** "the previous 30 days" / "the previous day". */
export function previousLabel(from: string, to: string, mode: ManagementComparisonMode = "previous"): string {
  if (mode === "last-year") return "the same dates last year";
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return days === 1 ? "the previous day" : `the previous ${days} days`;
}

export const COMPARISON_OPTIONS: Array<{ key: ManagementComparisonMode; label: string }> = [
  { key: "previous", label: "The period just before" },
  { key: "last-year", label: "The same dates last year" },
];

/** "median 25 · 90th pct 40" for a figure's spread; "—" for the parts that have no value. */
export function spreadLabel(median: number | null, p90: number | null): string {
  const m = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("en-PH")} min`);
  return `median ${m(median)} · 90th percentile ${m(p90)}`;
}

/** Whether the change is an improvement, from the API's direction of improvement for the figure; colour follows. */
export function verdict(change: ManagementFigureChange | undefined): { text: string; tone: "better" | "worse" | "neutral" } | null {
  const assessment = change?.change?.assessment;
  if (!assessment || assessment === "unchanged") return null;
  if (assessment === "neutral") return { text: "neither better nor worse", tone: "neutral" };
  return { text: assessment, tone: assessment };
}

/** A patient count for people: "<5" stays as it is (suppressed by the API), numbers get separators. */
export function countLabel(count: ManagementPatientCount): string {
  return typeof count === "number" ? count.toLocaleString("en-PH") : count;
}

/** A rate between patient counts: "withheld" when the API suppressed it. */
export function patientRateLabel(rate: number | null, suppressed: boolean): string {
  return suppressed ? "withheld (<5)" : percentOf(rate);
}

/** The dashboard section a gated table belongs to; the API withholds the table without that section's permission. */
export type ExportSection = "billing" | "inventory" | "dispensing";

/** CSV tables of the dashboard export; a `section` names the permission-gated section the table belongs to. */
export const EXPORT_TABLES: Array<{ key: string; label: string; section?: ExportSection }> = [
  { key: "summary", label: "Summary" },
  { key: "daily", label: "Daily" },
  { key: "services", label: "Services", section: "billing" },
  { key: "categories", label: "Categories", section: "billing" },
  { key: "revenue", label: "Revenue", section: "billing" },
  { key: "collections", label: "Payment methods", section: "billing" },
  { key: "providers", label: "Providers" },
  { key: "laboratory", label: "Laboratory" },
  { key: "lab-tests", label: "Lab tests" },
  { key: "lab-instruments", label: "Lab instruments" },
  { key: "lab-departments", label: "Lab departments" },
  { key: "dental-procedures", label: "Dental procedures" },
  { key: "telemedicine", label: "Online consultations" },
  { key: "retention", label: "Retention" },
  { key: "inventory", label: "Stock", section: "inventory" },
  { key: "inventory-items", label: "Stock items", section: "inventory" },
  { key: "dispensing", label: "Dispensing", section: "dispensing" },
  { key: "dispensing-items", label: "Dispensed items", section: "dispensing" },
];

/** The whole dashboard as one PDF: a report file beside the CSV tables. */
export const PDF_REPORT = { key: "pdf", label: "Dashboard (PDF)" } as const;
/** What a scheduled report may contain: the CSV tables and the PDF. */
export const REPORT_FILES: Array<{ key: string; label: string; section?: ExportSection }> = [...EXPORT_TABLES, PDF_REPORT];

/** What each permission-gated section needs, for notes beside a table or a withheld figure. */
export const SECTION_NEEDS: Record<ExportSection, string> = {
  billing: "needs billing reports",
  inventory: "needs inventory valuation",
  dispensing: "needs prescription reading",
};

/** The workflows that take stock, as shown ("Dispensed on prescriptions"); a plain movement shows its kind. */
export function stockUseLabel(sourceType: string | null, kind: string): string {
  const source: Record<string, string> = {
    prescription_dispense: "Dispensed on prescriptions",
    lab_reagent_load: "Laboratory reagents loaded",
    dental_procedure: "Dental procedures",
    clinic_procedure: "Clinic procedures",
    immunization: "Immunizations",
    purchase_order_line: "Purchase orders",
  };
  const kinds: Record<string, string> = { issue: "Issued", write_off: "Written off", return: "Returned", adjustment: "Count adjustments" };
  return sourceType ? (source[sourceType] ?? sourceType) : (kinds[kind] ?? kind);
}
