import { Inject, Injectable } from "@nestjs/common";
import type { PatientAuditContext } from "@healthcare/audit";
import { ConflictError, DATABASE, type Database, ForbiddenError, localDate, NotFoundError, filedAsPatient } from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  dentalImage,
  dentalImageRelease,
  type ImageKind,
  type Notation,
  type PlanItemStatus,
  type PlanStatus,
  type Surface,
  type ToothCondition,
} from "../dental.schema";
import { DentalFeeLookup, itemFee, type ListedUnitPrice } from "../plans/dental-fee-lookup";
import { DentalPlanService } from "../plans/dental-plan.service";
import { ESTIMATE_DISCLAIMER, estimatePart, estimateTotals } from "../plans/fee-estimate.rules";
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
  /**
   * With a plan estimate: the listed price (centavos) of an item awaiting the patient's decision or accepted and not
   * yet done; null for an item without a listed price or not part of the estimate. Absent without an estimate.
   */
  estimatedFee?: number | null;
  /** With a plan estimate: the high end when the item may turn out to be another procedure (its fee is a range); else null. */
  estimatedFeeHigh?: number | null;
  /** With a range: the procedures it may turn out to be (names only). */
  mayBecome?: string[];
}

/** The fee estimate on a plan, when the organization shows estimates in MyHealth (docs/domains/dental.md). */
export interface PatientPlanEstimate {
  pricedOn: string;
  awaitingDecision: number;
  accepted: number;
  remaining: number;
  /** High ends of the totals (equal to the above when no item has a range). */
  awaitingDecisionHigh: number;
  acceptedHigh: number;
  remainingHigh: number;
  unpricedItems: number;
  disclaimer: string;
  note: string | null;
}

