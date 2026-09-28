import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { type ChartTooth, DentalChartService } from "../chart/dental-chart.service";
import {
  dentalExamination,
  dentalProcedure,
  type DentalProcedureRecord,
  dentalToothState,
  dentalTreatmentPlan,
  dentalTreatmentPlanItem,
  type DentalTreatmentPlanItemRecord,
  type DentalTreatmentPlanRecord,
  type Notation,
  type PlanItemStatus,
  type PlanStatus,
  type Surface,
  type ToothCondition,
} from "../dental.schema";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";
import { DentalPortalSettings } from "./dental-portal-settings.service";

/**
 * What a patient sees of their dental record in MyHealth, and nothing more. These shapes are the whole patient-facing
 * contract: examination notes, periodontal measurements, clinical remarks (plan, item and tooth notes, decision notes,
 * reasons), images, procedure codes, staff users and anything entered in error are never part of them.
 */

/** The patient's decision on a plan item: awaiting it, accepted (also once done), declined; null for a cancelled item. */
export type PatientPlanItemDecision = "awaiting" | "accepted" | "declined" | null;

export interface PatientDentalPlanItem {
  id: string;
  phase: number;
  /** FDI code (displayed in the record's notation); null for a whole-mouth procedure. */
  tooth: string | null;
  surfaces: Surface[];
  procedureName: string;
  status: PlanItemStatus;
  decision: PatientPlanItemDecision;
}

export interface PatientDentalPlan {
  id: string;
  title: string;
  status: PlanStatus;
  /** Facility-local calendar dates (YYYY-MM-DD). */
  proposedOn: string;
  decidedOn: string | null;
  facilityName: string | null;
  dentistName: string | null;
  items: PatientDentalPlanItem[];
}

export interface PatientDentalProcedure {
  id: string;
  performedOn: string;
  tooth: string | null;
  surfaces: Surface[];
  procedureName: string;
  facilityName: string | null;
  dentistName: string | null;
}

export interface PatientDentalTooth {
  tooth: string;
  /** Empty: charted with no findings (sound). */
  conditions: Array<{ condition: ToothCondition; surfaces: Surface[] }>;
  updatedOn: string;
}

export interface PatientDentalRecord {
  /** How teeth are numbered for this patient: the notation of the facility of their latest dental care. */
  notation: Notation;
  chart: PatientDentalTooth[];
  plans: PatientDentalPlan[];
  procedures: PatientDentalProcedure[];
}

interface Facility {
  name: string;
  timezone: string;
}
const DEFAULT_TIMEZONE = "Asia/Manila";

export function planItemDecision(status: PlanItemStatus): PatientPlanItemDecision {
  switch (status) {
    case "proposed":
      return "awaiting";
    case "accepted":
    case "completed":
      return "accepted";
    case "declined":
      return "declined";
    case "cancelled":
      return null;
  }
}

/** A plan as the patient sees it: title, status, dates, who and where, and each item's procedure, site and decision. */
export function toPatientPlan(
  plan: DentalTreatmentPlanRecord,
  items: readonly DentalTreatmentPlanItemRecord[],
  procedureNames: ReadonlyMap<string, string>,
  facility: Facility | undefined,
  dentistName: string | null,
): PatientDentalPlan {
  const timezone = facility?.timezone ?? DEFAULT_TIMEZONE;
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    proposedOn: localDate(plan.createdAt, timezone),
    decidedOn: plan.decidedAt ? localDate(plan.decidedAt, timezone) : null,
    facilityName: facility?.name ?? null,
    dentistName,
    items: items.map((i) => ({
      id: i.id,
      phase: i.phase,
      tooth: i.tooth,
      surfaces: [...i.surfaces],
      procedureName: procedureNames.get(i.procedureTypeId) ?? "Dental procedure",
      status: i.status,
      decision: planItemDecision(i.status),
    })),
  };
}

/** A performed procedure as the patient sees it; undefined for one entered in error (never shown). */
export function toPatientProcedure(
  procedure: DentalProcedureRecord,
  procedureName: string,
  facility: Facility | undefined,
  dentistName: string | null,
): PatientDentalProcedure | undefined {
  if (procedure.status !== "recorded") return undefined;
  return {
    id: procedure.id,
    performedOn: localDate(procedure.performedAt, facility?.timezone ?? DEFAULT_TIMEZONE),
    tooth: procedure.tooth,
    surfaces: [...procedure.surfaces],
    procedureName,
    facilityName: facility?.name ?? null,
    dentistName,
  };
}

/** The current chart (already without entered-in-error sources) without its notes, sources or authors. */
export function toPatientChart(chart: readonly ChartTooth[], timezone = DEFAULT_TIMEZONE): PatientDentalTooth[] {
  return chart.map((t) => ({
    tooth: t.tooth,
    conditions: t.findings.map((f) => ({ condition: f.condition, surfaces: [...f.surfaces] })),
    updatedOn: localDate(t.recordedAt, timezone),
  }));
}

/**
 * Dental records a patient may see in MyHealth (CLAUDE.md §17): only when the organization turned MyHealth dental
 * records on (`DentalPortalSettings`), and then only treatment plans, recorded procedures and the current chart.
 * Not audited here: the portal endpoints audit the patient's access.
 */
