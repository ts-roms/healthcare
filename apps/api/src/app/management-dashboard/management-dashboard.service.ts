import { Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { AccessService } from "@healthcare/auth";
import { BillingReportingQueries } from "@healthcare/billing";
import { ClinicReportingQueries } from "@healthcare/clinic";
import { type Actor, BadRequestError, ForbiddenError, localDate, localDayBounds, NotFoundError, PH_TIMEZONE, type ReportingWindow } from "@healthcare/core";
import { DentalReportingQueries } from "@healthcare/dental";
import { InventoryReportingQueries } from "@healthcare/inventory";
import { LabReportingQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientReportingQueries } from "@healthcare/patient";
import { PrescriptionReportingQueries } from "@healthcare/prescription";
import { TelemedicineReportingQueries } from "@healthcare/telemedicine";
import { METRIC_DEFINITIONS } from "./management-dashboard.definitions";
import { exportRows } from "./management-dashboard.export";
import { renderDashboardPdf } from "./management-dashboard.pdf";
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
  rate,
  reportableFacilities,
  resolveRange,
  RETENTION_LOOKBACK_MONTHS,
  retentionFigures,
  RETURN_WINDOW_DAYS,
  shiftMonths,
  SMALL_CELL_THRESHOLD,
  suppressCount,
  TABLE_SECTIONS,
  toCsv,
  type WithheldSection,
} from "./management-dashboard.rules";

export const MANAGEMENT_PERMISSION = "management.dashboard.read";
/** Revenue, collections and revenue breakdowns also need the billing report permission on every facility in scope. */
export const REVENUE_PERMISSION = "billing.report.read";
/** Stock received, used and written off at cost also needs inventory valuation on every facility in scope. */
export const INVENTORY_PERMISSION = "inventory.valuation.read";
/** Dispensing figures also need prescription reading on every facility in scope. */
export const DISPENSING_PERMISSION = "prescription.read";

