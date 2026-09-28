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
  NotFoundError,
  requireFacilityId,
  systemActor,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  labOrder,
  labOrderItem,
  type LabOrderItemRecord,
  labSpecimen,
  labSpecimenEvent,
  type LabSpecimenRecord,
  labSpecimenType,
  labTest,
} from "../laboratory.schema";
import { found } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { ReferenceLabService } from "./reference-lab.service";
import type { dispatchSchema, prepareSendOutSchema, referenceRejectSchema, resultsReceivedSchema, SEND_OUT_VIEWS } from "./send-out.dto";
import {
  awaitsReferenceLab,
  canMoveSendOut,
  CURRENT_SEND_OUT_STATUSES,
  dispatchProblem,
  expectedTurnaround,
  IN_FLIGHT_SEND_OUT_STATUSES,
  manifestNumber,
  sendOutTiming,
} from "./send-out.rules";
import {
  labReferenceLaboratory,
  labSendOut,
  labSendOutDispatch,
  type LabSendOutDispatchRecord,
  labSendOutManifestSequence,
  type LabSendOutRecord,
  type SendOutStatus,
} from "./send-out.schema";

export type SendOutView = ReturnType<SendOutService["toView"]>;

/** Who performed a result: the reference laboratory of a send-out whose results came back (null: in-house). */
export interface ResultAttribution {
  sendOutId: string | null;
  referenceLaboratoryId: string;
  performingLaboratory: string;
}

/** The dispatch, its reference laboratory and the send-outs it carries (what the manifest and the exchange package show). */
export interface DispatchSource {
  dispatch: LabSendOutDispatchRecord;
  facility: { id: string; name: string; timezone: string };
  referenceLaboratory: { id: string; code: string; name: string; accreditationReference: string | null };
  specimens: Array<{
    specimenId: string;
    patientId: string;
    accessionNumber: string;
    specimenType: string;
    container: string | null;
    collectedAt: Date;
    orderId: string;
    orderNumber: string;
    priority: string;
    fastingRequired: boolean;
    clinicalIndication: string | null;
    orderingPractitionerId: string | null;
    externalOrderer: string | null;
    tests: Array<{ sendOutId: string; orderItemId: string; code: string; name: string; loincCode: string | null; status: SendOutStatus }>;
  }>;
}

/**
 * Send-out tests (referral to an external reference laboratory). A referred test follows the normal order → collection
 * → receipt path; on receipt a send-out is prepared (from the facility's referral configuration, or by hand), then
 * dispatched with a manifest (courier, reference, time), and closed when the reference laboratory's results come back
 * (with its own accession number), when it rejects the specimen, or when the laboratory cancels it. Results that come
 * back are entered as normal, versioned results attributed to the reference laboratory (LabResultService). Every change
 * is audited per patient and order; events carry ids only.
 */
