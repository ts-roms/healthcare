import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, timelineFacility, timelineInstant, timelineRange, type TimelineWindow, filedAsPatient } from "@healthcare/core";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { type ChartTooth, DentalChartService } from "./chart/dental-chart.service";
import {
  dentalExamination,
  dentalImage,
  dentalPerioChart,
  dentalPerioSite,
  dentalPerioTooth,
  dentalProcedure,
  dentalProcedureType,
  dentalTreatmentPlan,
  dentalTreatmentPlanItem,
  PERIO_SITES,
} from "./dental.schema";

/**
 * A patient's whole dental record for a record export (FHIR, apps/api): every examination, procedure, treatment plan
 * and periodontal chart (including those entered in error, flagged), the current derived chart with each tooth's
 * encounter and dentist, and the image descriptions by document. Not audited here: the caller audits the access it
 * serves. Unlike the dental record screen, nothing is limited to the newest rows.
 */
@Injectable()
export class DentalRecordQueries {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly chart: DentalChartService,
  ) {}

  async patientRecord(organizationId: string, patientId: string) {
    const byPatient = (t: typeof dentalExamination | typeof dentalProcedure | typeof dentalTreatmentPlan | typeof dentalPerioChart) =>
      and(eq(t.organizationId, organizationId), filedAsPatient(t.patientId, patientId));
    const [examinations, procedureRows, plans, perioCharts, chart] = await Promise.all([
      this.db.select().from(dentalExamination).where(byPatient(dentalExamination)).orderBy(asc(dentalExamination.recordedAt)),
      this.db
        .select({ procedure: dentalProcedure, code: dentalProcedureType.code, name: dentalProcedureType.name, planId: dentalTreatmentPlanItem.planId })
        .from(dentalProcedure)
        .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
        .leftJoin(dentalTreatmentPlanItem, eq(dentalTreatmentPlanItem.id, dentalProcedure.planItemId))
        .where(byPatient(dentalProcedure))
        .orderBy(asc(dentalProcedure.performedAt)),
      this.db.select().from(dentalTreatmentPlan).where(byPatient(dentalTreatmentPlan)).orderBy(asc(dentalTreatmentPlan.createdAt)),
      this.db.select().from(dentalPerioChart).where(byPatient(dentalPerioChart)).orderBy(asc(dentalPerioChart.recordedAt)),
      this.chart.chart(organizationId, patientId),
    ]);

    const planIds = plans.map((p) => p.id);
    const items = planIds.length
      ? await this.db
          .select({ item: dentalTreatmentPlanItem, code: dentalProcedureType.code, name: dentalProcedureType.name })
          .from(dentalTreatmentPlanItem)
          .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalTreatmentPlanItem.procedureTypeId))
          .where(and(eq(dentalTreatmentPlanItem.organizationId, organizationId), inArray(dentalTreatmentPlanItem.planId, planIds)))
          .orderBy(asc(dentalTreatmentPlanItem.phase), asc(dentalTreatmentPlanItem.createdAt), asc(dentalTreatmentPlanItem.id))
      : [];

    const procedures = procedureRows.map((r) => ({
      id: r.procedure.id,
      facilityId: r.procedure.facilityId,
      encounterId: r.procedure.encounterId,
      practitionerId: r.procedure.practitionerId,
      code: r.code,
      name: r.name,
      tooth: r.procedure.tooth,
      surfaces: r.procedure.surfaces,
      notes: r.procedure.notes,
      planId: r.planId,
      status: r.procedure.status,
      performedAt: r.procedure.performedAt,
      enteredInErrorAt: r.procedure.enteredInErrorAt,
    }));

    // Each tooth of the current chart comes from a recorded examination or procedure (listed above).
    const sources = new Map<string, { encounterId: string; practitionerId: string }>([
      ...examinations.map((e) => [e.id, e] as const),
      ...procedures.map((p) => [p.id, p] as const),
    ]);
    const currentChart = chart.flatMap((t: ChartTooth) => {
      const source = sources.get(t.source.id);
      return source
        ? [
            {
              id: t.stateId,
              tooth: t.tooth,
              findings: t.findings,
              note: t.note,
              source: t.source,
              encounterId: source.encounterId,
              practitionerId: source.practitionerId,
              recordedAt: t.recordedAt,
            },
          ]
        : [];
    });

    return {
      examinations: examinations.map((e) => ({
        id: e.id,
        facilityId: e.facilityId,
        encounterId: e.encounterId,
        practitionerId: e.practitionerId,
        oralHygiene: e.oralHygiene,
        notes: e.notes,
        status: e.status,
        recordedAt: e.recordedAt,
        enteredInErrorAt: e.enteredInErrorAt,
      })),
      procedures,
      plans: plans.map((p) => ({
        id: p.id,
        practitionerId: p.practitionerId,
        title: p.title,
        notes: p.notes,
        status: p.status,
        decisionNote: p.decisionNote,
        decidedAt: p.decidedAt,
        discontinuedReason: p.discontinuedReason,
        createdAt: p.createdAt,
        items: items
          .filter((i) => i.item.planId === p.id)
          .map((i) => ({
            id: i.item.id,
            phase: i.item.phase,
            code: i.code,
            name: i.name,
            tooth: i.item.tooth,
            surfaces: i.item.surfaces,
            note: i.item.note,
            status: i.item.status,
            procedureId: i.item.procedureId,
          })),
      })),
      chart: currentChart,
      perioCharts: await this.perioCharts(perioCharts),
    };
  }

  // ---- Patient 360 workspace (composed in apps/api) ------------------------------------------------------------

  /**
   * The patient's latest radiographs and photos (entered-in-error ones left out), newest first: kind, date taken and
   * teeth — no notes. Opening one goes through the dental imaging link (signed, audited). Not audited here.
   */
  workspaceImages(organizationId: string, patientId: string, limit: number) {
    return this.db
      .select({
        id: dentalImage.id,
        patientId: dentalImage.patientId,
        facilityId: dentalImage.facilityId,
        documentId: dentalImage.documentId,
        kind: dentalImage.kind,
        takenOn: dentalImage.takenOn,
        teeth: dentalImage.teeth,
      })
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), filedAsPatient(dentalImage.patientId, patientId), ne(dentalImage.status, "entered_in_error")))
      .orderBy(desc(dentalImage.takenOn), desc(dentalImage.recordedAt), desc(dentalImage.id))
      .limit(limit);
  }

  // ---- Patient timeline (composed in apps/api): ids, times, statuses, codes and names only — no notes -------------

  /** Dental examinations when recorded (entered-in-error ones included, with their status). Not audited here. */
  timelineExaminations(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = dentalExamination.recordedAt;
    return this.db
      .select({
        id: dentalExamination.id,
        patientId: dentalExamination.patientId,
        at: timelineInstant(at),
        facilityId: dentalExamination.facilityId,
        encounterId: dentalExamination.encounterId,
        status: dentalExamination.status,
      })
      .from(dentalExamination)
      .where(
        and(
          eq(dentalExamination.organizationId, organizationId),
          filedAsPatient(dentalExamination.patientId, patientId),
          timelineFacility(dentalExamination.facilityId, window),
          timelineRange("dental_exam", at, dentalExamination.id, window),
        ),
      )
      .orderBy(desc(at), desc(dentalExamination.id))
      .limit(window.limit);
  }

  /** Dental procedures when performed, with the procedure's code and name (entered-in-error ones included). Not audited here. */
  timelineProcedures(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = dentalProcedure.performedAt;
    return this.db
      .select({
        id: dentalProcedure.id,
        patientId: dentalProcedure.patientId,
        at: timelineInstant(at),
        facilityId: dentalProcedure.facilityId,
        encounterId: dentalProcedure.encounterId,
        code: dentalProcedureType.code,
        name: dentalProcedureType.name,
        status: dentalProcedure.status,
      })
      .from(dentalProcedure)
      .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
      .where(
        and(
          eq(dentalProcedure.organizationId, organizationId),
          filedAsPatient(dentalProcedure.patientId, patientId),
          timelineFacility(dentalProcedure.facilityId, window),
          timelineRange("dental_procedure", at, dentalProcedure.id, window),
        ),
      )
      .orderBy(desc(at), desc(dentalProcedure.id))
      .limit(window.limit);
  }

  /** Treatment plans when the patient's decision was recorded, with the title and current status (no notes). Not audited here. */
  timelinePlanDecisions(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = dentalTreatmentPlan.decidedAt;
    return this.db
      .select({
        id: dentalTreatmentPlan.id,
        patientId: dentalTreatmentPlan.patientId,
        at: timelineInstant(at),
        facilityId: dentalTreatmentPlan.facilityId,
        title: dentalTreatmentPlan.title,
        status: dentalTreatmentPlan.status,
      })
      .from(dentalTreatmentPlan)
      .where(
        and(
          eq(dentalTreatmentPlan.organizationId, organizationId),
          filedAsPatient(dentalTreatmentPlan.patientId, patientId),
          isNotNull(at),
          timelineFacility(dentalTreatmentPlan.facilityId, window),
          timelineRange("dental_plan", at, dentalTreatmentPlan.id, window),
        ),
      )
      .orderBy(desc(at), desc(dentalTreatmentPlan.id))
      .limit(window.limit);
  }

  /** The descriptions of the patient's dental images (one per document), including those entered in error. */
  async images(organizationId: string, patientId: string) {
    const rows = await this.db
      .select()
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), filedAsPatient(dentalImage.patientId, patientId)))
      .orderBy(asc(dentalImage.recordedAt));
    return rows.map((i) => ({
      id: i.id,
      documentId: i.documentId,
      kind: i.kind,
      teeth: i.teeth,
      takenOn: i.takenOn,
      encounterId: i.encounterId,
      status: i.status,
      recordedAt: i.recordedAt,
      enteredInErrorAt: i.enteredInErrorAt,
    }));
  }

  private async perioCharts(charts: Array<typeof dentalPerioChart.$inferSelect>) {
    const teeth = charts.length
      ? await this.db
          .select()
          .from(dentalPerioTooth)
          .where(
            inArray(
              dentalPerioTooth.chartId,
              charts.map((c) => c.id),
            ),
          )
          .orderBy(asc(dentalPerioTooth.tooth))
      : [];
    const sites = teeth.length
      ? await this.db
          .select()
          .from(dentalPerioSite)
          .where(
            inArray(
              dentalPerioSite.toothId,
              teeth.map((t) => t.id),
            ),
          )
      : [];
    return charts.map((c) => ({
      id: c.id,
      facilityId: c.facilityId,
      encounterId: c.encounterId,
      practitionerId: c.practitionerId,
      notes: c.notes,
      status: c.status,
      recordedAt: c.recordedAt,
      enteredInErrorAt: c.enteredInErrorAt,
      teeth: teeth
        .filter((t) => t.chartId === c.id)
        .map((t) => ({
          id: t.id,
          tooth: t.tooth,
          mobility: t.mobility,
          furcation: t.furcation,
          sites: sites
            .filter((s) => s.toothId === t.id)
            .sort((a, b) => PERIO_SITES.indexOf(a.site) - PERIO_SITES.indexOf(b.site))
            .map((s) => ({
              site: s.site,
              probingDepth: s.probingDepth,
              gingivalMargin: s.gingivalMargin,
              bleeding: s.bleeding,
              suppuration: s.suppuration,
              plaque: s.plaque,
            })),
        })),
    }));
  }
}
