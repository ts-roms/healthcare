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
import { dailySeries, daysBetween, rate, reportableFacilities, resolveRange } from "./management-dashboard.rules";

export const MANAGEMENT_PERMISSION = "management.dashboard.read";

/**
 * The management dashboard (CLAUDE.md §28): patient volume, appointments and no-shows, waiting time, provider
 * utilization, laboratory volume and turnaround, dental procedures, revenue and collections, top services — over a
 * range of local days, for one facility or every facility the caller may report on. Each domain counts its own rows
 * (its reporting query); nothing here names a patient. Every view is audited.
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

  async dashboard(actor: Actor, query: { from?: string; to?: string; facilityId?: string }, now = new Date()) {
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
    const window: ReportingWindow = {
      from: localDayBounds(range.from, timeZone).start,
      to: localDayBounds(range.to, timeZone).end,
      facilityIds,
      timeZone,
    };

    const [patients, clinic, laboratory, dental, billing] = await Promise.all([
      this.patients.registrations(actor.organizationId, window),
      this.clinic.figures(actor.organizationId, window),
      this.laboratory.figures(actor.organizationId, window),
      this.dental.figures(actor.organizationId, window),
      this.billing.figures(actor.organizationId, window),
    ]);
    const { daily: patientsDaily, ...patientTotals } = patients;
    const { daily: clinicDaily, ...clinicTotals } = clinic;
    const { daily: labDaily, ...labTotals } = laboratory;
    const { daily: billingDaily, ...billingTotals } = billing;

    await this.audit.recordStandalone(actor, {
      action: "management.dashboard.view",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { from: range.from, to: range.to, facilityIds },
    });
    return {
      from: range.from,
      to: range.to,
      timeZone,
      /** The facilities the figures cover (null: the whole organization). */
      facilityIds,
      /** Facilities the caller may choose from. */
      facilities: facilities.filter((f) => scope.facilityIds.includes(f.id)).map((f) => ({ id: f.id, name: f.name })),
      wholeOrganization: scope.all,
      patients: {
        ...patientTotals,
        seen: clinicTotals.encounters.patientsSeen,
        returning: clinicTotals.encounters.returningPatients,
        /** Share of patients seen who had been seen before the range. */
        returningRate: rate(clinicTotals.encounters.returningPatients, clinicTotals.encounters.patientsSeen),
      },
      clinic: clinicTotals,
      laboratory: labTotals,
      dental,
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
}