@Injectable()
export class SendOutService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly referenceLabs: ReferenceLabService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- Hooks used by orders and results (same transaction) ---------------------------------

  /** On receipt: prepares a send-out for each received test the facility refers out (idempotent per open send-out). */
  async prepareReferred(tx: DbExecutor, actor: Actor, specimen: LabSpecimenRecord): Promise<number> {
    const items = await tx
      .select({ item: labOrderItem, testTurnaround: labTest.turnaroundMinutes })
      .from(labOrderItem)
      .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
      .where(and(eq(labOrderItem.specimenId, specimen.id), eq(labOrderItem.status, "received")));
    const referrals = await this.referenceLabs.referralsFor(
      tx,
      specimen.facilityId,
      items.map((i) => i.item.testId),
    );
    let prepared = 0;
    for (const { item, testTurnaround } of items) {
      const referral = referrals.get(item.testId);
      if (!referral) continue;
      const row = await this.insert(
        tx,
        actor,
        item,
        specimen.facilityId,
        referral.referenceLaboratoryId,
        expectedTurnaround(referral.turnaroundMinutes, testTurnaround),
      );
      if (row) prepared += 1;
    }
    return prepared;
  }

  /**
   * The send-out that decides who performs a test on its current specimen: the latest one in flight or answered by the
   * reference laboratory (rejected and cancelled ones do not count).
   */
  async currentForItem(
    executor: DbExecutor,
    item: { id: string; specimenId: string | null },
  ): Promise<(LabSendOutRecord & { referenceLaboratoryName: string }) | undefined> {
    if (!item.specimenId) return undefined;
    const [row] = await executor
      .select({ sendOut: labSendOut, name: labReferenceLaboratory.name })
      .from(labSendOut)
      .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labSendOut.referenceLaboratoryId))
      .where(and(eq(labSendOut.orderItemId, item.id), eq(labSendOut.specimenId, item.specimenId), inArray(labSendOut.status, [...CURRENT_SEND_OUT_STATUSES])))
      .orderBy(desc(labSendOut.preparedAt))
      .limit(1);
    return row ? { ...row.sendOut, referenceLaboratoryName: row.name } : undefined;
  }

  /**
   * Who performs a test's result now: the reference laboratory once its results came back; refuses entry while the
   * test is still with (or on its way to) a reference laboratory. Null: the facility's own laboratory.
   */
  async attributionForEntry(executor: DbExecutor, item: { id: string; specimenId: string | null }): Promise<ResultAttribution | null> {
    const current = await this.currentForItem(executor, item);
    if (!current) return null;
    if (awaitsReferenceLab(current.status)) {
      throw new BusinessRuleError(
        `This test was sent to ${current.referenceLaboratoryName}; record that its results came back before entering them (or cancel the send-out to test in-house)`,
        "awaiting_reference_laboratory",
      );
    }
    return { sendOutId: current.id, referenceLaboratoryId: current.referenceLaboratoryId, performingLaboratory: current.referenceLaboratoryName };
  }

  /** Cancels open (not yet answered) send-outs of tests that are cancelled or whose specimen is rejected. */
  async cancelOpenForItems(tx: DbExecutor, actor: Actor, itemIds: string[], reason: string): Promise<void> {
    if (itemIds.length === 0) return;
    const rows = await tx
      .select()
      .from(labSendOut)
      .where(and(inArray(labSendOut.orderItemId, itemIds), inArray(labSendOut.status, [...IN_FLIGHT_SEND_OUT_STATUSES])))
      .for("update");
    for (const row of rows) await this.close(tx, actor, row, "cancelled", { cancellationReason: reason });
  }

  // ---- Commands -----------------------------------------------------------------------------

  /** Refers received tests by hand (not configured as referred, or after a rejected / cancelled send-out). */
  async prepare(actor: Actor, input: z.infer<typeof prepareSendOutSchema>): Promise<SendOutView[]> {
    const facilityId = requireFacilityId(actor);
    const ids = await this.db.transaction(async (tx) => {
      const lab = await this.referenceLabs.activeLab(tx, actor.organizationId, input.referenceLaboratoryId);
      const itemIds = [...new Set(input.orderItemIds)];
      const rows = await tx
        .select({ item: labOrderItem, facilityId: labOrder.facilityId, orderStatus: labOrder.status, testTurnaround: labTest.turnaroundMinutes })
        .from(labOrderItem)
        .innerJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
        .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
        .where(and(eq(labOrderItem.organizationId, actor.organizationId), inArray(labOrderItem.id, itemIds)))
        .for("update", { of: labOrderItem });
      if (rows.length !== itemIds.length) throw new NotFoundError("Order item");
      if (rows.some((r) => r.facilityId !== facilityId)) throw new BusinessRuleError("These tests belong to another facility's laboratory", "wrong_facility");
      if (rows.some((r) => r.orderStatus !== "active" || r.item.status !== "received")) {
        throw new BusinessRuleError("Only tests whose specimen has been received, and that have no result yet, are sent out", "item_not_received");
      }
      const referrals = await this.referenceLabs.referralsFor(
        tx,
        facilityId,
        rows.map((r) => r.item.testId),
      );
      const created: string[] = [];
      for (const { item, testTurnaround } of rows) {
        const referral = referrals.get(item.testId);
        const turnaround = expectedTurnaround(referral?.referenceLaboratoryId === lab.id ? referral.turnaroundMinutes : null, testTurnaround);
        const row = await this.insert(tx, actor, item, facilityId, lab.id, turnaround);
        if (!row) throw new ConflictError(`${item.testName} is already being sent out`, undefined, "send_out_in_flight");
        created.push(row.id);
      }
      return created;
    });
    return this.views(actor, inArray(labSendOut.id, ids));
  }

  /** One handover to a reference laboratory: the manifest. Prepared send-outs of this facility, one reference laboratory. */
  async dispatch(actor: Actor, input: z.infer<typeof dispatchSchema>) {
    const facilityId = requireFacilityId(actor);
    const dispatchedAt = input.dispatchedAt ? new Date(input.dispatchedAt) : new Date();
    const dispatchId = await this.db.transaction(async (tx) => {
      const ids = [...new Set(input.sendOutIds)];
      const rows = await tx
        .select()
        .from(labSendOut)
        .where(and(eq(labSendOut.organizationId, actor.organizationId), inArray(labSendOut.id, ids)))
        .for("update");
      if (rows.length !== ids.length) throw new NotFoundError("Send-out");
      const problem = dispatchProblem(rows, facilityId);
      if (problem) throw new BusinessRuleError(problem.message, problem.code);
      if (rows.some((r) => r.preparedAt.getTime() > dispatchedAt.getTime() + 60_000))
        throw new BusinessRuleError("The handover cannot be before the send-out was prepared", "dispatched_before_prepared");
      const lab = await this.referenceLabs.activeLab(tx, actor.organizationId, found(rows[0], "Send-out").referenceLaboratoryId);
      const [counter] = await tx
        .insert(labSendOutManifestSequence)
        .values({ organizationId: actor.organizationId, nextValue: 1 })
        .onConflictDoUpdate({ target: labSendOutManifestSequence.organizationId, set: { nextValue: sql`${labSendOutManifestSequence.nextValue} + 1` } })
        .returning({ value: labSendOutManifestSequence.nextValue });
      if (!counter) throw new Error("Could not allocate a manifest number");
      const [row] = await tx
        .insert(labSendOutDispatch)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          referenceLaboratoryId: lab.id,
          manifestNumber: manifestNumber(counter.value),
          courier: input.courier,
          courierReference: input.courierReference ?? null,
          dispatchedAt,
          dispatchedBy: actor.userId,
        })
        .returning();
      const dispatch = found(row, "Dispatch");
      for (const sendOut of rows) {
        await this.move(tx, actor, sendOut, "dispatched", { dispatchId: dispatch.id, dispatchedAt }, { manifestNumber: dispatch.manifestNumber });
      }
      // The specimen leaves the laboratory: one "routed" event per specimen, in its append-only log.
      for (const specimenId of new Set(rows.map((r) => r.specimenId))) {
        await tx.insert(labSpecimenEvent).values({
          organizationId: actor.organizationId,
          specimenId,
          event: "routed",
          actorUserId: actor.userId,
          reason: `Sent to ${lab.name} (manifest ${dispatch.manifestNumber})`,
        });
      }
      return dispatch.id;
    });
    return this.dispatchDetail(actor, dispatchId, { audit: false });
  }

  /** The reference laboratory's results came back: record its accession number; the results can now be entered. */
  async resultsReceived(actor: Actor, sendOutId: string, input: z.infer<typeof resultsReceivedSchema>): Promise<SendOutView> {
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    await this.transition(actor, sendOutId, "results_received", (row) => {
      if (row.dispatchedAt && receivedAt.getTime() < row.dispatchedAt.getTime())
        throw new BusinessRuleError("Results cannot come back before the specimen was dispatched", "received_before_dispatch");
      return { referenceAccession: input.referenceAccession, resultsReceivedAt: receivedAt, resultsReceivedBy: actor.userId };
    });
    return this.view(actor, sendOutId);
  }

  /** The reference laboratory rejected the specimen (its reason). The test stays received: re-send, recollect or test in-house. */
  async referenceRejected(actor: Actor, sendOutId: string, input: z.infer<typeof referenceRejectSchema>): Promise<SendOutView> {
    await this.transition(actor, sendOutId, "rejected", () => ({
      rejectionReason: input.reason,
      rejectedAt: new Date(),
      rejectedBy: actor.userId,
      referenceAccession: input.referenceAccession ?? null,
    }));
    return this.view(actor, sendOutId);
  }

  async cancel(actor: Actor, sendOutId: string, reason: string): Promise<SendOutView> {
    await this.transition(actor, sendOutId, "cancelled", () => ({ cancellationReason: reason }));
    return this.view(actor, sendOutId);
  }

  /** An electronic submission of the dispatch was acknowledged by the reference laboratory (integration adapter). Idempotent. */
  async recordElectronicAcknowledgement(input: { organizationId: string; dispatchId: string; reference: string; exchangeId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(labSendOutDispatch)
        .set({ electronicReference: input.reference, electronicAcknowledgedAt: new Date() })
        .where(
          and(
            eq(labSendOutDispatch.organizationId, input.organizationId),
            eq(labSendOutDispatch.id, input.dispatchId),
            isNull(labSendOutDispatch.electronicReference),
          ),
        )
        .returning();
      if (!row) return;
      await this.audit.record(tx, systemActor(input.organizationId, row.facilityId, "reference-laboratory"), {
        action: "lab.send-out.electronic-acknowledged",
        resourceType: "lab_send_out_dispatch",
        resourceId: row.id,
        metadata: { manifestNumber: row.manifestNumber, reference: input.reference, exchangeId: input.exchangeId },
      });
    });
  }

  // ---- Queries --------------------------------------------------------------------------------

  /** The facility's send-outs: to dispatch, awaiting results (with turnaround), closed, or all. */
  async list(actor: Actor, view: (typeof SEND_OUT_VIEWS)[number]): Promise<SendOutView[]> {
    const facilityId = requireFacilityId(actor);
    const status: Record<typeof view, SQL | undefined> = {
      to_dispatch: eq(labSendOut.status, "prepared"),
      awaiting: eq(labSendOut.status, "dispatched"),
      closed: inArray(labSendOut.status, ["results_received", "rejected", "cancelled"]),
      all: undefined,
    };
    const rows = await this.views(actor, and(eq(labSendOut.facilityId, facilityId), status[view]), view === "closed" || view === "all" ? 200 : 500);
    await this.audit.recordStandalone(actor, { action: "lab.send-out.list", resourceType: "lab_send_out", metadata: { view, count: rows.length } });
    return rows;
  }

  /** Recent dispatches (manifests) of the facility. */
  async dispatches(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select({ dispatch: labSendOutDispatch, labName: labReferenceLaboratory.name, count: sql<number>`count(${labSendOut.id})::int` })
      .from(labSendOutDispatch)
      .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labSendOutDispatch.referenceLaboratoryId))
      .leftJoin(labSendOut, eq(labSendOut.dispatchId, labSendOutDispatch.id))
      .where(and(eq(labSendOutDispatch.organizationId, actor.organizationId), eq(labSendOutDispatch.facilityId, facilityId)))
      .groupBy(labSendOutDispatch.id, labReferenceLaboratory.name)
      .orderBy(desc(labSendOutDispatch.dispatchedAt))
      .limit(50);
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.dispatch.dispatchedBy))]);
    return rows.map(({ dispatch, labName, count }) => ({ ...dispatchView(dispatch, names), referenceLaboratoryName: labName, sendOuts: count }));
  }

  async dispatchDetail(actor: Actor, dispatchId: string, options: { audit: boolean } = { audit: true }) {
    const dispatch = await this.findDispatch(this.db, actor.organizationId, dispatchId);
    const [lab] = await this.db.select().from(labReferenceLaboratory).where(eq(labReferenceLaboratory.id, dispatch.referenceLaboratoryId));
    const sendOuts = await this.views(actor, eq(labSendOut.dispatchId, dispatchId));
    const names = await this.context.staffNames(actor.organizationId, [dispatch.dispatchedBy]);
    if (options.audit) {
      for (const patientId of new Set(sendOuts.map((s) => s.patientId))) {
        await this.audit.recordStandalone(actor, {
          action: "lab.send-out.dispatch-view",
          resourceType: "lab_send_out_dispatch",
          resourceId: dispatchId,
          patientId,
        });
      }
    }
    return { ...dispatchView(dispatch, names), referenceLaboratoryName: lab?.name ?? null, sendOuts };
  }

  /** What the manifest and an electronic submission show (not audited here: the caller audits what it serves). */
  async dispatchSource(organizationId: string, dispatchId: string): Promise<DispatchSource | undefined> {
    const [dispatch] = await this.db
      .select()
      .from(labSendOutDispatch)
      .where(and(eq(labSendOutDispatch.organizationId, organizationId), eq(labSendOutDispatch.id, dispatchId)));
    if (!dispatch) return undefined;
    const [row] = await this.db.select().from(labReferenceLaboratory).where(eq(labReferenceLaboratory.id, dispatch.referenceLaboratoryId));
    const lab = found(row, "Reference laboratory");
    const facility = await this.organizations.getFacility(organizationId, dispatch.facilityId);
    const rows = await this.db
      .select({
        sendOut: labSendOut,
        specimen: labSpecimen,
        specimenType: labSpecimenType.name,
        container: labSpecimenType.container,
        order: labOrder,
        item: labOrderItem,
        loincCode: labTest.loincCode,
      })
      .from(labSendOut)
      .innerJoin(labSpecimen, eq(labSpecimen.id, labSendOut.specimenId))
      .innerJoin(labSpecimenType, eq(labSpecimenType.id, labSpecimen.specimenTypeId))
      .innerJoin(labOrder, eq(labOrder.id, labSendOut.orderId))
      .innerJoin(labOrderItem, eq(labOrderItem.id, labSendOut.orderItemId))
      .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
      .where(eq(labSendOut.dispatchId, dispatchId))
      .orderBy(asc(labSpecimen.accessionNumber), asc(labOrderItem.testCode));
    const specimens = new Map<string, DispatchSource["specimens"][number]>();
    for (const r of rows) {
      const entry = specimens.get(r.specimen.id) ?? {
        specimenId: r.specimen.id,
        patientId: r.specimen.patientId,
        accessionNumber: r.specimen.accessionNumber,
        specimenType: r.specimenType,
        container: r.container,
        collectedAt: r.specimen.collectedAt,
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        priority: r.order.priority,
        fastingRequired: r.order.fastingRequired,
        clinicalIndication: r.order.clinicalIndication,
        orderingPractitionerId: r.order.orderingPractitionerId,
        externalOrderer: r.order.externalOrderer,
        tests: [],
      };
      entry.tests.push({
        sendOutId: r.sendOut.id,
        orderItemId: r.item.id,
        code: r.item.testCode,
        name: r.item.testName,
        loincCode: r.loincCode,
        status: r.sendOut.status,
      });
      specimens.set(r.specimen.id, entry);
    }
    return {
      dispatch,
      facility: { id: facility.id, name: facility.name, timezone: facility.timezone },
      referenceLaboratory: { id: lab.id, code: lab.code, name: lab.name, accreditationReference: lab.accreditationReference },
      specimens: [...specimens.values()],
    };
  }

  // ---- internals ------------------------------------------------------------------------------

  private async insert(
    tx: DbExecutor,
    actor: Actor,
    item: LabOrderItemRecord,
    facilityId: string,
    referenceLaboratoryId: string,
    turnaroundMinutes: number | null,
  ): Promise<LabSendOutRecord | undefined> {
    if (!item.specimenId) throw new BusinessRuleError("The test has no specimen", "item_not_received");
    const [row] = (await tx
      .insert(labSendOut)
      .values({
        organizationId: actor.organizationId,
        facilityId,
        patientId: item.patientId,
        orderId: item.orderId,
        orderItemId: item.id,
        specimenId: item.specimenId,
        referenceLaboratoryId,
        turnaroundMinutes,
        preparedBy: actor.userId,
      })
      .onConflictDoNothing({ target: labSendOut.orderItemId, where: sql`status IN ('prepared', 'dispatched')` })
      .returning()) as LabSendOutRecord[];
    if (!row) return undefined;
    await this.audit.record(tx, actor, {
      action: "lab.send-out.prepare",
      resourceType: "lab_send_out",
      resourceId: row.id,
      patientId: row.patientId,
      metadata: { orderId: row.orderId, orderItemId: row.orderItemId, testCode: item.testCode, referenceLaboratoryId },
    });
    await this.events.record(tx, sendOutEvent("LaboratorySendOutPrepared", row));
    return row;
  }

  private async transition(
    actor: Actor,
    sendOutId: string,
    to: Extract<SendOutStatus, "results_received" | "rejected" | "cancelled">,
    fields: (row: LabSendOutRecord) => Partial<typeof labSendOut.$inferInsert>,
  ): Promise<void> {
    const facilityId = requireFacilityId(actor);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(labSendOut)
        .where(and(eq(labSendOut.organizationId, actor.organizationId), eq(labSendOut.id, sendOutId)))
        .for("update");
      const current = found(row, "Send-out");
      if (current.facilityId !== facilityId) throw new BusinessRuleError("This send-out belongs to another facility's laboratory", "wrong_facility");
      await this.close(tx, actor, current, to, fields(current));
    });
  }

  private async close(tx: DbExecutor, actor: Actor, row: LabSendOutRecord, to: SendOutStatus, fields: Partial<typeof labSendOut.$inferInsert>): Promise<void> {
    const stamp = to === "cancelled" ? { cancelledAt: new Date(), cancelledBy: actor.userId } : {};
    await this.move(tx, actor, row, to, { ...fields, ...stamp }, {});
  }

  private async move(
    tx: DbExecutor,
    actor: Actor,
    row: LabSendOutRecord,
    to: SendOutStatus,
    fields: Partial<typeof labSendOut.$inferInsert>,
    auditExtra: Record<string, unknown>,
  ): Promise<LabSendOutRecord> {
    if (!canMoveSendOut(row.status, to)) {
      throw new ConflictError(`The send-out is ${row.status.replace("_", " ")}; it cannot be ${to.replace("_", " ")} now`, undefined, "send_out_state");
    }
    const [updated] = await tx
      .update(labSendOut)
      .set({ ...fields, status: to, updatedAt: new Date(), version: row.version + 1 })
      .where(eq(labSendOut.id, row.id))
      .returning();
    const saved = found(updated, "Send-out");
    const reason = saved.cancellationReason ?? saved.rejectionReason ?? undefined;
    await this.audit.record(tx, actor, {
      action: `lab.send-out.${ACTION[to]}`,
      resourceType: "lab_send_out",
      resourceId: saved.id,
      patientId: saved.patientId,
      reason: to === "cancelled" || to === "rejected" ? reason : undefined,
      changes: { status: { from: row.status, to } },
      metadata: {
        orderId: saved.orderId,
        orderItemId: saved.orderItemId,
        referenceLaboratoryId: saved.referenceLaboratoryId,
        dispatchId: saved.dispatchId,
        referenceAccession: saved.referenceAccession,
        ...auditExtra,
      },
    });
    await this.events.record(tx, sendOutEvent(EVENT[to], saved));
    return saved;
  }

  private async view(actor: Actor, sendOutId: string): Promise<SendOutView> {
    const [row] = await this.views(actor, eq(labSendOut.id, sendOutId));
    if (!row) throw new NotFoundError("Send-out");
    return row;
  }

  private async views(actor: Actor, where: SQL | undefined, limit = 500) {
    const rows = await this.db
      .select({
        sendOut: labSendOut,
        labName: labReferenceLaboratory.name,
        manifestNumber: labSendOutDispatch.manifestNumber,
        orderNumber: labOrder.orderNumber,
        priority: labOrder.priority,
        testCode: labOrderItem.testCode,
        testName: labOrderItem.testName,
        itemStatus: labOrderItem.status,
        accessionNumber: labSpecimen.accessionNumber,
        collectedAt: labSpecimen.collectedAt,
        specimenTypeName: labSpecimenType.name,
      })
      .from(labSendOut)
      .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labSendOut.referenceLaboratoryId))
      .leftJoin(labSendOutDispatch, eq(labSendOutDispatch.id, labSendOut.dispatchId))
      .innerJoin(labOrder, eq(labOrder.id, labSendOut.orderId))
      .innerJoin(labOrderItem, eq(labOrderItem.id, labSendOut.orderItemId))
      .innerJoin(labSpecimen, eq(labSpecimen.id, labSendOut.specimenId))
      .innerJoin(labSpecimenType, eq(labSpecimenType.id, labSpecimen.specimenTypeId))
      .where(and(eq(labSendOut.organizationId, actor.organizationId), where))
      .orderBy(asc(labSendOut.dispatchedAt), asc(labSendOut.preparedAt))
      .limit(limit);
    const organizationId = actor.organizationId;
    const [patients, staff] = await Promise.all([
      this.context.patientBriefs(organizationId, [...new Set(rows.map((r) => r.sendOut.patientId))]),
      this.context.staffNames(organizationId, [
        ...new Set(
          rows
            .flatMap((r) => [r.sendOut.preparedBy, r.sendOut.resultsReceivedBy, r.sendOut.rejectedBy, r.sendOut.cancelledBy])
            .filter((id): id is string => !!id),
        ),
      ]),
    ]);
    const now = new Date();
    return rows.map((r) => this.toView(r, patients, staff, now));
  }

  toView(
    r: {
      sendOut: LabSendOutRecord;
      labName: string;
      manifestNumber: string | null;
      orderNumber: string;
      priority: string;
      testCode: string;
      testName: string;
      itemStatus: LabOrderItemRecord["status"];
      accessionNumber: string;
      collectedAt: Date;
      specimenTypeName: string;
    },
    patients: Map<string, { patientNumber: string; displayName: string; sex: string; age: number }>,
    staff: Map<string, string>,
    now: Date,
  ) {
    const { organizationId: _organizationId, ...s } = r.sendOut;
    const name = (id: string | null) => (id ? (staff.get(id) ?? null) : null);
    return {
      ...s,
      ...sendOutTiming(s, now),
      referenceLaboratoryName: r.labName,
      manifestNumber: r.manifestNumber,
      orderNumber: r.orderNumber,
      priority: r.priority,
      testCode: r.testCode,
      testName: r.testName,
      itemStatus: r.itemStatus,
      accessionNumber: r.accessionNumber,
      collectedAt: r.collectedAt,
      specimenTypeName: r.specimenTypeName,
      patient: patients.get(s.patientId) ?? null,
      preparedByName: name(s.preparedBy),
      resultsReceivedByName: name(s.resultsReceivedBy),
      rejectedByName: name(s.rejectedBy),
      cancelledByName: name(s.cancelledBy),
    };
  }

  private async findDispatch(executor: DbExecutor, organizationId: string, dispatchId: string): Promise<LabSendOutDispatchRecord> {
    const [row] = await executor
      .select()
      .from(labSendOutDispatch)
      .where(and(eq(labSendOutDispatch.organizationId, organizationId), eq(labSendOutDispatch.id, dispatchId)));
    return found(row, "Dispatch");
  }
}

const ACTION: Record<SendOutStatus, string> = {
  prepared: "prepare",
  dispatched: "dispatch",
  results_received: "results-received",
  rejected: "reference-rejected",
  cancelled: "cancel",
};

const EVENT: Record<SendOutStatus, string> = {
  prepared: "LaboratorySendOutPrepared",
  dispatched: "LaboratorySendOutDispatched",
  results_received: "LaboratorySendOutResultsReceived",
  rejected: "LaboratorySendOutRejected",
  cancelled: "LaboratorySendOutCancelled",
};

function dispatchView(dispatch: LabSendOutDispatchRecord, names: Map<string, string>) {
  const { organizationId: _organizationId, ...rest } = dispatch;
  return { ...rest, dispatchedByName: names.get(dispatch.dispatchedBy) ?? null };
}

/** Ids and statuses only: never test names, values or clinical text. */
function sendOutEvent(type: string, row: LabSendOutRecord) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "lab_send_out",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: {
      orderId: row.orderId,
      orderItemId: row.orderItemId,
      specimenId: row.specimenId,
      referenceLaboratoryId: row.referenceLaboratoryId,
      dispatchId: row.dispatchId,
      status: row.status,
    },
  };
}
