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
import { dashboardCsv, type CsvSection, REVENUE_CSV_SECTIONS } from "./management-dashboard.csv";
import { METRIC_DEFINITIONS } from "./management-dashboard.definitions";
import {
  compareFigure,
  coversAll,
  dailySeries,
  daysBetween,
  type FigureComparison,
  patientRate,
  previousRange,
  rate,
  reportableFacilities,
  resolveRange,
  RETENTION_LOOKBACK_MONTHS,
  retentionFigures,
  RETURN_WINDOW_DAYS,
  shiftMonths,
  SMALL_CELL_THRESHOLD,
  suppressCount,
} from "./management-dashboard.rules";

export const MANAGEMENT_PERMISSION = "management.dashboard.read";
/** Revenue, collections and revenue breakdowns also need the billing report permission on every facility in scope. */
export const REVENUE_PERMISSION = "billing.report.read";

export interface ManagementDashboardQuery {
  from?: string;
  to?: string;
  facilityId?: string;
  /** Compare the headline figures with the previous equal period (default true). */
  compare?: boolean;
}

type Section = "billing";

/**
 * The management dashboard (CLAUDE.md §28): patient volume, appointments and no-shows, waiting time, provider
 * utilization, laboratory volume, turnaround and rejections, dental procedures, online consultations, patient
 * retention, revenue and collections, top services — over a range of local days, for one facility or every facility
 * the caller may report on, with the headline figures beside the previous equal period. Each domain counts its own rows
 * (its reporting query); nothing here names a patient, and small patient counts are suppressed. Every view (JSON or
 * CSV) is audited.
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

  async dashboard(actor: Actor, query: ManagementDashboardQuery, now = new Date()) {
    const view = await this.build(actor, { ...query, compare: query.compare ?? true }, now);
    await this.recordView(actor, view, { format: "json" });
    return view;
  }

  /** One section as CSV; revenue sections are refused without the billing report permission on every facility in scope. */
  async csv(actor: Actor, query: ManagementDashboardQuery, section: CsvSection, now = new Date()): Promise<{ filename: string; content: string }> {
    const view = await this.build(actor, { ...query, compare: section === "summary" }, now);
    if (REVENUE_CSV_SECTIONS.includes(section) && view.billing === null) {
      throw new ForbiddenError("Revenue figures need the billing report permission for every facility in scope");
    }
    await this.recordView(actor, view, { format: "csv", section });
    return { filename: `management-${section}-${view.from}-to-${view.to}.csv`, content: dashboardCsv(view, section) };
  }

  async build(actor: Actor, query: ManagementDashboardQuery, now = new Date()) {
    const facilities = await this.organizations.listFacilities(actor.organizationId);
    const allGrants = await this.access.grantsFor(actor.userId, actor.organizationId);
    const grants = allGrants.filter((g) => g.permissionKey === MANAGEMENT_PERMISSION);
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
    // Revenue only when the billing report permission covers every facility the figures cover.
    const covered = facilityIds ?? facilities.map((f) => f.id);
    const includeRevenue = coversAll(
      allGrants.filter((g) => g.permissionKey === REVENUE_PERMISSION),
      covered,
    );
    const withheld: Section[] = includeRevenue ? [] : ["billing"];

    // Local days are read in the one facility's time zone, else the request's facility's, else Manila's.
    const zoneFacility = facilities.find((f) => f.id === (facilityIds?.length === 1 ? facilityIds[0] : actor.facilityId));
    const timeZone = zoneFacility?.timezone ?? PH_TIMEZONE;
    const today = localDate(now, timeZone);
    const range = resolveRange(query, today);
    if ("error" in range) throw new BadRequestError(range.error);
    const windowOf = (r: { from: string; to: string }): ReportingWindow => ({
      from: localDayBounds(r.from, timeZone).start,
      to: localDayBounds(r.to, timeZone).end,
      facilityIds,
      timeZone,
    });
    const retentionParams = (r: { from: string }) => ({
      lookbackStart: localDayBounds(shiftMonths(r.from, -RETENTION_LOOKBACK_MONTHS), timeZone).start,
      returnWindowDays: RETURN_WINDOW_DAYS,
      asOfDate: today,
    });
    const organizationId = actor.organizationId;
    const load = async (r: { from: string; to: string }) => {
      const window = windowOf(r);
      const [patients, clinic, laboratory, dental, telemedicine, retention, billing] = await Promise.all([
        this.patients.registrations(organizationId, window),
        this.clinic.figures(organizationId, window),
        this.laboratory.figures(organizationId, window),
        this.dental.figures(organizationId, window),
        this.telemedicine.figures(organizationId, window),
        this.clinic.retention(organizationId, window, retentionParams(r)),
        includeRevenue ? this.billing.figures(organizationId, window) : Promise.resolve(null),
      ]);
      return { patients, clinic, laboratory, dental, telemedicine, retention, billing };
    };
    const previous = query.compare ? previousRange(range) : null;
    const [current, before] = await Promise.all([load(range), previous ? load(previous) : Promise.resolve(null)]);

    const { daily: patientsDaily, registered } = current.patients;
    const { daily: clinicDaily, ...clinicTotals } = current.clinic;
    const { daily: labDaily, ...labTotals } = current.laboratory;
    const seen = clinicTotals.encounters.patientsSeen;
    const returning = clinicTotals.encounters.returningPatients;
    const returningRate = patientRate(returning, seen);
    const bookedMinutes = clinicTotals.providers.reduce((n, p) => n + p.bookedMinutes, 0);
    const availableMinutes = clinicTotals.providers.reduce((n, p) => n + p.availableMinutes, 0);
    const billing = current.billing
      ? {
          invoices: current.billing.invoices,
          creditNotesTotal: current.billing.creditNotesTotal,
          debitNotesTotal: current.billing.debitNotesTotal,
          collectedTotal: current.billing.collectedTotal,
          refundedTotal: current.billing.refundedTotal,
          netCollected: current.billing.netCollected,
          collections: current.billing.collections,
          byCategory: current.billing.byCategory,
          topServices: current.billing.topServices.map((s) => ({ ...s, patients: suppressCount(s.patients) })),
        }
      : null;

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
      /** The previous equal period the headline figures are compared with (null when not compared). */
      previous,
      comparison: before ? this.compare(current, before) : [],
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
        /** Escalated ÷ finished (ended + escalated). */
        escalationRate: rate(current.telemedicine.escalated, current.telemedicine.ended + current.telemedicine.escalated),
      },
      retention: retentionFigures(current.retention),
      billing,
      daily: dailySeries(daysBetween(range.from, range.to), [
        { key: "registered", rows: patientsDaily, field: "registered" },
        { key: "patientsSeen", rows: clinicDaily, field: "patientsSeen" },
        { key: "encounters", rows: clinicDaily, field: "encounters" },
        { key: "labReleased", rows: labDaily, field: "released" },
        { key: "invoiced", rows: current.billing?.daily ?? [], field: "invoiced" },
        { key: "collected", rows: current.billing?.daily ?? [], field: "collected" },
      ]).map((d) => ({
        ...d,
        registered: suppressCount(d.registered),
        patientsSeen: suppressCount(d.patientsSeen),
        invoiced: includeRevenue ? d.invoiced : null,
        collected: includeRevenue ? d.collected : null,
      })),
      definitions: METRIC_DEFINITIONS,
    };
  }

  /** The headline figures beside the previous period's, each with its direction of improvement. */
  private compare(current: Loaded, previous: Loaded): FigureComparison[] {
    const retention = (l: Loaded) => patientRate(l.retention.retained, l.retention.seen).rate;
    const figures: FigureComparison[] = [
      compareFigure(
        "patientsSeen",
        "patients",
        "up",
        suppressCount(current.clinic.encounters.patientsSeen),
        suppressCount(previous.clinic.encounters.patientsSeen),
      ),
      compareFigure("consultations", "count", "up", current.clinic.encounters.completed, previous.clinic.encounters.completed),
      compareFigure("noShowRate", "rate", "down", current.clinic.appointments.noShowRate, previous.clinic.appointments.noShowRate),
      compareFigure("averageWait", "minutes", "down", current.clinic.visits.averageWaitMinutes, previous.clinic.visits.averageWaitMinutes),
      compareFigure("labReleased", "count", "up", current.laboratory.released, previous.laboratory.released),
      compareFigure("labTurnaround", "minutes", "down", current.laboratory.averageTurnaroundMinutes, previous.laboratory.averageTurnaroundMinutes),
      compareFigure("specimenRejectionRate", "rate", "down", current.laboratory.specimens.rejectionRate, previous.laboratory.specimens.rejectionRate),
      compareFigure("retentionRate", "rate", "up", retention(current), retention(previous)),
    ];
    if (current.billing && previous.billing) {
      figures.push(
        compareFigure("invoicedNet", "centavos", "up", current.billing.invoices.netTotal, previous.billing.invoices.netTotal),
        compareFigure("collected", "centavos", "up", current.billing.netCollected, previous.billing.netCollected),
      );
    }
    return figures;
  }

  private recordView(actor: Actor, view: ManagementDashboardView, output: { format: "json" | "csv"; section?: CsvSection }) {
    return this.audit.recordStandalone(actor, {
      action: "management.dashboard.view",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { from: view.from, to: view.to, facilityIds: view.facilityIds, withheld: view.withheld, compared: view.previous !== null, ...output },
    });
  }
}

type Loaded = {
  clinic: Awaited<ReturnType<ClinicReportingQueries["figures"]>>;
  laboratory: Awaited<ReturnType<LabReportingQueries["figures"]>>;
  retention: Awaited<ReturnType<ClinicReportingQueries["retention"]>>;
  billing: Awaited<ReturnType<BillingReportingQueries["figures"]>> | null;
};

/** The dashboard as returned (JSON) and exported (CSV). */
export type ManagementDashboardView = Awaited<ReturnType<ManagementDashboardService["build"]>>;
