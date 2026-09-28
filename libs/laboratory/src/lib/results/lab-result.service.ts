import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  ForbiddenError,
  localDate,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { canSeeUnreleased, LabReadModel, type ResultView } from "../lab-read-model";
import type { communicateCriticalSchema, ResultValueInput } from "../laboratory.dto";
import {
  ageInDays,
  analyteKey,
  canTransition,
  exceedsDecimalPlaces,
  type Interpretation,
  interpretCoded,
  interpretNumeric,
  itemStatusForResult,
  selectReferenceRange,
  signOffDecision,
} from "../laboratory.rules";
import {
  labCriticalAlert,
  type LabCriticalAlertRecord,
  labOrder,
  labOrderItem,
  type LabOrderItemRecord,
  type LabOrderRecord,
  labReferenceRange,
  labResult,
  labResultAttachment,
  type LabResultRecord,
  type LabTestRecord,
  labSpecimen,
  labTest,
  type ResultStatus,
} from "../laboratory.schema";
import { found, publicView } from "../laboratory-support";
import { LabCatalogService } from "../catalog/lab-catalog.service";
import { LabOrderService } from "../orders/lab-order.service";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";

export interface TrendPoint {
  resultId: string;
  collectedAt: Date | null;
  releasedAt: Date | null;
  testCode: string;
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: LabResultRecord["flag"];
  critical: boolean;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  corrected: boolean;
}

/**
 * Laboratory results. Values are immutable once entered (database trigger);
 * the lifecycle is entered → verified → approved → released. A correction is
 * a new version that supersedes the previous one and goes through the same
 * sign-offs; the superseded version stays readable. Flags compare against the
 * reference range snapshotted at entry — decision support, not a diagnosis.
 */