@Injectable()
export class DentalPatientAccess {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: DentalPortalSettings,
    private readonly catalog: DentalCatalogService,
    private readonly chart: DentalChartService,
    private readonly organizations: OrganizationService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  enabled(organizationId: string): Promise<boolean> {
    return this.settings.enabled(organizationId);
  }

  /** Whether MyHealth should offer a dental section: records are shared and there is something to show. */
  async available(organizationId: string, patientId: string): Promise<boolean> {
    if (!(await this.settings.enabled(organizationId))) return false;
    const recordedSource = sql`coalesce(${dentalExamination.status}, ${dentalProcedure.status}) = 'recorded'`;
    const [row] = await this.db
      .execute<{ available: boolean }>(
        sql`
      SELECT EXISTS (
          SELECT 1 FROM ${dentalTreatmentPlan}
          WHERE ${dentalTreatmentPlan.organizationId} = ${organizationId} AND ${dentalTreatmentPlan.patientId} = ${patientId}
        ) OR EXISTS (
          SELECT 1 FROM ${dentalToothState}
          LEFT JOIN ${dentalExamination} ON ${dentalExamination.id} = ${dentalToothState.examinationId}
          LEFT JOIN ${dentalProcedure} ON ${dentalProcedure.id} = ${dentalToothState.procedureId}
          WHERE ${dentalToothState.organizationId} = ${organizationId} AND ${dentalToothState.patientId} = ${patientId} AND ${recordedSource}
        ) OR EXISTS (
          SELECT 1 FROM ${dentalProcedure}
          WHERE ${dentalProcedure.organizationId} = ${organizationId} AND ${dentalProcedure.patientId} = ${patientId} AND ${dentalProcedure.status} = 'recorded'
        ) AS available`,
      )
      .then((r) => r.rows);
    return row?.available === true;
  }

  /** The patient's plans, procedures and chart; undefined while the organization does not share dental records. */
  async record(organizationId: string, patientId: string): Promise<PatientDentalRecord | undefined> {
    if (!(await this.settings.enabled(organizationId))) return undefined;
    const [plans, procedures, chart, latestExamination, facilityRows] = await Promise.all([
      this.db
        .select()
        .from(dentalTreatmentPlan)
        .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), eq(dentalTreatmentPlan.patientId, patientId)))
        .orderBy(desc(dentalTreatmentPlan.createdAt)),
      this.db
        .select()
        .from(dentalProcedure)
        .where(and(eq(dentalProcedure.organizationId, organizationId), eq(dentalProcedure.patientId, patientId), eq(dentalProcedure.status, "recorded")))
        .orderBy(desc(dentalProcedure.performedAt))
        .limit(200),
      this.chart.chart(organizationId, patientId),
      this.db
        .select({ facilityId: dentalExamination.facilityId, at: dentalExamination.recordedAt })
        .from(dentalExamination)
        .where(and(eq(dentalExamination.organizationId, organizationId), eq(dentalExamination.patientId, patientId), eq(dentalExamination.status, "recorded")))
        .orderBy(desc(dentalExamination.recordedAt))
        .limit(1),
      this.organizations.listFacilities(organizationId),
    ]);
    const items = plans.length
      ? await this.db
          .select()
          .from(dentalTreatmentPlanItem)
          .where(
            and(
              eq(dentalTreatmentPlanItem.organizationId, organizationId),
              inArray(
                dentalTreatmentPlanItem.planId,
                plans.map((p) => p.id),
              ),
            ),
          )
          .orderBy(asc(dentalTreatmentPlanItem.phase), asc(dentalTreatmentPlanItem.createdAt))
      : [];
    const [types, dentists] = await Promise.all([
      this.catalog.byIds(this.db, organizationId, [...items.map((i) => i.procedureTypeId), ...procedures.map((p) => p.procedureTypeId)]),
      this.context.practitionerNames(organizationId, [...new Set([...plans, ...procedures].map((r) => r.practitionerId))]),
    ]);
    const facilities = new Map<string, Facility>(facilityRows.map((f) => [f.id, { name: f.name, timezone: f.timezone }]));
    const names = new Map([...types].map(([id, t]) => [id, t.name]));

    // One notation for the whole record, so a tooth reads the same everywhere: that of the latest care's facility.
    const latest = [
      ...plans.map((p) => ({ facilityId: p.facilityId, at: p.createdAt })),
      ...procedures.map((p) => ({ facilityId: p.facilityId, at: p.performedAt })),
      ...latestExamination,
    ].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const notation = await this.catalog.notation(organizationId, latest?.facilityId);
    const homeTimezone = (latest && facilities.get(latest.facilityId)?.timezone) ?? DEFAULT_TIMEZONE;

    return {
      notation,
      chart: toPatientChart(chart, homeTimezone),
      plans: plans.map((p) =>
        toPatientPlan(
          p,
          items.filter((i) => i.planId === p.id),
          names,
          facilities.get(p.facilityId),
          dentists.get(p.practitionerId) ?? null,
        ),
      ),
      procedures: procedures.flatMap(
        (p) =>
          toPatientProcedure(p, names.get(p.procedureTypeId) ?? "Dental procedure", facilities.get(p.facilityId), dentists.get(p.practitionerId) ?? null) ?? [],
      ),
    };
  }
}
