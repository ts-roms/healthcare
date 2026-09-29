import type { ManagementDashboardView } from "./management-dashboard.service";

/** The tables the dashboard exports, one per CSV. */
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

/** Sections that need the billing report permission on every facility in scope. */
export const REVENUE_CSV_SECTIONS: readonly CsvSection[] = ["revenue", "revenue-by-category", "collections", "services"];

type Cell = string | number | null;
interface Table {
  columns: string[];
  rows: Cell[][];
}

/** Centavos as pesos with two decimals (no thousands separators: spreadsheet-friendly). */
export function pesos(centavos: number | null): string | null {
  if (centavos === null) return null;
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.round(Math.abs(centavos));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A fraction as a percentage with one decimal; empty when unknown or withheld. */
export function percent(fraction: number | null): string | null {
  return fraction === null ? null : (Math.round(fraction * 1000) / 10).toFixed(1);
}

/**
 * One CSV cell. Text is quoted when needed, and text a spreadsheet would read as a formula (starting with =, +, -, @,
 * tab or carriage return) is prefixed with an apostrophe (CSV injection). Plain numbers are written as they are.
 */
export function csvCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const COMPARISON_LABELS: Record<string, string> = {
  patientsSeen: "Patients seen",
  consultations: "Consultations",
  noShowRate: "No-show rate (%)",
  averageWait: "Average wait (min)",
  labReleased: "Lab tests released",
  labTurnaround: "Lab turnaround (min)",
  specimenRejectionRate: "Specimen rejection rate (%)",
  retentionRate: "Retention rate (%)",
  invoicedNet: "Invoiced net (PHP)",
  collected: "Collected less refunds (PHP)",
};

/** A compared figure's value as exported: rates in percent, money in pesos. */
function figureCell(unit: string, value: number | string | null): Cell {
  if (typeof value !== "number") return value;
  if (unit === "rate") return percent(value);
  if (unit === "centavos") return pesos(value);
  return value;
}

/** The table behind one section. Revenue sections must not be asked for when billing is withheld (the service refuses). */
export function sectionTable(v: ManagementDashboardView, section: CsvSection): Table {
  const b = v.billing;
  switch (section) {
    case "summary":
      return {
        columns: ["Figure", "This period", "Previous period", "Change", "Change (%)", "Better when", "Assessment"],
        rows: v.comparison.map((f) => [
          COMPARISON_LABELS[f.key] ?? f.key,
          figureCell(f.unit, f.current),
          figureCell(f.unit, f.previous),
          f.change ? (f.unit === "rate" ? percent(f.change.absolute) : f.unit === "centavos" ? pesos(f.change.absolute) : f.change.absolute) : null,
          f.change ? percent(f.change.relative) : null,
          f.better === "up" ? "higher" : f.better === "down" ? "lower" : "neither",
          f.change?.assessment ?? null,
        ]),
      };
    case "daily":
      return {
        columns: [
          "Date",
          "New patients",
          "Patients seen",
          "Consultations",
          "Lab tests released",
          ...(b ? ["Invoiced net (PHP)", "Collected less refunds (PHP)"] : []),
        ],
        rows: v.daily.map((d) => [d.date, d.registered, d.patientsSeen, d.encounters, d.labReleased, ...(b ? [pesos(d.invoiced), pesos(d.collected)] : [])]),
      };
    case "providers":
      return {
        columns: ["Practitioner", "Consultations", "Patients", "Booked", "No-shows", "Booked minutes", "Available minutes", "Utilization (%)"],
        rows: v.clinic.providers.map((p) => [
          p.displayName,
          p.encounters,
          p.patients,
          p.appointments,
          p.noShows,
          p.bookedMinutes,
          p.availableMinutes,
          percent(p.utilization),
        ]),
      };
    case "laboratory": {
      const l = v.laboratory;
      return {
        columns: ["Figure", "Value"],
        rows: [
          ["Orders", l.orders.orders],
          ["STAT orders", l.orders.stat],
          ["Cancelled orders", l.orders.cancelled],
          ["Tests ordered", l.testsOrdered],
          ["Tests released (first release)", l.released],
          ["Corrections released", l.corrections],
          ["Average turnaround, collection to release (min)", l.averageTurnaroundMinutes],
          ["Released within target (%)", percent(l.withinTargetRate)],
          ["Specimens collected", l.specimens.collected],
          ["Of those rejected", l.specimens.rejected],
          ["Specimen rejection rate (%)", percent(l.specimens.rejectionRate)],
          ["Specimens rejected in the period (any collection date)", l.specimensRejected],
        ],
      };
    }
    case "lab-tests":
      return { columns: ["Test", "Ordered"], rows: v.laboratory.topTests.map((t) => [t.name, t.ordered]) };
    case "lab-instruments":
      return { columns: ["Instrument", "First results entered"], rows: v.laboratory.byInstrument.map((i) => [i.name ?? "No instrument recorded", i.results]) };
    case "dental-procedures":
      return { columns: ["Code", "Procedure", "Procedures", "Patients"], rows: v.dental.byProcedure.map((p) => [p.code, p.name, p.procedures, p.patients]) };
    case "telemedicine": {
      const t = v.telemedicine;
      return {
        columns: ["Started", "Ended", "Escalated", "In progress", "Escalation rate (%)"],
        rows: [[t.started, t.ended, t.escalated, t.inProgress, percent(t.escalationRate)]],
      };
    }
    case "retention": {
      const r = v.retention;
      return {
        columns: [
          "Patients seen",
          `Also seen in the ${r.lookbackMonths} months before`,
          "Retention rate (%)",
          "Return cohort",
          `Returned within ${r.returnWindowDays} days`,
          "Return rate (%)",
        ],
        rows: [[r.seen, r.retained, percent(r.retentionRate), r.returnCohort, r.returned, percent(r.returnRate)]],
      };
    }
    case "revenue":
      return {
        columns: ["Figure", "PHP"],
        rows: b
          ? [
              ["Invoices issued (count)", b.invoices.issued],
              ["Gross", pesos(b.invoices.grossTotal)],
              ["Discounts", pesos(b.invoices.discountTotal)],
              ["Net invoiced", pesos(b.invoices.netTotal)],
              ["Payer share", pesos(b.invoices.payerTotal)],
              ["Patient share", pesos(b.invoices.patientTotal)],
              ["Voided (count)", b.invoices.voided],
              ["Credit notes", pesos(b.creditNotesTotal)],
              ["Debit notes", pesos(b.debitNotesTotal)],
              ["Collected", pesos(b.collectedTotal)],
              ["Refunded", pesos(b.refundedTotal)],
              ["Collected less refunds", pesos(b.netCollected)],
            ]
          : [],
      };
    case "revenue-by-category":
      return { columns: ["Category", "Quantity", "Net (PHP)"], rows: (b?.byCategory ?? []).map((c) => [c.category, c.quantity, pesos(c.net)]) };
    case "collections":
      return {
        columns: ["Method", "Payments", "Received (PHP)", "Refunded (PHP)"],
        rows: (b?.collections ?? []).map((c) => [c.method, c.payments, pesos(c.collected), pesos(c.refunded)]),
      };
    case "services":
      return {
        columns: ["Code", "Service", "Category", "Quantity", "Patients", "Net (PHP)"],
        rows: (b?.topServices ?? []).map((s) => [s.code, s.name, s.category, s.quantity, s.patients, pesos(s.net)]),
      };
  }
}

/** One section as CSV, after a short header block (period, scope, privacy and revenue notes) and a blank line. */
export function dashboardCsv(v: ManagementDashboardView, section: CsvSection): string {
  const table = sectionTable(v, section);
  const scope =
    v.facilityIds === null
      ? "All facilities"
      : v.facilityIds.map((id) => v.facilities.find((f) => f.id === id)?.name ?? "Facility").join("; ") || "No facilities";
  const header: Cell[][] = [
    ["Management dashboard", section],
    ["Period", `${v.from} to ${v.to} (${v.timeZone})`],
    ...(v.previous ? [["Compared with", `${v.previous.from} to ${v.previous.to}`] as Cell[]] : []),
    ["Facilities", scope],
    ["Privacy", `Patient counts from 1 to ${v.suppressionThreshold - 1} are shown as <${v.suppressionThreshold}; rates built on them are left empty.`],
    ["Note", "Operational figures, not official, DOH or BIR reports."],
    [],
  ];
  return toCsv([...header, table.columns, ...table.rows]);
}