export interface PatientDentalPlan {
  id: string;
  title: string;
  status: PlanStatus;
  /** Where the latest decision was taken: at the clinic (told to staff) or by the patient in MyHealth. */
  decidedIn: "clinic" | "myhealth" | null;
  /** The patient can accept or decline items awaiting their decision here (the organization allows it). */
  canDecide: boolean;
  /** Facility-local calendar dates (YYYY-MM-DD). */
  proposedOn: string;
  decidedOn: string | null;
  facilityName: string | null;
  dentistName: string | null;
  items: PatientDentalPlanItem[];
  /** Null unless the organization shows fee estimates in MyHealth and something on the plan is still ahead. */
  estimate: PatientPlanEstimate | null;
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

/** An image the dentist released to the patient (never notes; opened through a short-lived link). */
export interface PatientDentalImage {
  id: string;
  kind: ImageKind;
  teeth: string[];
  takenOn: string;
  sharedOn: string;
  facilityName: string | null;
}

export interface PatientDentalRecord {
  /** How teeth are numbered for this patient: the notation of the facility of their latest dental care. */
  notation: Notation;
  chart: PatientDentalTooth[];
  plans: PatientDentalPlan[];
  procedures: PatientDentalProcedure[];
  images: PatientDentalImage[];
  /** Online plan decisions: allowed or not, and the organization's text the patient confirms. */
  decisions: { enabled: boolean; acknowledgement: string | null };
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

/** Listed prices for a plan's estimate in MyHealth: by procedure type id, priced on a date, with the organization's note. */
export interface PatientEstimatePrices {
  pricedOn: string;
  /** Listed unit prices by procedure type id (per procedure or per surface). */
  byType: ReadonlyMap<string, ListedUnitPrice>;
  /** By procedure type id: the procedures it may turn out to be, with their listed prices (fee ranges). */
  alternatives?: ReadonlyMap<string, ReadonlyArray<{ code: string; name: string; fee: ListedUnitPrice | null }>>;
  note: string | null;
}

/**
 * A plan as the patient sees it: title, status, dates, who and where, each item's procedure, site and decision, and —
 * when prices are passed (the organization shows estimates) — the estimate of the work still ahead.
 */
export function toPatientPlan(
  plan: DentalTreatmentPlanRecord,
  items: readonly DentalTreatmentPlanItemRecord[],
  procedureNames: ReadonlyMap<string, string>,
  facility: Facility | undefined,
  dentistName: string | null,
  decisionsEnabled = false,
  prices?: PatientEstimatePrices,
): PatientDentalPlan {
  const timezone = facility?.timezone ?? DEFAULT_TIMEZONE;
  const open = plan.status === "proposed" || plan.status === "accepted" || plan.status === "in_progress";
  // Each item's fee as billing would charge it: per procedure or per surface, a range with procedures it may become.
  const priced = (i: DentalTreatmentPlanItemRecord) =>
    open && estimatePart(i.status) && prices
      ? itemFee({ byType: prices.byType, alternatives: prices.alternatives ?? new Map() }, i.procedureTypeId, i.surfaces.length)
      : null;
  const range = (i: DentalTreatmentPlanItemRecord) => priced(i)?.range ?? undefined;
  const fee = (i: DentalTreatmentPlanItemRecord) => {
    const f = priced(i);
    return f ? (f.range?.low ?? f.amount) : null;
  };
  const feeHigh = (i: DentalTreatmentPlanItemRecord) => {
    const r = range(i);
    return r && r.high > r.low ? r.high : null;
  };
  const withEstimate = prices !== undefined && open && items.some((i) => estimatePart(i.status));
  const totals = withEstimate ? estimateTotals(items.map((i) => ({ status: i.status, listedPrice: fee(i), highPrice: feeHigh(i) }))) : undefined;
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    decidedIn: plan.decidedAt ? (plan.decisionChannel === "portal" ? "myhealth" : "clinic") : null,
    canDecide: decisionsEnabled && open && items.some((i) => i.status === "proposed"),
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
      ...(withEstimate
        ? { estimatedFee: fee(i), estimatedFeeHigh: feeHigh(i), ...(feeHigh(i) !== null ? { mayBecome: range(i)!.alternatives.map((a) => a.name) } : {}) }
        : {}),
    })),
    estimate:
      totals && prices
        ? {
            pricedOn: prices.pricedOn,
            awaitingDecision: totals.awaitingDecision,
            accepted: totals.accepted,
            remaining: totals.remaining,
            awaitingDecisionHigh: totals.awaitingDecisionHigh,
            acceptedHigh: totals.acceptedHigh,
            remainingHigh: totals.remainingHigh,
            unpricedItems: totals.unpricedItems,
            disclaimer: ESTIMATE_DISCLAIMER,
            note: prices.note,
          }
        : null,
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
    private readonly plans: DentalPlanService,
    private readonly documents: DocumentsService,
    private readonly fees: DentalFeeLookup,
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
          WHERE ${dentalTreatmentPlan.organizationId} = ${organizationId} AND ${filedAsPatient(dentalTreatmentPlan.patientId, patientId)}
        ) OR EXISTS (
          SELECT 1 FROM ${dentalToothState}
          LEFT JOIN ${dentalExamination} ON ${dentalExamination.id} = ${dentalToothState.examinationId}
          LEFT JOIN ${dentalProcedure} ON ${dentalProcedure.id} = ${dentalToothState.procedureId}
          WHERE ${dentalToothState.organizationId} = ${organizationId} AND ${filedAsPatient(dentalToothState.patientId, patientId)} AND ${recordedSource}
        ) OR EXISTS (
          SELECT 1 FROM ${dentalProcedure}
          WHERE ${dentalProcedure.organizationId} = ${organizationId} AND ${filedAsPatient(dentalProcedure.patientId, patientId)} AND ${dentalProcedure.status} = 'recorded'
        ) OR EXISTS (
          SELECT 1 FROM ${dentalImageRelease}
          JOIN ${dentalImage} ON ${dentalImage.id} = ${dentalImageRelease.imageId}
          WHERE ${dentalImage.organizationId} = ${organizationId} AND ${filedAsPatient(dentalImage.patientId, patientId)}
            AND ${dentalImage.status} = 'recorded' AND ${dentalImageRelease.withdrawnAt} IS NULL
        ) AS available`,
      )
      .then((r) => r.rows);
    return row?.available === true;
  }

  /** The patient's plans, procedures and chart; undefined while the organization does not share dental records. */
  async record(organizationId: string, patientId: string): Promise<PatientDentalRecord | undefined> {
    if (!(await this.settings.enabled(organizationId))) return undefined;
    const [plans, procedures, chart, latestExamination, facilityRows, decisions, images, estimates] = await Promise.all([
      this.db
        .select()
        .from(dentalTreatmentPlan)
        .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), filedAsPatient(dentalTreatmentPlan.patientId, patientId)))
        .orderBy(desc(dentalTreatmentPlan.createdAt)),
      this.db
        .select()
        .from(dentalProcedure)
        .where(
          and(eq(dentalProcedure.organizationId, organizationId), filedAsPatient(dentalProcedure.patientId, patientId), eq(dentalProcedure.status, "recorded")),
        )
        .orderBy(desc(dentalProcedure.performedAt))
        .limit(200),
      this.chart.chart(organizationId, patientId),
      this.db
        .select({ facilityId: dentalExamination.facilityId, at: dentalExamination.recordedAt })
        .from(dentalExamination)
        .where(
          and(
            eq(dentalExamination.organizationId, organizationId),
            filedAsPatient(dentalExamination.patientId, patientId),
            eq(dentalExamination.status, "recorded"),
          ),
        )
        .orderBy(desc(dentalExamination.recordedAt))
        .limit(1),
      this.organizations.listFacilities(organizationId),
      this.settings.decisions(organizationId),
      this.releasedImages(organizationId, patientId),
      this.settings.estimates(organizationId),
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
    const prices = estimates.inPortal ? await this.estimatePrices(organizationId, plans, items, facilities, estimates.note) : undefined;

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
          decisions !== undefined,
          prices?.get(p.facilityId),
        ),
      ),
      procedures: procedures.flatMap(
        (p) =>
          toPatientProcedure(p, names.get(p.procedureTypeId) ?? "Dental procedure", facilities.get(p.facilityId), dentists.get(p.practitionerId) ?? null) ?? [],
      ),
      images: images.map(({ image, release }) => {
        const facility = facilities.get(image.facilityId);
        return {
          id: image.id,
          kind: image.kind,
          teeth: [...image.teeth],
          takenOn: image.takenOn,
          sharedOn: localDate(release.releasedAt, facility?.timezone ?? DEFAULT_TIMEZONE),
          facilityName: facility?.name ?? null,
        };
      }),
      decisions: { enabled: decisions !== undefined, acknowledgement: decisions?.acknowledgement ?? null },
    };
  }

  /**
   * For notices: whether this release of an image is still shared with the patient (records shown, release not
   * withdrawn, image not entered in error). Checked when the notice is sent, not when the image was shared.
   */
  async releaseStillShared(organizationId: string, patientId: string, releaseId: string): Promise<boolean> {
    if (!(await this.settings.enabled(organizationId))) return false;
    const [row] = await this.db
      .select({ id: dentalImageRelease.id })
      .from(dentalImageRelease)
      .innerJoin(dentalImage, eq(dentalImage.id, dentalImageRelease.imageId))
      .where(
        and(
          eq(dentalImageRelease.organizationId, organizationId),
          eq(dentalImageRelease.id, releaseId),
          eq(dentalImage.patientId, patientId),
          eq(dentalImage.status, "recorded"),
          isNull(dentalImageRelease.withdrawnAt),
        ),
      );
    return row !== undefined;
  }

  /**
   * For notices: whether a plan of this patient still has items awaiting their decision while dental records are
   * shown, and whether they can decide it in MyHealth; undefined when there is nothing to tell them.
   */
  async planAwaitingPatient(organizationId: string, patientId: string, planId: string): Promise<{ canDecide: boolean } | undefined> {
    if (!(await this.settings.enabled(organizationId))) return undefined;
    const [plan] = await this.db
      .select()
      .from(dentalTreatmentPlan)
      .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), eq(dentalTreatmentPlan.id, planId), eq(dentalTreatmentPlan.patientId, patientId)));
    if (!plan || !["proposed", "accepted", "in_progress"].includes(plan.status)) return undefined;
    const items = await this.db
      .select({ status: dentalTreatmentPlanItem.status })
      .from(dentalTreatmentPlanItem)
      .where(and(eq(dentalTreatmentPlanItem.organizationId, organizationId), eq(dentalTreatmentPlanItem.planId, planId)));
    if (!items.some((i) => i.status === "proposed")) return undefined;
    return { canDecide: (await this.settings.decisions(organizationId)) !== undefined };
  }

  /**
   * A short-lived link to an image the dentist released to this patient (while dental records are shared, not
   * entered in error). Audited as the patient's access by the documents service.
   */
  async imageLink(context: PatientAuditContext, imageId: string) {
    if (!(await this.settings.enabled(context.organizationId))) throw new ForbiddenError("Your clinic does not share dental records in MyHealth");
    const released = (await this.releasedImages(context.organizationId, context.patientId)).find((r) => r.image.id === imageId);
    if (!released) throw new NotFoundError("Image");
    return this.documents.downloadUrlForPatient(context, released.image.documentId);
  }

  /**
   * The patient accepts the listed items awaiting their decision and declines the others, after confirming the
   * organization's acknowledgement (kept as the decision note). Only while the organization allows online decisions.
   */
  async decidePlan(
    context: PatientAuditContext,
    planId: string,
    input: { acceptedItemIds: string[]; awaitingItemIds: string[]; estimateAwaitingDecision?: number | null; estimateAwaitingDecisionHigh?: number | null },
  ) {
    const decisions = await this.settings.decisions(context.organizationId);
    if (!decisions) throw new ForbiddenError("Your clinic takes treatment plan decisions in person");
    // With estimates shown, the patient decides on the estimate they saw: if the listed prices changed since, they look again.
    const before = await this.record(context.organizationId, context.patientId);
    const shown = before?.plans.find((p) => p.id === planId)?.estimate;
    // A range is checked at both ends (a client that sends only the low end is taken to have seen a single price).
    if (
      shown &&
      (shown.awaitingDecision !== input.estimateAwaitingDecision ||
        shown.awaitingDecisionHigh !== (input.estimateAwaitingDecisionHigh ?? input.estimateAwaitingDecision))
    ) {
      throw new ConflictError("The fee estimate for this plan changed since you opened it. Please review it again.", undefined, "estimate_changed");
    }
    const { acceptedItemIds, awaitingItemIds } = input;
    await this.db.transaction((tx) =>
      this.plans.decideByPatient(tx, context, planId, { acceptedItemIds, awaitingItemIds, acknowledgement: decisions.acknowledgement }),
    );
    const record = await this.record(context.organizationId, context.patientId);
    return found(record?.plans.find((p) => p.id === planId));
  }

  /** Today's listed prices for the open plans' items, per facility (each priced on its own local date). */
  private async estimatePrices(
    organizationId: string,
    plans: readonly DentalTreatmentPlanRecord[],
    items: readonly DentalTreatmentPlanItemRecord[],
    facilities: ReadonlyMap<string, Facility>,
    note: string | null,
  ): Promise<Map<string, PatientEstimatePrices>> {
    const byFacility = new Map<string, Set<string>>();
    for (const item of items) {
      const plan = plans.find((p) => p.id === item.planId);
      if (!plan || !estimatePart(item.status)) continue;
      byFacility.set(plan.facilityId, (byFacility.get(plan.facilityId) ?? new Set()).add(item.procedureTypeId));
    }
    const result = new Map<string, PatientEstimatePrices>();
    for (const [facilityId, typeIds] of byFacility) {
      const pricedOn = localDate(new Date(), facilities.get(facilityId)?.timezone ?? DEFAULT_TIMEZONE);
      const priced = await this.fees.price(organizationId, [...typeIds], pricedOn);
      result.set(facilityId, { pricedOn, byType: priced.byType, alternatives: priced.alternatives, note });
    }
    return result;
  }

  private releasedImages(organizationId: string, patientId: string) {
    return this.db
      .select({ image: dentalImage, release: dentalImageRelease })
      .from(dentalImageRelease)
      .innerJoin(dentalImage, eq(dentalImage.id, dentalImageRelease.imageId))
      .where(
        and(
          eq(dentalImage.organizationId, organizationId),
          filedAsPatient(dentalImage.patientId, patientId),
          eq(dentalImage.status, "recorded"),
          isNull(dentalImageRelease.withdrawnAt),
        ),
      )
      .orderBy(desc(dentalImage.takenOn), desc(dentalImage.recordedAt));
  }
}

function found<T>(value: T | undefined): T {
  if (value === undefined) throw new NotFoundError("Treatment plan");
  return value;
}
