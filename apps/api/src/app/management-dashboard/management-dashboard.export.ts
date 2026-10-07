import type { ExportTable } from "./management-dashboard.rules";
import { pesos, summaryRows } from "./management-dashboard.rules";
import type { ManagementDashboardService } from "./management-dashboard.service";

export type Dashboard = Awaited<ReturnType<ManagementDashboardService["dashboard"]>>;
export type Row = Array<string | number | null>;

/** Staff-facing names of the workflows that take stock (the movement's source). */
const SOURCE_LABEL: Record<string, string> = {
  prescription_dispense: "Dispensed on prescriptions",
  lab_reagent_load: "Laboratory reagents loaded",
  dental_procedure: "Dental procedures",
  clinic_procedure: "Clinic procedures",
  immunization: "Immunizations",
  purchase_order_line: "Purchase orders",
};
const KIND_LABEL: Record<string, string> = { issue: "Issued", write_off: "Written off", return: "Returned", adjustment: "Count adjustments" };
/** "Dispensed on prescriptions" for a sourced movement, else the kind ("Issued", "Written off"…). */
export function useLabel(sourceType: string | null, kind: string): string {
  return sourceType ? (SOURCE_LABEL[sourceType] ?? sourceType) : (KIND_LABEL[kind] ?? kind);
}