/** Why a section is withheld, as audited and answered. */
const SECTION_REFUSALS: Record<WithheldSection, { reason: string; message: string }> = {
  billing: {
    reason: "Revenue figures need billing.report.read for every facility in scope",
    message: "Revenue figures need the billing report permission for every facility in scope",
  },
  inventory: {
    reason: "Stock figures need inventory.valuation.read for every facility in scope",
    message: "Stock figures need the inventory valuation permission for every facility in scope",
  },
  dispensing: {
    reason: "Dispensing figures need prescription.read for every facility in scope",
    message: "Dispensing figures need the prescription reading permission for every facility in scope",
  },
};

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
    private readonly inventory: InventoryReportingQueries,
    private readonly dispensing: PrescriptionReportingQueries,
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
   * A table of a withheld section (revenue without billing reporting, stock without inventory valuation, dispensing
   * without prescription reading, on every facility in scope) is refused, and the refusal is audited.
   */
  async export(actor: Actor, query: DashboardQuery, table: ExportTable, now = new Date()): Promise<{ filename: string; csv: string }> {
    const d = await this.build(actor, query, now);
    const section = TABLE_SECTIONS[table];
    if (section && d.withheld.includes(section)) {
      await this.audit.recordStandalone(actor, {
        action: "management.dashboard.export",
        resourceType: "organization",
        resourceId: actor.organizationId,
        outcome: "denied",
        reason: SECTION_REFUSALS[section].reason,
        metadata: { table, from: d.from, to: d.to, facilityIds: d.facilityIds, withheld: d.withheld },
      });
      throw new ForbiddenError(SECTION_REFUSALS[section].message);
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

  /**
   * The whole dashboard as one printable PDF (`libs/pdf`): the key figures against the comparison period, then each
   * section's table. Withheld sections are printed as not available to the caller, never silently left out; small
   * patient counts stay "<5". Audited as an export of table `pdf`.
   */
  async exportPdf(actor: Actor, query: DashboardQuery, now = new Date()): Promise<{ filename: string; pdf: Buffer; withheld: WithheldSection[] }> {
    const d = await this.build(actor, query, now);
    const [organization, facility] = await Promise.all([
      this.organizations.getOrganization(actor.organizationId),
      d.facilityIds?.length === 1 ? this.organizations.getFacility(actor.organizationId, d.facilityIds[0]!) : Promise.resolve(null),
    ]);
    const pdf = await renderDashboardPdf(d, { organizationName: organization.name, facility, preparedBy: actor.displayName, now });
    await this.audit.recordStandalone(actor, {
      action: "management.dashboard.export",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { table: "pdf", from: d.from, to: d.to, facilityIds: d.facilityIds, withheld: d.withheld },
    });
    return { filename: `management-dashboard-${d.from}-to-${d.to}.pdf`, pdf, withheld: d.withheld };
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
    // Revenue, stock and dispensing only when their permission covers every facility the figures cover.
    const covered = (permission: string) =>
      coversAll(
        allGrants.filter((g) => g.permissionKey === permission),
        facilityIds ?? facilities.map((f) => f.id),
      );
    const include = { billing: covered(REVENUE_PERMISSION), inventory: covered(INVENTORY_PERMISSION), dispensing: covered(DISPENSING_PERMISSION) };
    const withheld: WithheldSection[] = (Object.keys(include) as WithheldSection[]).filter((section) => !include[section]);

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
      this.figures(actor.organizationId, windowOf(range), retention(range), include),
      this.figures(actor.organizationId, windowOf(previous), retention(previous), include),
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
    const stock = current.inventory;
    const rx = current.dispensing;
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
      /**
       * Sections left out for lack of permission on every facility in scope: billing (billing.report.read), inventory
       * (inventory.valuation.read), dispensing (prescription.read).
       */
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
      /** Null when withheld. Centavos at the cost each stock movement recorded; transfers between locations are not use. */
      inventory: stock
        ? {
            received: stock.received,
            used: stock.used,
            writtenOff: stock.writtenOff,
            usedBySource: stock.usedBySource,
            topItems: stock.topItems,
          }
        : null,
      /** Null when withheld. Dispense lines from prescriptions; patients served is a patient count (suppressed). */
      dispensing: rx
        ? {
            prescriptionsIssued: rx.prescriptionsIssued,
            prescriptionsCancelled: rx.prescriptionsCancelled,
            dispenses: rx.dispenses,
            reversed: rx.reversed,
            prescriptionsDispensed: rx.prescriptionsDispensed,
            patients: suppressCount(rx.patients),
            topItems: rx.topItems,
          }
        : null,
      daily: dailySeries(daysBetween(range.from, range.to), [
        { key: "registered", rows: patientsDaily, field: "registered" },
        { key: "patientsSeen", rows: clinicDaily, field: "patientsSeen" },
        { key: "encounters", rows: clinicDaily, field: "encounters" },
        { key: "labReleased", rows: labDaily, field: "released" },
        { key: "invoiced", rows: b?.daily ?? [], field: "invoiced" },
        { key: "collected", rows: b?.daily ?? [], field: "collected" },
        { key: "dispenses", rows: rx?.daily ?? [], field: "dispenses" },
      ]).map((d) => ({
        ...d,
        registered: suppressCount(d.registered),
        patientsSeen: suppressCount(d.patientsSeen),
        invoiced: b ? d.invoiced : null,
        collected: b ? d.collected : null,
        /** Null when dispensing is withheld. */
        dispenses: rx ? d.dispenses : null,
      })),
      /** "How is this calculated?" per figure. */
      definitions: METRIC_DEFINITIONS,
    };
  }

  private async figures(
    organizationId: string,
    window: ReportingWindow,
    retention: { lookbackStart: Date; returnWindowDays: number; asOfDate: string },
    include: Record<WithheldSection, boolean>,
  ) {
    const [patients, clinic, laboratory, dental, telemedicine, retained, billing, inventory, dispensing] = await Promise.all([
      this.patients.registrations(organizationId, window),
      this.clinic.figures(organizationId, window),
      this.laboratory.figures(organizationId, window),
      this.dental.figures(organizationId, window),
      this.telemedicine.figures(organizationId, window),
      this.clinic.retention(organizationId, window, retention),
      include.billing ? this.billing.figures(organizationId, window) : Promise.resolve(null),
      include.inventory ? this.inventory.figures(organizationId, window) : Promise.resolve(null),
      include.dispensing ? this.dispensing.figures(organizationId, window) : Promise.resolve(null),
    ]);
    return { patients, clinic, laboratory, dental, telemedicine, retention: retained, billing, inventory, dispensing };
  }
}
