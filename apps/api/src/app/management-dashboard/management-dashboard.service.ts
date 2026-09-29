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
import {
  dailySeries,
  daysBetween,
  type ExportTable,
  keyFigures,
  pesos,
  previousRange,
  rate,
  reportableFacilities,
  resolveRange,
  summaryRows,
  toCsv,
} from "./management-dashboard.rules";

export const MANAGEMENT_PERMISSION = "management.dashboard.read";

/**
 * The management dashboard (CLAUDE.md §28): patient volume, appointments and no-shows, waiting time, provider
 * utilization, laboratory volume and turnaround, dental procedures, revenue and collections, top services — over a
 * range of local days, for one facility or every facility the caller may report on. Each domain counts its own rows
 * (its reporting query); nothing here names a patient. Every view and export is audited.
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
      metadata: { from: result.from, to: result.to, facilityIds: result.facilityIds },
    });
    return result;
  }

  /** One table of the dashboard as CSV (amounts in pesos), audited as an export. */
  async export(actor: Actor, query: DashboardQuery, table: ExportTable, now = new Date()): Promise<{ filename: string; csv: string }> {
    const d = await this.build(actor, query, now);
    const rows = exportRows(d, table);
    await this.audit.recordStandalone(actor, {
      action: "management.dashboard.export",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { table, from: d.from, to: d.to, facilityIds: d.facilityIds, rows: rows.length - 1 },
    });
    return { filename: `management-${table}-${d.from}-to-${d.to}.csv`, csv: toCsv(rows) };
  }

  private async build(actor: Actor, query: DashboardQuery, now: Date) {
    const facilities = await this.organizations.listFacilities(actor.organizationId);
    const grants = (await this.access.grantsFor(actor.userId, actor.organizationId)).filter((g) => g.permissionKey === MANAGEMENT_PERMISSION);
    const scope = reportableFacilities(
      grants,
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
    // Local days are read in the one facility's time zone, else the request's facility's, else Manila's.
    const zoneFacility = facilities.find((f) => f.id === (facilityIds?.length === 1 ? facilityIds[0] : actor.facilityId));
    const timeZone = zoneFacility?.timezone ?? PH_TIMEZONE;
    const range = resolveRange(query, localDate(now, timeZone));
    if ("error" in range) throw new BadRequestError(range.error);
    const previous = previousRange(range.from, range.to);
    const windowOf = (r: { from: string; to: string }): ReportingWindow => ({
      from: localDayBounds(r.from, timeZone).start,
      to: localDayBounds(r.to, timeZone).end,
      facilityIds,
      timeZone,
    });

    const [current, before] = await Promise.all([this.figures(actor.organizationId, windowOf(range)), this.figures(actor.organizationId, windowOf(previous))]);
    const { daily: patientsDaily, ...patientTotals } = current.patients;
    const { daily: clinicDaily, ...clinicTotals } = current.clinic;
    const { daily: labDaily, ...labTotals } = current.laboratory;
    const { daily: billingDaily, ...billingTotals } = current.billing;
    return {
      from: range.from,
      to: range.to,
      timeZone,
      /** The facilities the figures cover (null: the whole organization). */
      facilityIds,
      /** Facilities the caller may choose from. */
      facilities: facilities.filter((f) => scope.facilityIds.includes(f.id)).map((f) => ({ id: f.id, name: f.name })),
      wholeOrganization: scope.all,
      /** Headline figures for the range, and for the period of the same length just before it. */
      keyFigures: keyFigures(current),
      previous: { ...previous, keyFigures: keyFigures(before) },
      patients: {
        ...patientTotals,
        seen: clinicTotals.encounters.patientsSeen,
        returning: clinicTotals.encounters.returningPatients,
        /** Share of patients seen who had been seen before the range. */
        returningRate: rate(clinicTotals.encounters.returningPatients, clinicTotals.encounters.patientsSeen),
      },
      clinic: clinicTotals,
      laboratory: labTotals,
      dental: current.dental,
      billing: billingTotals,
      daily: dailySeries(daysBetween(range.from, range.to), [
        { key: "registered", rows: patientsDaily, field: "registered" },
        { key: "encounters", rows: clinicDaily, field: "encounters" },
        { key: "labReleased", rows: labDaily, field: "released" },
        { key: "invoiced", rows: billingDaily, field: "invoiced" },
        { key: "collected", rows: billingDaily, field: "collected" },
      ]),
    };
  }

  private async figures(organizationId: string, window: ReportingWindow) {
    const [patients, clinic, laboratory, dental, billing] = await Promise.all([
      this.patients.registrations(organizationId, window),
      this.clinic.figures(organizationId, window),
      this.laboratory.figures(organizationId, window),
      this.dental.figures(organizationId, window),
      this.billing.figures(organizationId, window),
    ]);
    return { patients, clinic, laboratory, dental, billing };
  }
}

type DashboardQuery = { from?: string; to?: string; facilityId?: string };
type Dashboard = Awaited<ReturnType<ManagementDashboardService["dashboard"]>>;

/** The rows (with a header) of one exported table. */
function exportRows(d: Dashboard, table: ExportTable): Array<Array<string | number | null>> {
  switch (table) {
    case "summary":
      return summaryRows(d.keyFigures, d.previous.keyFigures, { from: d.from, to: d.to, previousFrom: d.previous.from, previousTo: d.previous.to });
    case "daily":
      return [
        ["Date", "New patients", "Consultations", "Laboratory tests released", "Invoiced, net (PHP)", "Collected less refunds (PHP)"],
        ...d.daily.map((r) => [r.date, r.registered, r.encounters, r.labReleased, pesos(r.invoiced), pesos(r.collected)]),
      ];
    case "services":
      return [
        ["Code", "Service", "Category", "Quantity", "Net (PHP)"],
        ...d.billing.topServices.map((s) => [s.code, s.name, s.category, s.quantity, pesos(s.net)]),
      ];
    case "categories":
      return [["Category", "Quantity", "Net (PHP)"], ...d.billing.byCategory.map((c) => [c.category, c.quantity, pesos(c.net)])];
    case "providers":
      return [
        ["Practitioner", "Consultations", "Patients", "Appointments booked", "No-shows"],
        ...d.clinic.providers.map((p) => [p.displayName, p.encounters, p.patients, p.appointments, p.noShows]),
      ];
  }
}
