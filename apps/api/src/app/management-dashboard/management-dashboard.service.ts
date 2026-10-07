import { Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { AccessService } from "@healthcare/auth";
import { BillingReportingQueries } from "@healthcare/billing";
import { ClinicReportingQueries } from "@healthcare/clinic";
import { type Actor, BadRequestError, ForbiddenError, localDate, localDayBounds, NotFoundError, PH_TIMEZONE, type ReportingWindow } from "@healthcare/core";
import { DentalReportingQueries } from "@healthcare/dental";
import { LabReportingQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientReportingQueries } from "@healthcare/patient";
import { TelemedicineReportingQueries } from "@healthcare/telemedicine";
import { METRIC_DEFINITIONS } from "./management-dashboard.definitions";
import {
  type ComparisonMode,
  comparisonRange,
  coversAll,
  dailySeries,
  daysBetween,
  type ExportTable,
  keyFigureChanges,
  keyFigures,
  patientRate,
  pesos,
  rate,
  reportableFacilities,
  resolveRange,
  RETENTION_LOOKBACK_MONTHS,
  retentionFigures,
  RETURN_WINDOW_DAYS,
  REVENUE_EXPORT_TABLES,
  shiftMonths,
  SMALL_CELL_THRESHOLD,
  summaryRows,
  suppressCount,
  toCsv,
} from "./management-dashboard.rules";

export const MANAGEMENT_PERMISSION = "management.dashboard.read";
/** Revenue, collections and revenue breakdowns also need the billing report permission on every facility in scope. */
export const REVENUE_PERMISSION = "billing.report.read";

type DashboardQuery = { from?: string; to?: string; facilityId?: string; comparison?: ComparisonMode };

/**
 * The management dashboard (CLAUDE.md §28): patient volume and retention, appointments and no-shows, waiting time,
 * provider and schedule utilization, laboratory volume, turnaround and rejections, dental procedures, online
 * consultations, revenue and collections, top services — over a range of local days, for one facility or every facility
 * the caller may report on, with the headline figures of the period of the same length just before. Each domain counts
 * its own rows (its reporting query); nothing here names a patient, and small patient counts are suppressed. Revenue
 * needs billing reporting on every facility in scope. Every view and export is audited.
 */
@Injectable()
export class ManagementDashboardService {
  constructor(
    private readonly access: AccessService,
    private readonly organizations: OrganizationService,
    private readonly patients: PatientReportingQueries,
    private readonly clinic: ClinicReportingQueries,
    private readonly laboratory: LabReportingQueries,
    private readonly dental: DentalReportingQueries,
    private readonly telemedicine: TelemedicineReportingQueries,
    private readonly billing: BillingReportingQueries,
    private readonly audit: AuditService,
  ) {}

  /** The dashboard, audited as a view. */
  async dashboard(actor: Actor, query: DashboardQuery, now = new Date()) {
    const result = await this.build(actor, query, now);
    await this.audit.recordStandalone(actor, {
      action: "management.dashboard.view",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { from: result.from, to: result.to, facilityIds: result.facilityIds, withheld: result.withheld },
    });
    return result;
  }

  /**
   * One table of the dashboard as CSV (amounts in pesos, small patient counts suppressed), audited as an export.
   * Revenue tables without billing reporting on every facility in scope are refused, and the refusal is audited.
   */
  async export(actor: Actor, query: DashboardQuery, table: ExportTable, now = new Date()): Promise<{ filename: string; csv: string }> {
    const d = await this.build(actor, query, now);
    if (REVENUE_EXPORT_TABLES.includes(table) && d.billing === null) {
      await this.audit.recordStandalone(actor, {
        action: "management.dashboard.export",
        resourceType: "organization",
        resourceId: actor.organizationId,
        outcome: "denied",
        reason: "Revenue figures need billing.report.read for every facility in scope",
        metadata: { table, from: d.from, to: d.to, facilityIds: d.facilityIds, withheld: d.withheld },
      });
      throw new ForbiddenError("Revenue figures need the billing report permission for every facility in scope");
    }
    const rows = exportRows(d, table);
    await this.audit.recordStandalone(actor, {
      action: "management.dashboard.export",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { table, from: d.from, to: d.to, facilityIds: d.facilityIds, withheld: d.withheld, rows: rows.length - 1 },
    });
    return { filename: `management-${table}-${d.from}-to-${d.to}.csv`, csv: toCsv(rows) };
  }

  private async build(actor: Actor, query: DashboardQuery, now: Date) {
    const facilities = await this.organizations.listFacilities(actor.organizationId);
    const allGrants = await this.access.grantsFor(actor.userId, actor.organizationId);
    const scope = reportableFacilities(
      allGrants.filter((g) => g.permissionKey === MANAGEMENT_PERMISSION),
      facilities.map((f) => f.id),
    );
    let facilityIds: string[] | null;
    if (query.facilityId) {
      if (!facilities.some((f) => f.id === query.facilityId)) throw new NotFoundError("Facility");
      if (!scope.facilityIds.includes(query.facilityId)) throw new ForbiddenError("You may not view this facility's figures");
      facilityIds = [query.facilityId];
    } else {
      facilityIds = scope.all ? null : scope.facilityIds;
    }
    // Revenue only when the billing report permission covers every facility the figures cover.
    const includeRevenue = coversAll(
      allGrants.filter((g) => g.permissionKey === REVENUE_PERMISSION),
      facilityIds ?? facilities.map((f) => f.id),
    );
    const withheld: Array<"billing"> = includeRevenue ? [] : ["billing"];

    // Local days are read in the one facility's time zone, else the request's facility's, else Manila's.
    const zoneFacility = facilities.find((f) => f.id === (facilityIds?.length === 1 ? facilityIds[0] : actor.facilityId));
    const timeZone = zoneFacility?.timezone ?? PH_TIMEZONE;
    const today = localDate(now, timeZone);
    const range = resolveRange(query, today);
    if ("error" in range) throw new BadRequestError(range.error);
    const comparison: ComparisonMode = query.comparison ?? "previous";
    const previous = comparisonRange(range.from, range.to, comparison);
    const windowOf = (r: { from: string; to: string }): ReportingWindow => ({
      from: localDayBounds(r.from, timeZone).start,
      to: localDayBounds(r.to, timeZone).end,
      facilityIds,
      timeZone,
    });
    const retention = (r: { from: string }) => ({
      lookbackStart: localDayBounds(shiftMonths(r.from, -RETENTION_LOOKBACK_MONTHS), timeZone).start,
      returnWindowDays: RETURN_WINDOW_DAYS,
      asOfDate: today,
    });

    const [current, before] = await Promise.all([
      this.figures(actor.organizationId, windowOf(range), retention(range), includeRevenue),
      this.figures(actor.organizationId, windowOf(previous), retention(previous), includeRevenue),
    ]);
    const { daily: patientsDaily, registered } = current.patients;
    const { daily: clinicDaily, ...clinicTotals } = current.clinic;
    const { daily: labDaily, ...labTotals } = current.laboratory;
    const seen = clinicTotals.encounters.patientsSeen;
    const returning = clinicTotals.encounters.returningPatients;
    const returningRate = patientRate(returning, seen);
    const bookedMinutes = clinicTotals.providers.reduce((n, p) => n + p.bookedMinutes, 0);
    const availableMinutes = clinicTotals.providers.reduce((n, p) => n + p.availableMinutes, 0);
    const b = current.billing;
    const currentFigures = keyFigures(current);
    const previousFigures = keyFigures(before);

    return {
      from: range.from,
      to: range.to,
      timeZone,
      /** The facilities the figures cover (null: the whole organization). */
      facilityIds,
      /** Facilities the caller may choose from. */
      facilities: facilities.filter((f) => scope.facilityIds.includes(f.id)).map((f) => ({ id: f.id, name: f.name })),
      wholeOrganization: scope.all,
      /** Patient counts from 1 to this − 1 are shown as "<5". */
      suppressionThreshold: SMALL_CELL_THRESHOLD,
      /** Sections left out for lack of permission (billing: needs billing.report.read on every facility in scope). */
      withheld,
      /** Headline figures for the range, and for the comparison period (the same length just before, or a year earlier). */
      keyFigures: currentFigures,
      previous: { ...previous, mode: comparison, keyFigures: previousFigures, changes: keyFigureChanges(currentFigures, previousFigures) },
      patients: {
        registered: suppressCount(registered),
        seen: suppressCount(seen),
        returning: suppressCount(returning),
        /** Seen for the first time in the organization (seen − returning). */
        firstTime: suppressCount(seen - returning),
        /** Share of patients seen who had been seen before the range (withheld when a count is suppressed). */
        returningRate: returningRate.rate,
        returningRateSuppressed: returningRate.suppressed,
      },
      clinic: {
        ...clinicTotals,
        encounters: { ...clinicTotals.encounters, patientsSeen: suppressCount(seen), returningPatients: suppressCount(returning) },
        providers: clinicTotals.providers.map((p) => ({
          ...p,
          patients: suppressCount(p.patients),
          /** Booked ÷ available minutes (may exceed 1; null without schedule minutes). */
          utilization: rate(p.bookedMinutes, p.availableMinutes),
        })),
        utilization: { bookedMinutes, availableMinutes, rate: rate(bookedMinutes, availableMinutes) },
      },
      laboratory: labTotals,
      dental: {
        procedures: current.dental.procedures,
        patients: suppressCount(current.dental.patients),
        byProcedure: current.dental.byProcedure.map((p) => ({ ...p, patients: suppressCount(p.patients) })),
      },
      telemedicine: {
        ...current.telemedicine,
        /** Patients who joined the waiting room in the period and whose consultation never started (one per session). */
        joinedNotSeen: suppressCount(current.telemedicine.joinedNotSeen),
        /** Escalated ÷ finished (ended + escalated). */
        escalationRate: rate(current.telemedicine.escalated, current.telemedicine.ended + current.telemedicine.escalated),
      },
      retention: retentionFigures(current.retention),
      /** Null when withheld (see `withheld`). */
      billing: b
        ? {
            invoices: b.invoices,
            creditNotesTotal: b.creditNotesTotal,
            debitNotesTotal: b.debitNotesTotal,
            collectedTotal: b.collectedTotal,
            refundedTotal: b.refundedTotal,
            netCollected: b.netCollected,
            collections: b.collections,
            byCategory: b.byCategory,
            topServices: b.topServices.map((s) => ({ ...s, patients: suppressCount(s.patients) })),
          }
        : null,
      daily: dailySeries(daysBetween(range.from, range.to), [
        { key: "registered", rows: patientsDaily, field: "registered" },
        { key: "patientsSeen", rows: clinicDaily, field: "patientsSeen" },
        { key: "encounters", rows: clinicDaily, field: "encounters" },
        { key: "labReleased", rows: labDaily, field: "released" },
        { key: "invoiced", rows: b?.daily ?? [], field: "invoiced" },
        { key: "collected", rows: b?.daily ?? [], field: "collected" },
      ]).map((d) => ({
        ...d,
        registered: suppressCount(d.registered),
        patientsSeen: suppressCount(d.patientsSeen),
        invoiced: b ? d.invoiced : null,
        collected: b ? d.collected : null,
      })),
      /** "How is this calculated?" per figure. */
      definitions: METRIC_DEFINITIONS,
    };
  }

  private async figures(
    organizationId: string,
    window: ReportingWindow,
    retention: { lookbackStart: Date; returnWindowDays: number; asOfDate: string },
    includeRevenue: boolean,
  ) {
    const [patients, clinic, laboratory, dental, telemedicine, retained, billing] = await Promise.all([
      this.patients.registrations(organizationId, window),
      this.clinic.figures(organizationId, window),
      this.laboratory.figures(organizationId, window),
      this.dental.figures(organizationId, window),
      this.telemedicine.figures(organizationId, window),
      this.clinic.retention(organizationId, window, retention),
      includeRevenue ? this.billing.figures(organizationId, window) : Promise.resolve(null),
    ]);
    return { patients, clinic, laboratory, dental, telemedicine, retention: retained, billing };
  }
}

type Dashboard = Awaited<ReturnType<ManagementDashboardService["dashboard"]>>;
type Row = Array<string | number | null>;

/** The rows (with a header) of one exported table. Revenue tables are only asked for when billing is not withheld. */
function exportRows(d: Dashboard, table: ExportTable): Row[] {
  const b = d.billing;
  switch (table) {
    case "summary":
      return summaryRows(d.keyFigures, d.previous.keyFigures, { from: d.from, to: d.to, previousFrom: d.previous.from, previousTo: d.previous.to }, b !== null);
    case "daily":
      return [
        [
          "Date",
          "New patients",
          "Patients seen",
          "Consultations",
          "Laboratory tests released",
          ...(b ? ["Invoiced, net (PHP)", "Collected less refunds (PHP)"] : []),
        ],
        ...d.daily.map((r): Row => [
          r.date,
          r.registered,
          r.patientsSeen,
          r.encounters,
          r.labReleased,
          ...(b ? [pesos(r.invoiced ?? 0), pesos(r.collected ?? 0)] : []),
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
  }
}