/** The rows (with a header) of one exported table. Gated tables are only asked for when their section is not withheld. */
export function exportRows(d: Dashboard, table: ExportTable): Row[] {
  const b = d.billing;
  switch (table) {
    case "summary":
      return summaryRows(d.keyFigures, d.previous.keyFigures, { from: d.from, to: d.to, previousFrom: d.previous.from, previousTo: d.previous.to }, d.withheld);
    case "daily":
      return [
        [
          "Date",
          "New patients",
          "Patients seen",
          "Consultations",
          "Laboratory tests released",
          ...(b ? ["Invoiced, net (PHP)", "Collected less refunds (PHP)"] : []),
          ...(d.dispensing ? ["Dispenses"] : []),
        ],
        ...d.daily.map((r): Row => [
          r.date,
          r.registered,
          r.patientsSeen,
          r.encounters,
          r.labReleased,
          ...(b ? [pesos(r.invoiced ?? 0), pesos(r.collected ?? 0)] : []),
          ...(d.dispensing ? [r.dispenses ?? 0] : []),
        ]),
      ];
    case "services":
      return [
        ["Code", "Service", "Category", "Quantity", "Net (PHP)", "Patients"],
        ...(b?.topServices ?? []).map((s): Row => [s.code, s.name, s.category, s.quantity, pesos(s.net), s.patients]),
      ];
    case "categories":
      return [["Category", "Quantity", "Net (PHP)"], ...(b?.byCategory ?? []).map((c): Row => [c.category, c.quantity, pesos(c.net)])];
    case "collections":
      return [
        ["Method", "Payments", "Received (PHP)", "Refunded (PHP)"],
        ...(b?.collections ?? []).map((c): Row => [c.method, c.payments, pesos(c.collected), pesos(c.refunded)]),
      ];
    case "revenue":
      return [
        ["Figure", "Value"],
        ...(b
          ? ([
              ["Invoices issued", b.invoices.issued],
              ["Gross (PHP)", pesos(b.invoices.grossTotal)],
              ["Discounts (PHP)", pesos(b.invoices.discountTotal)],
              ["Net invoiced (PHP)", pesos(b.invoices.netTotal)],
              ["Payer share (PHP)", pesos(b.invoices.payerTotal)],
              ["Patient share (PHP)", pesos(b.invoices.patientTotal)],
              ["Invoices voided", b.invoices.voided],
              ["Credit notes (PHP)", pesos(b.creditNotesTotal)],
              ["Debit notes (PHP)", pesos(b.debitNotesTotal)],
              ["Collected (PHP)", pesos(b.collectedTotal)],
              ["Refunded (PHP)", pesos(b.refundedTotal)],
              ["Collected less refunds (PHP)", pesos(b.netCollected)],
            ] as Row[])
          : []),
      ];
    case "providers":
      return [
        ["Practitioner", "Consultations", "Patients", "Appointments booked", "No-shows", "Booked minutes", "Available minutes", "Utilization"],
        ...d.clinic.providers.map((p): Row => [
          p.displayName,
          p.encounters,
          p.patients,
          p.appointments,
          p.noShows,
          p.bookedMinutes,
          p.availableMinutes,
          p.utilization,
        ]),
      ];
    case "laboratory": {
      const l = d.laboratory;
      return [
        ["Figure", "Value"],
        ["Orders", l.orders.orders],
        ["STAT orders", l.orders.stat],
        ["Cancelled orders", l.orders.cancelled],
        ["Tests ordered", l.testsOrdered],
        ["Tests released (first release)", l.released],
        ["Corrections released", l.corrections],
        ["Average turnaround, collection to release (minutes)", l.averageTurnaroundMinutes],
        ["Median turnaround (minutes)", l.medianTurnaroundMinutes],
        ["90th percentile turnaround (minutes)", l.p90TurnaroundMinutes],
        ["Released within target", l.withinTargetRate],
        ["Specimens collected", l.specimens.collected],
        ["Of those rejected", l.specimens.rejected],
        ["Specimen rejection rate", l.specimens.rejectionRate],
        ["Specimens rejected in the period (any collection date)", l.specimensRejected],
      ];
    }
    case "lab-tests":
      return [["Test", "Ordered"], ...d.laboratory.topTests.map((t): Row => [t.name, t.ordered])];
    case "lab-instruments":
      return [["Instrument", "First results entered"], ...d.laboratory.byInstrument.map((i): Row => [i.name ?? "No instrument recorded", i.results])];
    case "lab-departments":
      return [
        ["Department", "Tests released", "Average turnaround (minutes)", "Median turnaround (minutes)", "Released within target"],
        ...d.laboratory.byDepartment.map((x): Row => [x.name, x.released, x.averageTurnaroundMinutes, x.medianTurnaroundMinutes, x.withinTargetRate]),
      ];
    case "dental-procedures":
      return [["Code", "Procedure", "Procedures", "Patients"], ...d.dental.byProcedure.map((p): Row => [p.code, p.name, p.procedures, p.patients])];
    case "telemedicine": {
      const t = d.telemedicine;
      return [
        [
          "Started",
          "Ended",
          "Escalated",
          "In progress",
          "Escalation rate",
          "Average wait, joined to started (minutes)",
          "Median wait (minutes)",
          "90th percentile wait (minutes)",
          "Joined, never seen",
        ],
        [t.started, t.ended, t.escalated, t.inProgress, t.escalationRate, t.averageWaitMinutes, t.medianWaitMinutes, t.p90WaitMinutes, t.joinedNotSeen],
      ];
    }
    case "retention": {
      const r = d.retention;
      return [
        [
          "Patients seen",
          `Also seen in the ${r.lookbackMonths} months before`,
          "Retention rate",
          "Return cohort",
          `Returned within ${r.returnWindowDays} days`,
          "Return rate",
        ],
        [r.seen, r.retained, r.retentionRate, r.returnCohort, r.returned, r.returnRate],
      ];
    }
    case "inventory": {
      const s = d.inventory;
      return [
        ["Figure", "Quantity", "Value at cost (PHP)", "Quantity without a cost"],
        ...(s
          ? ([
              ["Received", s.received.quantity, pesos(s.received.value), s.received.unvaluedQuantity],
              ["Used (issued, dispensed, written off; net of returns)", s.used.quantity, pesos(s.used.value), s.used.unvaluedQuantity],
              ["Of which written off", s.writtenOff.quantity, pesos(s.writtenOff.value), s.writtenOff.unvaluedQuantity],
              ...s.usedBySource.map((u): Row => [`Used: ${useLabel(u.sourceType, u.kind)}`, u.quantity, pesos(u.value), u.unvaluedQuantity]),
            ] as Row[])
          : []),
      ];
    }
    case "inventory-items":
      return [
        ["Code", "Item", "Category", "Unit", "Quantity used", "Value at cost (PHP)"],
        ...(d.inventory?.topItems ?? []).map((i): Row => [i.code, i.name, i.category, i.stockUnit, i.quantity, pesos(i.value)]),
      ];
    case "dispensing": {
      const x = d.dispensing;
      return [
        ["Figure", "Value"],
        ...(x
          ? ([
              ["Prescriptions issued", x.prescriptionsIssued],
              ["Of which cancelled or replaced", x.prescriptionsCancelled],
              ["Dispenses recorded", x.dispenses],
              ["Of which reversed", x.reversed],
              ["Prescriptions dispensed", x.prescriptionsDispensed],
              ["Patients served", x.patients],
            ] as Row[])
          : []),
      ];
    }
    case "dispensing-items":
      return [
        ["Item", "Unit", "Quantity dispensed", "Dispenses"],
        ...(d.dispensing?.topItems ?? []).map((i): Row => [i.name, i.stockUnit, i.quantity, i.dispenses]),
      ];
  }
}