@Injectable()
export class LabResultService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly readModel: LabReadModel,
    private readonly catalog: LabCatalogService,
    private readonly orders: LabOrderService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** First result for a received specimen's test. */
  async enter(actor: Actor, itemId: string, input: ResultValueInput): Promise<ResultView> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const { item, order } = await this.lockItem(tx, actor.organizationId, itemId);
      if (order.facilityId !== facilityId) throw new BusinessRuleError("This test belongs to another facility's laboratory", "wrong_facility");
      if (item.status === "resulted" || item.status === "released") {
        throw new ConflictError("This test already has a result; enter a correction instead", undefined, "result_exists");
      }
      if (item.status !== "received") throw new BusinessRuleError("Results are entered once the specimen has been received", "specimen_not_received");
      const [previous] = await tx.select().from(labResult).where(eq(labResult.orderItemId, itemId)).orderBy(desc(labResult.versionNumber)).limit(1);
      const created = await this.insertVersion(tx, actor, item, order, input, {
        previous: previous ?? null,
        // Re-testing after a cancelled result links to it, so the history reads in order.
        reason: previous ? `Re-tested after cancellation: ${previous.cancellationReason ?? "cancelled"}` : null,
      });
      await this.setItemStatus(tx, item.id, "resulted");
      await this.audit.record(tx, actor, {
        action: "lab.result.enter",
        resourceType: "lab_result",
        resourceId: created.id,
        patientId: created.patientId,
        metadata: { orderId: order.id, itemId, testCode: item.testCode, version: created.versionNumber, flag: created.flag, critical: created.critical },
      });
      await this.events.record(tx, resultEvent("LaboratoryResultEntered", created));
      return this.view(tx, actor, created);
    });
  }

  async verify(actor: Actor, resultId: string): Promise<ResultView> {
    return this.signOff(actor, resultId, "verify");
  }

  async approve(actor: Actor, resultId: string): Promise<ResultView> {
    return this.signOff(actor, resultId, "approve");
  }

  async release(actor: Actor, resultId: string): Promise<ResultView> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const current = await this.lockResult(tx, actor.organizationId, resultId);
      this.assertFacility(current, facilityId);
      const released = await this.releaseLocked(tx, actor, current);
      await this.recordReportReleased(tx, released.orderId);
      return this.view(tx, actor, released);
    });
  }

  /** Releases every approved result of an order at once. */
  async releaseOrder(actor: Actor, orderId: string): Promise<ResultView[]> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(labResult)
        .where(and(eq(labResult.organizationId, actor.organizationId), eq(labResult.orderId, orderId), eq(labResult.status, "approved")))
        .orderBy(asc(labResult.enteredAt))
        .for("update");
      if (rows.length === 0) throw new BusinessRuleError("No approved results are waiting for release on this order", "nothing_to_release");
      const released: LabResultRecord[] = [];
      for (const row of rows) {
        this.assertFacility(row, facilityId);
        released.push(await this.releaseLocked(tx, actor, row));
      }
      await this.recordReportReleased(tx, orderId);
      return this.readModel.results(tx, actor, released);
    });
  }

  /**
   * Corrects a result by adding a new version. The previous version is marked
   * superseded (never overwritten) and stays in the history; the new version
   * is verified and approved again before release. Correcting a released
   * result needs lab.result.amend; on release the ordering side is told.
   */
  async correct(actor: Actor, resultId: string, input: ResultValueInput & { reason: string }): Promise<ResultView> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const current = await this.lockResult(tx, actor.organizationId, resultId);
      this.assertFacility(current, facilityId);
      if (!canTransition(current.status, "superseded")) throw new BusinessRuleError(`A ${current.status} result cannot be corrected`, "result_not_current");
      const needed = current.status === "released" ? "lab.result.amend" : "lab.result.enter";
      if (!actor.permissions.has(needed)) throw new ForbiddenError(`Correcting a ${current.status} result requires ${needed}`);
      const { item, order } = await this.lockItem(tx, actor.organizationId, current.orderItemId);
      await tx.update(labResult).set({ status: "superseded", supersededAt: new Date() }).where(eq(labResult.id, current.id));
      const created = await this.insertVersion(tx, actor, item, order, input, { previous: current, reason: input.reason });
      await this.setItemStatus(tx, item.id, "resulted");
      // A completed order is open again until the corrected version is released.
      await this.orders.refreshOrderStatus(tx, actor, order);
      await this.audit.record(tx, actor, {
        action: "lab.result.correct",
        resourceType: "lab_result",
        resourceId: created.id,
        patientId: created.patientId,
        reason: input.reason,
        metadata: { supersedes: current.id, previousStatus: current.status, version: created.versionNumber, testCode: item.testCode },
      });
      await this.events.record(tx, resultEvent("LaboratoryResultCorrectionStarted", created, { supersedes: current.id, previousStatus: current.status }));
      return this.view(tx, actor, created);
    });
  }

  /** Cancels an unreleased result (e.g. entered on the wrong test); the test can then be resulted again. */
  async cancel(actor: Actor, resultId: string, reason: string): Promise<ResultView> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const current = await this.lockResult(tx, actor.organizationId, resultId);
      this.assertFacility(current, facilityId);
      if (!canTransition(current.status, "cancelled")) {
        throw new BusinessRuleError(
          current.status === "released" ? "A released result is corrected, never cancelled" : `The result is ${current.status}`,
          "result_not_cancellable",
        );
      }
      const [row] = await tx
        .update(labResult)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.userId, cancellationReason: reason })
        .where(eq(labResult.id, resultId))
        .returning();
      const cancelled = found(row, "Laboratory result");
      await this.setItemStatus(tx, cancelled.orderItemId, "received");
      await this.audit.record(tx, actor, {
        action: "lab.result.cancel",
        resourceType: "lab_result",
        resourceId: resultId,
        patientId: cancelled.patientId,
        reason,
      });
      await this.events.record(tx, resultEvent("LaboratoryResultCancelled", cancelled));
      return this.view(tx, actor, cancelled);
    });
  }

  /** Every version of a test's result, newest first. Outside the laboratory, only versions that were released. */
  async history(actor: Actor, itemId: string): Promise<ResultView[]> {
    const [item] = await this.db
      .select()
      .from(labOrderItem)
      .where(and(eq(labOrderItem.organizationId, actor.organizationId), eq(labOrderItem.id, itemId)));
    const current = found(item, "Order item");
    const rows = await this.db
      .select()
      .from(labResult)
      .where(and(eq(labResult.orderItemId, itemId), canSeeUnreleased(actor) ? undefined : isNotNull(labResult.releasedAt)))
      .orderBy(desc(labResult.versionNumber));
    await this.audit.recordStandalone(actor, {
      action: "lab.result.history",
      resourceType: "lab_order",
      resourceId: current.orderId,
      patientId: current.patientId,
    });
    return this.readModel.results(this.db, actor, rows);
  }

  /** A patient's released results (current versions), newest first — for Patient 360 and the encounter workspace. */
  async patientResults(actor: Actor, patientId: string) {
    const rows = await this.db
      .select({
        result: labResult,
        testCode: labOrderItem.testCode,
        testName: labOrderItem.testName,
        orderNumber: labOrder.orderNumber,
        collectedAt: labSpecimen.collectedAt,
      })
      .from(labResult)
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .innerJoin(labOrder, eq(labOrder.id, labResult.orderId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
      .where(and(eq(labResult.organizationId, actor.organizationId), eq(labResult.patientId, patientId), eq(labResult.status, "released")))
      .orderBy(desc(labResult.releasedAt))
      .limit(200);
    await this.audit.recordStandalone(actor, { action: "lab.result.list", resourceType: "lab_result", patientId });
    const views = await this.readModel.results(
      this.db,
      actor,
      rows.map((r) => r.result),
    );
    return rows.map((r, index) => ({ ...views[index]!, testCode: r.testCode, testName: r.testName, orderNumber: r.orderNumber, collectedAt: r.collectedAt }));
  }

  /**
   * Released values of one analyte over time (LOINC when configured, so
   * equivalent tests line up), with the reference range each was read
   * against. A display aid for clinicians — never an automatic interpretation.
   */
  async trend(actor: Actor, patientId: string, testId: string): Promise<{ analyte: string; testName: string; unit: string | null; points: TrendPoint[] }> {
    const [test] = await this.db
      .select()
      .from(labTest)
      .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, testId)));
    const anchor = found(test, "Laboratory test");
    const equivalent = anchor.loincCode
      ? await this.db
          .select({ id: labTest.id })
          .from(labTest)
          .where(and(eq(labTest.organizationId, actor.organizationId), or(eq(labTest.id, testId), eq(labTest.loincCode, anchor.loincCode))))
      : [{ id: testId }];
    const rows = await this.db
      .select({ result: labResult, testCode: labOrderItem.testCode, collectedAt: labSpecimen.collectedAt })
      .from(labResult)
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
      .where(
        and(
          eq(labResult.organizationId, actor.organizationId),
          eq(labResult.patientId, patientId),
          eq(labResult.status, "released"),
          inArray(
            labResult.testId,
            equivalent.map((t) => t.id),
          ),
        ),
      )
      .orderBy(asc(sql`coalesce(${labSpecimen.collectedAt}, ${labResult.releasedAt})`))
      .limit(500);
    await this.audit.recordStandalone(actor, { action: "lab.result.trend", resourceType: "lab_test", resourceId: testId, patientId });
    return {
      analyte: analyteKey(anchor),
      testName: anchor.name,
      unit: anchor.unit,
      points: rows.map(({ result: r, testCode, collectedAt }) => ({
        resultId: r.id,
        collectedAt,
        releasedAt: r.releasedAt,
        testCode,
        valueNumeric: r.valueNumeric,
        valueText: r.valueText,
        valueCoded: r.valueCoded,
        unit: r.unit,
        flag: r.flag,
        critical: r.critical,
        refLow: r.refLow,
        refHigh: r.refHigh,
        refText: r.refText,
        corrected: r.versionNumber > 1,
      })),
    };
  }

  // ---- Critical results -----------------------------------------------------------------

  async criticalAlerts(actor: Actor, status: "open" | "communicated" | "acknowledged" | "unacknowledged") {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select({ alert: labCriticalAlert, result: labResult, testName: labOrderItem.testName, orderNumber: labOrder.orderNumber, order: labOrder })
      .from(labCriticalAlert)
      .innerJoin(labResult, eq(labResult.id, labCriticalAlert.resultId))
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .innerJoin(labOrder, eq(labOrder.id, labResult.orderId))
      .where(
        and(
          eq(labCriticalAlert.organizationId, actor.organizationId),
          eq(labCriticalAlert.facilityId, facilityId),
          status === "unacknowledged" ? notInArray(labCriticalAlert.status, ["acknowledged"]) : eq(labCriticalAlert.status, status),
        ),
      )
      .orderBy(asc(labCriticalAlert.raisedAt))
      .limit(200);
    const organizationId = actor.organizationId;
    const [patients, practitioners, staff] = await Promise.all([
      this.context.patientBriefs(organizationId, [...new Set(rows.map((r) => r.alert.patientId))]),
      this.context.practitionerNames(organizationId, [...new Set(rows.map((r) => r.order.orderingPractitionerId).filter((id): id is string => !!id))]),
      this.context.staffNames(organizationId, [
        ...new Set(rows.flatMap((r) => [r.alert.communicatedBy, r.alert.acknowledgedBy, r.result.verifiedBy]).filter((id): id is string => !!id)),
      ]),
    ]);
    return rows.map(({ alert, result, testName, orderNumber, order }) => ({
      ...this.alertView(alert, staff),
      orderId: order.id,
      orderNumber,
      testName,
      patient: patients.get(alert.patientId) ?? null,
      orderingPractitionerName: order.orderingPractitionerId ? (practitioners.get(order.orderingPractitionerId) ?? null) : (order.externalOrderer ?? null),
      result: this.readModel.resultView(result, staff),
    }));
  }

  /** Documents who was told about a critical result, how, and whether they read the value back. */
  async communicateCritical(actor: Actor, alertId: string, input: z.infer<typeof communicateCriticalSchema>) {
    return this.db.transaction(async (tx) => {
      const alert = await this.lockAlert(tx, actor.organizationId, alertId);
      if (alert.status !== "open") throw new ConflictError(`The critical result is already ${alert.status}`, undefined, "alert_not_open");
      const [row] = await tx
        .update(labCriticalAlert)
        .set({
          status: "communicated",
          communicatedAt: new Date(),
          communicatedBy: actor.userId,
          communicatedTo: input.communicatedTo,
          communicationMethod: input.method,
          readBackConfirmed: input.readBackConfirmed,
          communicationNote: input.note ?? null,
        })
        .where(eq(labCriticalAlert.id, alertId))
        .returning();
      const updated = found(row, "Critical result");
      await this.audit.record(tx, actor, {
        action: "lab.critical.communicate",
        resourceType: "lab_result",
        resourceId: updated.resultId,
        patientId: updated.patientId,
        metadata: { alertId, method: input.method, readBackConfirmed: input.readBackConfirmed },
      });
      await this.events.record(tx, alertEvent("CriticalResultCommunicated", updated));
      return this.alertView(updated, await this.context.staffNames(actor.organizationId, [actor.userId]));
    });
  }

  /** The ordering side confirms it has seen the critical result. */
  async acknowledgeCritical(actor: Actor, alertId: string) {
    return this.db.transaction(async (tx) => {
      const alert = await this.lockAlert(tx, actor.organizationId, alertId);
      if (alert.status === "acknowledged") throw new ConflictError("The critical result was already acknowledged", undefined, "alert_acknowledged");
      const [row] = await tx
        .update(labCriticalAlert)
        .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: actor.userId })
        .where(eq(labCriticalAlert.id, alertId))
        .returning();
      const updated = found(row, "Critical result");
      await this.audit.record(tx, actor, {
        action: "lab.critical.acknowledge",
        resourceType: "lab_result",
        resourceId: updated.resultId,
        patientId: updated.patientId,
        metadata: { alertId },
      });
      await this.events.record(tx, alertEvent("CriticalResultAcknowledged", updated, { orderId: (await this.orderIdOf(tx, updated.resultId)) ?? undefined }));
      const names = await this.context.staffNames(
        actor.organizationId,
        [updated.communicatedBy, updated.acknowledgedBy].filter((id): id is string => !!id),
      );
      return this.alertView(updated, names);
    });
  }

  // ---- internals ------------------------------------------------------------------------

  private async signOff(actor: Actor, resultId: string, kind: "verify" | "approve"): Promise<ResultView> {
    const facilityId = requireFacilityId(actor);
    const target: ResultStatus = kind === "verify" ? "verified" : "approved";
    return this.db.transaction(async (tx) => {
      const current = await this.lockResult(tx, actor.organizationId, resultId);
      this.assertFacility(current, facilityId);
      if (current.status !== (kind === "verify" ? "entered" : "verified")) {
        throw new ConflictError(`The result is ${current.status}; it cannot be ${target} now`, undefined, "invalid_result_status");
      }
      if (kind === "verify") {
        // What is verified is frozen, attachments included: an upload still in progress must finish or be removed first.
        const [pending] = await tx
          .select({ id: labResultAttachment.id })
          .from(labResultAttachment)
          .where(and(eq(labResultAttachment.resultId, current.id), eq(labResultAttachment.status, "pending")))
          .limit(1);
        if (pending) throw new BusinessRuleError("An attachment of this result is still uploading: finish or remove it before verifying", "attachment_pending");
      }
      const policy = await this.catalog.policy(tx, current.facilityId);
      const decision = signOffDecision(kind, current, actor.userId, policy);
      if (!decision.allowed) {
        throw new ForbiddenError(
          `The person who entered a result cannot also ${kind} it at this facility (separation of duties). Ask a colleague, or change the facility laboratory policy.`,
        );
      }
      const now = new Date();
      const [row] = await tx
        .update(labResult)
        .set(
          kind === "verify"
            ? { status: "verified", verifiedAt: now, verifiedBy: actor.userId, selfVerified: decision.self }
            : { status: "approved", approvedAt: now, approvedBy: actor.userId, selfApproved: decision.self },
        )
        .where(eq(labResult.id, resultId))
        .returning();
      let updated = found(row, "Laboratory result");
      await this.audit.record(tx, actor, {
        action: `lab.result.${kind}`,
        resourceType: "lab_result",
        resourceId: resultId,
        patientId: updated.patientId,
        metadata: { version: updated.versionNumber, self: decision.self, critical: updated.critical },
      });
      await this.events.record(tx, resultEvent(kind === "verify" ? "LaboratoryResultVerified" : "LaboratoryResultApproved", updated));
      if (kind === "verify" && updated.critical) {
        const [alert] = await tx
          .insert(labCriticalAlert)
          .values({ organizationId: updated.organizationId, facilityId: updated.facilityId, patientId: updated.patientId, resultId: updated.id })
          .returning();
        await this.audit.record(tx, actor, {
          action: "lab.critical.raise",
          resourceType: "lab_result",
          resourceId: resultId,
          patientId: updated.patientId,
          metadata: { alertId: alert!.id },
        });
        await this.events.record(tx, alertEvent("CriticalResultRaised", alert!, { orderId: updated.orderId }));
      }
      if (kind === "approve" && policy.releaseOnApproval) {
        updated = await this.releaseLocked(tx, actor, updated);
        await this.recordReportReleased(tx, updated.orderId);
      }
      return this.view(tx, actor, updated);
    });
  }

  /**
   * The order's report as it stands after this transaction's releases: every released result version, sorted. One
   * event per transaction (releasing a whole order is one report), used to archive the report (LabReportArchive).
   */
  private async recordReportReleased(tx: DbExecutor, orderId: string): Promise<void> {
    const [order] = await tx.select().from(labOrder).where(eq(labOrder.id, orderId));
    const current = found(order, "Laboratory order");
    const released = await tx
      .select({ id: labResult.id })
      .from(labResult)
      .where(and(eq(labResult.orderId, orderId), eq(labResult.status, "released")));
    await this.events.record(tx, {
      type: "LaboratoryReportReleased",
      organizationId: current.organizationId,
      aggregateType: "lab_order",
      aggregateId: current.id,
      facilityId: current.facilityId,
      patientId: current.patientId,
      payload: { orderId: current.id, resultIds: released.map((r) => r.id).sort() },
    });
  }

  private async releaseLocked(tx: DbExecutor, actor: Actor, current: LabResultRecord): Promise<LabResultRecord> {
    if (current.status !== "approved")
      throw new ConflictError(`The result is ${current.status}; only approved results are released`, undefined, "invalid_result_status");
    const [row] = await tx
      .update(labResult)
      .set({ status: "released", releasedAt: new Date(), releasedBy: actor.userId })
      .where(eq(labResult.id, current.id))
      .returning();
    const released = found(row, "Laboratory result");
    await this.setItemStatus(tx, released.orderItemId, itemStatusForResult("released"));
    const [order] = await tx.select().from(labOrder).where(eq(labOrder.id, released.orderId)).for("update");
    await this.orders.refreshOrderStatus(tx, actor, found(order, "Laboratory order"));
    let previousWasReleased = false;
    if (released.supersedesResultId) {
      const [previous] = await tx.select({ releasedAt: labResult.releasedAt }).from(labResult).where(eq(labResult.id, released.supersedesResultId));
      previousWasReleased = !!previous?.releasedAt;
    }
    await this.audit.record(tx, actor, {
      action: "lab.result.release",
      resourceType: "lab_result",
      resourceId: released.id,
      patientId: released.patientId,
      metadata: { version: released.versionNumber, orderId: released.orderId, correctsReleased: previousWasReleased },
    });
    await this.events.record(tx, resultEvent("LaboratoryResultReleased", released, { patientReleasable: released.patientReleasable }));
    if (previousWasReleased) {
      // A released result was corrected: the ordering provider (and patient, once the portal shows results) must be told.
      await this.events.record(tx, resultEvent("LaboratoryResultAmended", released, { supersedes: released.supersedesResultId }));
    }
    return released;
  }

  private async insertVersion(
    tx: DbExecutor,
    actor: Actor,
    item: LabOrderItemRecord,
    order: LabOrderRecord,
    input: ResultValueInput,
    options: { previous: LabResultRecord | null; reason: string | null },
  ): Promise<LabResultRecord> {
    const [test] = await tx.select().from(labTest).where(eq(labTest.id, item.testId));
    const definition = found(test, "Laboratory test");
    const value = this.validateValue(definition, input);
    const interpretation = await this.interpret(tx, actor, order, definition, value);
    const [row] = await tx
      .insert(labResult)
      .values({
        organizationId: actor.organizationId,
        facilityId: order.facilityId,
        patientId: order.patientId,
        orderId: order.id,
        orderItemId: item.id,
        testId: definition.id,
        versionNumber: (options.previous?.versionNumber ?? 0) + 1,
        supersedesResultId: options.previous?.id ?? null,
        correctionReason: options.previous ? options.reason : null,
        resultType: definition.resultType,
        ...value,
        unit: definition.resultType === "numeric" ? definition.unit : null,
        flag: interpretation.flag,
        critical: interpretation.critical,
        referenceRangeId: interpretation.range?.id ?? null,
        refLow: interpretation.range?.low ?? null,
        refHigh: interpretation.range?.high ?? null,
        refCriticalLow: interpretation.range?.criticalLow ?? null,
        refCriticalHigh: interpretation.range?.criticalHigh ?? null,
        refText: interpretation.range?.textRange ?? null,
        comment: input.comment ?? null,
        method: input.method ?? null,
        instrument: input.instrument ?? null,
        patientReleasable: definition.patientReleasable,
        enteredBy: actor.userId,
      })
      .returning();
    return found(row, "Laboratory result");
  }

  private validateValue(test: LabTestRecord, input: ResultValueInput): Pick<LabResultRecord, "valueNumeric" | "valueText" | "valueCoded"> {
    const given = [input.valueNumeric !== undefined, input.valueText !== undefined, input.valueCoded !== undefined].filter(Boolean).length;
    if (given !== 1) throw new BusinessRuleError("Give exactly one value", "invalid_result_value");
    switch (test.resultType) {
      case "numeric":
        if (input.valueNumeric === undefined) throw new BusinessRuleError(`${test.name} takes a numeric result`, "invalid_result_value");
        if (exceedsDecimalPlaces(input.valueNumeric, test.decimalPlaces)) {
          throw new BusinessRuleError(`${test.name} is reported to ${test.decimalPlaces} decimal place(s)`, "invalid_result_value");
        }
        return { valueNumeric: input.valueNumeric, valueText: null, valueCoded: null };
      case "coded":
        if (input.valueCoded === undefined || !test.codedValues.includes(input.valueCoded)) {
          throw new BusinessRuleError(`${test.name} takes one of: ${test.codedValues.join(", ")}`, "invalid_result_value");
        }
        return { valueNumeric: null, valueText: null, valueCoded: input.valueCoded };
      case "text":
        if (input.valueText === undefined) throw new BusinessRuleError(`${test.name} takes a text result`, "invalid_result_value");
        return { valueNumeric: null, valueText: input.valueText, valueCoded: null };
    }
  }

  /** Selects the range for the patient's sex and age on the facility-local date, and flags the value. */
  private async interpret(
    tx: DbExecutor,
    actor: Actor,
    order: LabOrderRecord,
    test: LabTestRecord,
    value: Pick<LabResultRecord, "valueNumeric" | "valueCoded">,
  ): Promise<Interpretation & { range: typeof labReferenceRange.$inferSelect | undefined }> {
    if (test.resultType === "coded") return { ...interpretCoded(value.valueCoded!, test.abnormalCodedValues), range: undefined };
    const ranges = await tx.select().from(labReferenceRange).where(eq(labReferenceRange.testId, test.id));
    if (ranges.length === 0) return { flag: null, critical: false, range: undefined };
    const demographics = await this.context.patientDemographics(actor.organizationId, order.patientId);
    const facility = await this.organizations.getFacility(actor.organizationId, order.facilityId);
    const now = new Date();
    const range = demographics
      ? selectReferenceRange(ranges, { sex: demographics.sex, ageDays: ageInDays(demographics.birthDate, localDate(now, facility.timezone)) }, now)
      : undefined;
    if (test.resultType === "text") return { flag: null, critical: false, range };
    return { ...interpretNumeric(value.valueNumeric!, range), range };
  }

  private async setItemStatus(tx: DbExecutor, itemId: string, status: LabOrderItemRecord["status"]): Promise<void> {
    await tx
      .update(labOrderItem)
      .set({ status, updatedAt: new Date(), version: sql`${labOrderItem.version} + 1` })
      .where(eq(labOrderItem.id, itemId));
  }

  private assertFacility(result: LabResultRecord, facilityId: string): void {
    if (result.facilityId !== facilityId) throw new BusinessRuleError("This result belongs to another facility's laboratory", "wrong_facility");
  }

  private async view(executor: DbExecutor, actor: Actor, row: LabResultRecord): Promise<ResultView> {
    const [view] = await this.readModel.results(executor, actor, [row]);
    return view!;
  }

  private async orderIdOf(executor: DbExecutor, resultId: string): Promise<string | null> {
    const [row] = await executor.select({ orderId: labResult.orderId }).from(labResult).where(eq(labResult.id, resultId));
    return row?.orderId ?? null;
  }

  private alertView(alert: LabCriticalAlertRecord, staff: Map<string, string>) {
    return {
      ...publicView(alert),
      communicatedByName: alert.communicatedBy ? (staff.get(alert.communicatedBy) ?? null) : null,
      acknowledgedByName: alert.acknowledgedBy ? (staff.get(alert.acknowledgedBy) ?? null) : null,
    };
  }

  private async lockItem(tx: DbExecutor, organizationId: string, itemId: string): Promise<{ item: LabOrderItemRecord; order: LabOrderRecord }> {
    const [item] = await tx
      .select()
      .from(labOrderItem)
      .where(and(eq(labOrderItem.organizationId, organizationId), eq(labOrderItem.id, itemId)))
      .for("update");
    const current = found(item, "Order item");
    const [order] = await tx.select().from(labOrder).where(eq(labOrder.id, current.orderId));
    const parent = found(order, "Laboratory order");
    if (parent.status === "cancelled") throw new BusinessRuleError("The order is cancelled", "order_not_active");
    if (current.status === "cancelled") throw new BusinessRuleError("The test is cancelled", "item_cancelled");
    return { item: current, order: parent };
  }

  private async lockResult(tx: DbExecutor, organizationId: string, resultId: string): Promise<LabResultRecord> {
    const [row] = await tx
      .select()
      .from(labResult)
      .where(and(eq(labResult.organizationId, organizationId), eq(labResult.id, resultId)))
      .for("update");
    return found(row, "Laboratory result");
  }

  private async lockAlert(tx: DbExecutor, organizationId: string, alertId: string): Promise<LabCriticalAlertRecord> {
    const [row] = await tx
      .select()
      .from(labCriticalAlert)
      .where(and(eq(labCriticalAlert.organizationId, organizationId), eq(labCriticalAlert.id, alertId)))
      .for("update");
    return found(row, "Critical result");
  }
}

function resultEvent(type: string, result: LabResultRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: result.organizationId,
    aggregateType: "lab_result",
    aggregateId: result.id,
    facilityId: result.facilityId,
    patientId: result.patientId,
    payload: {
      orderId: result.orderId,
      orderItemId: result.orderItemId,
      version: result.versionNumber,
      status: result.status,
      critical: result.critical,
      ...extra,
    },
  };
}

function alertEvent(type: string, alert: LabCriticalAlertRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: alert.organizationId,
    aggregateType: "lab_critical_alert",
    aggregateId: alert.id,
    facilityId: alert.facilityId,
    patientId: alert.patientId,
    payload: { resultId: alert.resultId, status: alert.status, ...extra },
  };
}
