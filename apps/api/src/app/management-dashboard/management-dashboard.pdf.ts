import { type Column, facilityLetterhead, type Letterhead, pdfDateTime, type PdfWriter, renderPdf } from "@healthcare/pdf";
import { type Dashboard, exportRows } from "./management-dashboard.export";
import { type ExportTable, SUPPRESSED, TABLE_SECTIONS, type WithheldSection } from "./management-dashboard.rules";

/** The sections of the printed dashboard, in the order of the screen: a title and the export table it prints. */
const SECTIONS: Array<{ title: string; table: ExportTable; columns?: Column[] }> = [
  { title: "Daily", table: "daily" },
  { title: "Revenue", table: "revenue" },
  { title: "Top services by revenue", table: "services" },
  { title: "Revenue by category", table: "categories" },
  { title: "Payment methods", table: "collections" },
  { title: "Providers", table: "providers" },
  { title: "Laboratory", table: "laboratory" },
  { title: "Most ordered tests", table: "lab-tests" },
  { title: "Results per instrument", table: "lab-instruments" },
  { title: "Laboratory by department", table: "lab-departments" },
  { title: "Dental procedures", table: "dental-procedures" },
  { title: "Online consultations", table: "telemedicine" },
  { title: "Patient retention", table: "retention" },
  { title: "Stock received and used", table: "inventory" },
  { title: "Items that used the most stock value", table: "inventory-items" },
  { title: "Dispensing", table: "dispensing" },
  { title: "Items dispensed most", table: "dispensing-items" },
];

const WITHHELD_TEXT: Record<WithheldSection, string> = {
  billing: "Not available to you: revenue figures need the billing report permission for every facility in scope.",
  inventory: "Not available to you: stock figures need the inventory valuation permission for every facility in scope.",
  dispensing: "Not available to you: dispensing figures need the prescription reading permission for every facility in scope.",
};

/** A cell as printed: rates as percentages, "<5" and numbers as they are, nothing for null. */
function cell(value: string | number | null, header: string): string {
  if (value === null || value === undefined) return "";
  if (value === SUPPRESSED) return value;
  if (typeof value === "number") {
    if (/rate|utilization|within target|share/i.test(header) && value >= 0 && value <= 1 && !Number.isInteger(value))
      return `${Math.round(value * 1000) / 10}%`;
    if (/rate|utilization|within target/i.test(header) && (value === 0 || value === 1)) return `${value * 100}%`;
    return value.toLocaleString("en-PH");
  }
  return value;
}

/** Column widths: the first column (a label) wider; numeric columns right-aligned. */
function columnsFor(header: Array<string | number | null>): Column[] {
  return header.map((h, i) => ({ header: String(h ?? ""), width: i === 0 ? 3 : 1.4, align: i === 0 ? "left" : "right" }));
}

function printTable(w: PdfWriter, rows: Array<Array<string | number | null>>, empty: string, columns?: Column[]): void {
  const [header, ...body] = rows;
  if (!header) return;
  if (body.length === 0) {
    w.paragraph(empty, { muted: true });
    return;
  }
  const cols = columns ?? columnsFor(header);
  w.table(
    cols,
    body.map((row) => row.map((v, i) => cell(v, String(header[i] ?? "")))),
    { fontSize: 8.5 },
  );
}

/**
 * The management dashboard as one A4 document: the key figures for the range against the comparison period (the
 * summary table), then each section's table in the screen's order. A withheld section is printed as not available to
 * the reader, never silently left out; patient counts under five stay "<5". Operational figures, not BIR or DOH
 * reports — the footer says so on every page.
 */
export function renderDashboardPdf(
  d: Dashboard,
  context: {
    organizationName: string;
    facility: Parameters<typeof facilityLetterhead>[1] | null;
    preparedBy: string;
    now: Date;
  },
): Promise<Buffer> {
  const letterhead: Letterhead = context.facility
    ? facilityLetterhead(context.organizationName, context.facility)
    : { organizationName: context.organizationName };
  const scope = d.facilityIds === null ? "All facilities" : d.facilityIds.map((id) => d.facilities.find((f) => f.id === id)?.name ?? "Facility").join(", ");
  const comparison = d.previous.mode === "last-year" ? "the same dates one year earlier" : "the period of the same length just before";
  const printedAt = `Printed ${pdfDateTime(context.now, d.timeZone)}`;
  return renderPdf(
    {
      title: "Management dashboard",
      subtitle: `${scope} · ${d.from} to ${d.to}`,
      letterhead,
      printedAt,
      author: context.organizationName,
      footerNote: `Operational figures for the organization's managers, not official, DOH, PhilHealth or BIR reports. Patient counts under ${d.suppressionThreshold} are shown as "<${d.suppressionThreshold}". Prepared by ${context.preparedBy}.`,
    },
    (w) => {
      w.fields([
        ["Period", `${d.from} to ${d.to} (${d.timeZone})`],
        ["Facilities", scope],
        ["Compared with", `${d.previous.from} to ${d.previous.to} — ${comparison}`],
        ["Prepared by", context.preparedBy],
      ]);
      w.heading("Key figures");
      const summary = exportRows(d, "summary");
      printTable(w, summary, "No figures.", [
        { header: "Figure", width: 3.2 },
        { header: `${d.from} to ${d.to}`, width: 1.3, align: "right" },
        { header: `${d.previous.from} to ${d.previous.to}`, width: 1.3, align: "right" },
        { header: "Change", width: 1, align: "right" },
        { header: "Better when", width: 1, align: "right" },
        { header: "Assessment", width: 1, align: "right" },
      ]);
      for (const section of SECTIONS) {
        w.heading(section.title);
        const gate = TABLE_SECTIONS[section.table];
        if (gate && d.withheld.includes(gate)) {
          w.paragraph(WITHHELD_TEXT[gate], { muted: true });
          continue;
        }
        printTable(w, exportRows(d, section.table), "Nothing in this period.", section.columns);
      }
      w.space(1);
      w.paragraph("How each figure is calculated", { bold: true });
      for (const text of Object.values(d.definitions)) w.paragraph(text, { muted: true, size: 8 });
    },
  );
}
