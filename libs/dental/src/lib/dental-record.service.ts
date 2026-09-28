import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, localDate, NotFoundError, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DentalCatalogService } from "./catalog/dental-catalog.service";
import { DentalChartService } from "./chart/dental-chart.service";
import { dentalExamination, dentalProcedure } from "./dental.schema";
import { DentalImagingService } from "./imaging/dental-imaging.service";
import { DentalPlanService } from "./plans/dental-plan.service";
import { DENTAL_CONTEXT, type DentalContext } from "./ports";
import { DentalProcedureService } from "./procedures/dental-procedure.service";

/** Read models: a patient's dental record in one call, one tooth's history, and the day's dental visits. */
@Injectable()
export class DentalRecordService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly catalog: DentalCatalogService,
    private readonly chart: DentalChartService,
    private readonly plans: DentalPlanService,
    private readonly procedures: DentalProcedureService,
    private readonly imaging: DentalImagingService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  /** The chart, examinations, treatment plans, procedures and image list. Viewing is audited. */
  async record(actor: Actor, patientId: string) {
    const org = actor.organizationId;
    const patient = (await this.context.patientBriefs(org, [patientId])).get(patientId);
    if (!patient) throw new NotFoundError("Patient");
    const [notation, chart, examinations, plans, procedures, images] = await Promise.all([
      this.catalog.notation(org, actor.facilityId),
      this.chart.chart(org, patientId),
      this.chart.examinations(org, patientId),
      this.plans.forPatient(org, patientId),
      this.procedures.forPatient(org, patientId),
      this.imaging.forPatient(org, patientId),
    ]);
    const practitionerIds = [...examinations, ...plans, ...procedures].map((r) => r.practitionerId);
    const userIds = [...chart.map((t) => t.recordedBy), ...images.map((i) => i.recordedBy)];
    const [practitioners, staff] = await Promise.all([
      this.context.practitionerNames(org, [...new Set(practitionerIds)]),
      this.context.staffNames(org, [...new Set(userIds)]),
    ]);
    await this.audit.recordStandalone(actor, { action: "dental.record.view", resourceType: "patient", resourceId: patientId, patientId });
    const named = <T extends { practitionerId: string }>(r: T) => ({ ...r, practitionerName: practitioners.get(r.practitionerId) ?? null });
    return {
      patient: { id: patientId, ...patient },
      notation,
      chart: chart.map((t) => ({ ...t, recordedByName: staff.get(t.recordedBy) ?? null })),
      examinations: examinations.map(named),
      plans: plans.map(named),
      procedures: procedures.map(named),
      images: images.map((i) => ({ ...i, recordedByName: staff.get(i.recordedBy) ?? null })),
    };
  }

  async toothHistory(actor: Actor, patientId: string, tooth: string) {
    const history = await this.chart.toothHistory(actor.organizationId, patientId, tooth);
    const staff = await this.context.staffNames(actor.organizationId, [...new Set(history.map((h) => h.recordedBy))]);
    await this.audit.recordStandalone(actor, {
      action: "dental.tooth.history",
      resourceType: "patient",
      resourceId: patientId,
      patientId,
      metadata: { tooth },
    });
    return history.map((h) => ({ ...h, recordedByName: staff.get(h.recordedBy) ?? null }));
  }

  /** Dentists' encounters at the selected facility on a day, with whether each has been charted and treated. */
  async visits(actor: Actor, date?: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const day = date ?? localDate(new Date(), facility.timezone);
    const visits = await this.context.dentalVisits(actor.organizationId, facilityId, day);
    const encounterIds = visits.map((v) => v.encounterId);
    const [patients, exams, procedures] = await Promise.all([
      this.context.patientBriefs(actor.organizationId, [...new Set(visits.map((v) => v.patientId))]),
      this.countBy(dentalExamination, actor.organizationId, encounterIds),
      this.countBy(dentalProcedure, actor.organizationId, encounterIds),
    ]);
    await this.audit.recordStandalone(actor, {
      action: "dental.visits.list",
      resourceType: "encounter",
      metadata: { facilityId, date: day, count: visits.length },
    });
    return {
      date: day,
      visits: visits.map((v) => ({
        ...v,
        patient: patients.get(v.patientId) ?? null,
        examinations: exams.get(v.encounterId) ?? 0,
        procedures: procedures.get(v.encounterId) ?? 0,
      })),
    };
  }

  private async countBy(
    table: typeof dentalExamination | typeof dentalProcedure,
    organizationId: string,
    encounterIds: string[],
  ): Promise<Map<string, number>> {
    if (!encounterIds.length) return new Map();
    const rows = await this.db
      .select({ encounterId: table.encounterId, count: sql<number>`count(*)::int` })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), inArray(table.encounterId, encounterIds), eq(table.status, "recorded")))
      .groupBy(table.encounterId);
    return new Map(rows.map((r) => [r.encounterId, r.count]));
  }
}
