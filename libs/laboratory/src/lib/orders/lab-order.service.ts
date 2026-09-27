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
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { type OrderView, LabReadModel, type SpecimenView } from "../lab-read-model";
import type { collectSpecimenSchema, createOrderSchema, rejectSpecimenSchema } from "../laboratory.dto";
import { accessionNumber, orderStatusFromItems } from "../laboratory.rules";
import {
  labAccessionSequence,
  labOrder,
  labOrderItem,
  type LabOrderItemRecord,
  labOrderNumberSequence,
  type LabOrderRecord,
  labPanel,
  labPanelTest,
  labResult,
  labSpecimen,
  labSpecimenEvent,
  type LabSpecimenRecord,
  labTest,
  type OrderSource,
  type SpecimenEventType,
} from "../laboratory.schema";
import { found, publicView } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";

/**
 * Laboratory orders and specimens: ordering (from a consultation, or at the
 * laboratory for external and patient requests), collection with server-side
 * accession numbers, receiving, rejection with recollection, and cancellation.
 * Every specimen transition is also written to the append-only event log.
 */
@Injectable()
export class LabOrderService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly readModel: LabReadModel,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async create(actor: Actor, input: z.infer<typeof createOrderSchema>): Promise<OrderView> {
    const facilityId = requireFacilityId(actor);
    const practitioner = await this.context.practitionerForUser(actor.organizationId, actor.userId);
    let source: OrderSource;
    if (input.encounterId) {
      const encounter = await this.context.encounter(actor.organizationId, input.encounterId);
      if (!encounter || encounter.patientId !== input.patientId) throw new NotFoundError("Encounter");
      if (encounter.status !== "in_progress") throw new BusinessRuleError("Laboratory tests are ordered during an open encounter", "encounter_not_in_progress");
      if (!practitioner) throw new ForbiddenError("Your account is not linked to a practitioner who may order tests");
      source = input.source ?? (encounter.modality === "telemedicine" ? "telemedicine" : "clinic");
      if (!["clinic", "telemedicine", "dental"].includes(source))
        throw new BusinessRuleError("Orders from an encounter are clinic, telemedicine or dental", "invalid_source");
    } else {
      source = input.source ?? (practitioner ? "clinic" : "patient_request");
      if (source === "external" && !input.externalOrderer) {
        throw new BusinessRuleError("Record the requesting physician for an external order", "external_orderer_required");
      }
      if (["clinic", "telemedicine", "dental"].includes(source) && !practitioner) {
        throw new ForbiddenError("Your account is not linked to a practitioner who may order tests");
      }
    }
    const orderingPractitionerId = source === "external" || source === "patient_request" ? null : (practitioner?.id ?? null);

    return this.db.transaction(async (tx) => {
      const tests = await this.resolveTests(tx, actor.organizationId, input.testIds, input.panelIds);
      const [counter] = await tx
        .insert(labOrderNumberSequence)
        .values({ organizationId: actor.organizationId, nextValue: 1 })
        .onConflictDoUpdate({ target: labOrderNumberSequence.organizationId, set: { nextValue: sql`${labOrderNumberSequence.nextValue} + 1` } })
        .returning({ value: labOrderNumberSequence.nextValue });
      if (!counter) throw new Error("Could not allocate an order number");
      const [row] = await tx
        .insert(labOrder)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          orderingPractitionerId,
          externalOrderer: input.externalOrderer ?? null,
          orderNumber: `LO${String(counter.value).padStart(8, "0")}`,
          source,
          priority: input.priority,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          clinicalIndication: input.clinicalIndication ?? null,
          notes: input.notes ?? null,
          fastingRequired: tests.some((t) => t.requiresFasting),
          orderedBy: actor.userId,
        })
        .returning()
        .catch((error: unknown) => {
          // Composite foreign keys: unknown patient in this organization, or encounter of another patient.
          if ((error as { code?: string }).code === "23503") throw new NotFoundError("Patient");
          throw error;
        });
      const order = found(row, "Laboratory order");
      await tx.insert(labOrderItem).values(
        tests.map((t) => ({
          organizationId: actor.organizationId,
          patientId: order.patientId,
          orderId: order.id,
          testId: t.id,
          testCode: t.code,
          testName: t.name,
          panelId: t.panelId,
          panelCode: t.panelCode,
        })),
      );
      await this.audit.record(tx, actor, {
        action: "lab.order.create",
        resourceType: "lab_order",
        resourceId: order.id,
        patientId: order.patientId,
        metadata: { orderNumber: order.orderNumber, source, priority: order.priority, tests: tests.length, encounterId: order.encounterId },
      });
      await this.events.record(tx, orderEvent("LaboratoryOrderCreated", order, { items: tests.length }));
      const [view] = await this.readModel.orders(tx, actor, [order]);
      return view!;
    });
  }

  async get(actor: Actor, orderId: string): Promise<OrderView> {
    const order = await this.find(this.db, actor.organizationId, orderId);
    await this.audit.recordStandalone(actor, { action: "lab.order.view", resourceType: "lab_order", resourceId: orderId, patientId: order.patientId });
    const [view] = await this.readModel.orders(this.db, actor, [order]);
    return view!;
  }

  async list(actor: Actor, query: { patientId?: string; encounterId?: string; status?: LabOrderRecord["status"] }): Promise<OrderView[]> {
    const filters: SQL[] = [eq(labOrder.organizationId, actor.organizationId)];
    if (query.patientId) filters.push(eq(labOrder.patientId, query.patientId));
    if (query.encounterId) filters.push(eq(labOrder.encounterId, query.encounterId));
    if (query.status) filters.push(eq(labOrder.status, query.status));
    const rows = await this.db
      .select()
      .from(labOrder)
      .where(and(...filters))
      .orderBy(desc(labOrder.orderedAt))
      .limit(100);
    for (const patientId of new Set(rows.map((r) => r.patientId))) {
      await this.audit.recordStandalone(actor, { action: "lab.order.list", resourceType: "lab_order", patientId });
    }
    return this.readModel.orders(this.db, actor, rows);
  }

  /** Cancels every item that has no result yet. Items with results are corrected or cancelled individually. */
  async cancel(actor: Actor, orderId: string, reason: string): Promise<OrderView> {
    return this.db.transaction(async (tx) => {
      const order = await this.lock(tx, actor.organizationId, orderId);
      if (order.status !== "active") throw new BusinessRuleError(`The order is ${order.status}`, "order_not_active");
      const items = await tx.select().from(labOrderItem).where(eq(labOrderItem.orderId, orderId)).for("update");
      const cancellable = items.filter((i) => ["pending_collection", "collected", "received"].includes(i.status));
      if (cancellable.length !== items.filter((i) => i.status !== "cancelled").length) {
        throw new BusinessRuleError("Some tests already have results; cancel the remaining tests one by one", "order_has_results");
      }
      await this.cancelItems(tx, actor, cancellable, reason);
      const updated = await this.refreshOrderStatus(tx, actor, order, reason);
      await this.audit.record(tx, actor, { action: "lab.order.cancel", resourceType: "lab_order", resourceId: orderId, patientId: order.patientId, reason });
      const [view] = await this.readModel.orders(tx, actor, [updated]);
      return view!;
    });
  }

  async cancelItem(actor: Actor, orderId: string, itemId: string, reason: string): Promise<OrderView> {
    return this.db.transaction(async (tx) => {
      const order = await this.lock(tx, actor.organizationId, orderId);
      const [item] = await tx
        .select()
        .from(labOrderItem)
        .where(and(eq(labOrderItem.orderId, orderId), eq(labOrderItem.id, itemId)))
        .for("update");
      const current = found(item, "Order item");
      if (current.status === "cancelled") throw new BusinessRuleError("The test is already cancelled", "item_cancelled");
      if (current.status === "released") throw new BusinessRuleError("A released result is corrected, not cancelled", "item_released");
      if (current.status === "resulted") {
        // Unreleased results are cancelled with the item (the result history stays).
        await tx
          .update(labResult)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.userId, cancellationReason: reason })
          .where(and(eq(labResult.orderItemId, itemId), notInArray(labResult.status, ["superseded", "cancelled", "released"])));
      }
      await this.cancelItems(tx, actor, [current], reason);
      const updated = await this.refreshOrderStatus(tx, actor, order, reason);
      await this.audit.record(tx, actor, {
        action: "lab.order-item.cancel",
        resourceType: "lab_order",
        resourceId: orderId,
        patientId: order.patientId,
        reason,
        metadata: { itemId, testCode: current.testCode },
      });
      const [view] = await this.readModel.orders(tx, actor, [updated]);
      return view!;
    });
  }

  /** Collects one specimen for some pending items of an order and assigns its accession number. */
  async collect(actor: Actor, orderId: string, input: z.infer<typeof collectSpecimenSchema>): Promise<OrderView> {
    const facilityId = requireFacilityId(actor);
    const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
    if (collectedAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("Collection time cannot be in the future", "collected_in_future");
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    return this.db.transaction(async (tx) => {
      const order = await this.lock(tx, actor.organizationId, orderId);
      if (order.status !== "active") throw new BusinessRuleError(`The order is ${order.status}`, "order_not_active");
      if (order.facilityId !== facilityId) throw new BusinessRuleError("Collect this order at the facility it was placed for", "wrong_facility");
      const itemIds = [...new Set(input.itemIds)];
      const items = await tx
        .select({ item: labOrderItem, specimenTypeId: labTest.specimenTypeId })
        .from(labOrderItem)
        .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
        .where(and(eq(labOrderItem.orderId, orderId), inArray(labOrderItem.id, itemIds)))
        .for("update", { of: labOrderItem });
      if (items.length !== itemIds.length) throw new NotFoundError("Order item");
      if (items.some((i) => i.item.status !== "pending_collection"))
        throw new ConflictError("Some tests were already collected or cancelled", undefined, "item_not_pending");
      if (items.some((i) => i.specimenTypeId !== input.specimenTypeId)) {
        throw new BusinessRuleError("These tests need a different specimen type", "specimen_type_mismatch");
      }
      const date = localDate(collectedAt, facility.timezone);
      const [counter] = await tx
        .insert(labAccessionSequence)
        .values({ facilityId, accessionDate: date, nextValue: 1 })
        .onConflictDoUpdate({
          target: [labAccessionSequence.facilityId, labAccessionSequence.accessionDate],
          set: { nextValue: sql`${labAccessionSequence.nextValue} + 1` },
        })
        .returning({ value: labAccessionSequence.nextValue });
      if (!counter) throw new Error("Could not allocate an accession number");
      const [row] = await tx
        .insert(labSpecimen)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: order.patientId,
          orderId,
          specimenTypeId: input.specimenTypeId,
          accessionNumber: accessionNumber(date, counter.value),
          collectedAt,
          collectedBy: actor.userId,
        })
        .returning();
      const specimen = found(row, "Specimen");
      await tx
        .update(labOrderItem)
        .set({ status: "collected", specimenId: specimen.id, updatedAt: new Date(), version: sql`${labOrderItem.version} + 1` })
        .where(inArray(labOrderItem.id, itemIds));
      await this.logSpecimen(tx, actor, specimen, "collected");
      await this.audit.record(tx, actor, {
        action: "lab.specimen.collect",
        resourceType: "lab_specimen",
        resourceId: specimen.id,
        patientId: order.patientId,
        metadata: { accessionNumber: specimen.accessionNumber, orderId, items: itemIds.length },
      });
      await this.events.record(tx, specimenEvent("SpecimenCollected", specimen));
      const [view] = await this.readModel.orders(tx, actor, [order]);
      return view!;
    });
  }

  async receive(actor: Actor, specimenId: string): Promise<SpecimenView> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const specimen = await this.lockSpecimen(tx, actor.organizationId, specimenId);
      if (specimen.facilityId !== facilityId) throw new BusinessRuleError("This specimen belongs to another facility", "wrong_facility");
      if (specimen.status !== "collected") throw new ConflictError(`The specimen is already ${specimen.status}`, undefined, "specimen_not_collected");
      const [row] = await tx
        .update(labSpecimen)
        .set({ status: "received", receivedAt: new Date(), receivedBy: actor.userId, updatedAt: new Date(), version: sql`${labSpecimen.version} + 1` })
        .where(eq(labSpecimen.id, specimenId))
        .returning();
      const updated = found(row, "Specimen");
      await tx
        .update(labOrderItem)
        .set({ status: "received", updatedAt: new Date(), version: sql`${labOrderItem.version} + 1` })
        .where(and(eq(labOrderItem.specimenId, specimenId), eq(labOrderItem.status, "collected")));
      await this.logSpecimen(tx, actor, updated, "received");
      await this.audit.record(tx, actor, {
        action: "lab.specimen.receive",
        resourceType: "lab_specimen",
        resourceId: specimenId,
        patientId: updated.patientId,
        metadata: { accessionNumber: updated.accessionNumber },
      });
      await this.events.record(tx, specimenEvent("SpecimenReceived", updated));
      return this.specimen(tx, actor, updated);
    });
  }

  /**
   * Rejects a specimen (haemolysed, clotted, mislabelled…). Its tests go back
   * to collection when recollection is requested, otherwise they are cancelled.
   * Unreleased results on it are cancelled; released results must be corrected.
   */
  async reject(actor: Actor, specimenId: string, input: z.infer<typeof rejectSpecimenSchema>): Promise<SpecimenView> {
    return this.db.transaction(async (tx) => {
      const specimen = await this.lockSpecimen(tx, actor.organizationId, specimenId);
      if (!["collected", "received"].includes(specimen.status))
        throw new ConflictError(`The specimen is ${specimen.status}`, undefined, "specimen_not_rejectable");
      const items = await tx.select().from(labOrderItem).where(eq(labOrderItem.specimenId, specimenId)).for("update");
      if (items.some((i) => i.status === "released")) {
        throw new BusinessRuleError(
          "Results from this specimen were released; correct them instead of rejecting the specimen",
          "specimen_has_released_results",
        );
      }
      const now = new Date();
      const [row] = await tx
        .update(labSpecimen)
        .set({
          status: "rejected",
          rejectedAt: now,
          rejectedBy: actor.userId,
          rejectionReason: input.reason,
          updatedAt: now,
          version: sql`${labSpecimen.version} + 1`,
        })
        .where(eq(labSpecimen.id, specimenId))
        .returning();
      const updated = found(row, "Specimen");
      const itemIds = items.filter((i) => i.status !== "cancelled").map((i) => i.id);
      if (itemIds.length) {
        await tx
          .update(labResult)
          .set({ status: "cancelled", cancelledAt: now, cancelledBy: actor.userId, cancellationReason: `Specimen rejected: ${input.reason}` })
          .where(and(inArray(labResult.orderItemId, itemIds), notInArray(labResult.status, ["superseded", "cancelled", "released"])));
        if (input.requestRecollection) {
          await tx
            .update(labOrderItem)
            .set({ status: "pending_collection", specimenId: null, updatedAt: now, version: sql`${labOrderItem.version} + 1` })
            .where(inArray(labOrderItem.id, itemIds));
        } else {
          await this.cancelItems(
            tx,
            actor,
            items.filter((i) => itemIds.includes(i.id)),
            `Specimen rejected: ${input.reason}`,
          );
        }
      }
      await this.logSpecimen(tx, actor, updated, "rejected", input.reason);
      if (input.requestRecollection) await this.logSpecimen(tx, actor, updated, "recollection_requested", input.reason);
      const order = await this.lock(tx, actor.organizationId, updated.orderId);
      await this.refreshOrderStatus(tx, actor, order, `Specimen rejected: ${input.reason}`);
      await this.audit.record(tx, actor, {
        action: "lab.specimen.reject",
        resourceType: "lab_specimen",
        resourceId: specimenId,
        patientId: updated.patientId,
        reason: input.reason,
        metadata: { accessionNumber: updated.accessionNumber, recollection: input.requestRecollection, items: itemIds.length },
      });
      await this.events.record(tx, specimenEvent("SpecimenRejected", updated, { recollectionRequested: input.requestRecollection }));
      return this.specimen(tx, actor, updated);
    });
  }

  /** Barcode scan: the specimen with this accession number at the actor's facility, with its order. */
  async byAccession(actor: Actor, accession: string): Promise<{ specimen: SpecimenView; order: OrderView }> {
    const facilityId = requireFacilityId(actor);
    const [row] = await this.db
      .select()
      .from(labSpecimen)
      .where(and(eq(labSpecimen.organizationId, actor.organizationId), eq(labSpecimen.facilityId, facilityId), eq(labSpecimen.accessionNumber, accession)));
    const specimen = found(row, "Specimen");
    const order = await this.find(this.db, actor.organizationId, specimen.orderId);
    await this.audit.recordStandalone(actor, { action: "lab.order.view", resourceType: "lab_order", resourceId: order.id, patientId: order.patientId });
    const [view] = await this.readModel.orders(this.db, actor, [order]);
    return { specimen: await this.specimen(this.db, actor, specimen), order: view! };
  }

  async specimenEvents(actor: Actor, specimenId: string) {
    const [specimen] = await this.db
      .select()
      .from(labSpecimen)
      .where(and(eq(labSpecimen.organizationId, actor.organizationId), eq(labSpecimen.id, specimenId)));
    found(specimen, "Specimen");
    const rows = await this.db.select().from(labSpecimenEvent).where(eq(labSpecimenEvent.specimenId, specimenId)).orderBy(asc(labSpecimenEvent.occurredAt));
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.actorUserId))]);
    return rows.map((r) => ({ ...publicView(r), actorName: names.get(r.actorUserId) ?? null }));
  }

  /** Who to tell about an order's results (for notifications). Not audited: no clinical content is returned. */
  async noticeTarget(
    organizationId: string,
    orderId: string,
  ): Promise<{ orderNumber: string; patientId: string; orderingPractitionerId: string | null } | undefined> {
    const [row] = await this.db
      .select({ orderNumber: labOrder.orderNumber, patientId: labOrder.patientId, orderingPractitionerId: labOrder.orderingPractitionerId })
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.id, orderId)));
    return row;
  }

  // ---- internals ------------------------------------------------------------------------

  /** Individual tests, plus the active tests of each panel (a test in two panels is ordered once). */
  private async resolveTests(tx: DbExecutor, organizationId: string, testIds: string[], panelIds: string[]) {
    type Resolved = { id: string; code: string; name: string; requiresFasting: boolean; panelId: string | null; panelCode: string | null };
    const resolved = new Map<string, Resolved>();
    if (panelIds.length) {
      const panels = await tx
        .select()
        .from(labPanel)
        .where(and(eq(labPanel.organizationId, organizationId), inArray(labPanel.id, panelIds), eq(labPanel.status, "active")));
      if (panels.length !== new Set(panelIds).size) throw new NotFoundError("Active laboratory panel");
      const members = await tx
        .select({ panelId: labPanelTest.panelId, test: labTest })
        .from(labPanelTest)
        .innerJoin(labTest, eq(labTest.id, labPanelTest.testId))
        .where(and(inArray(labPanelTest.panelId, panelIds), eq(labTest.status, "active")))
        .orderBy(asc(labPanelTest.position));
      for (const { panelId, test } of members) {
        if (resolved.has(test.id)) continue;
        const panel = panels.find((p) => p.id === panelId)!;
        resolved.set(test.id, { id: test.id, code: test.code, name: test.name, requiresFasting: test.requiresFasting, panelId, panelCode: panel.code });
      }
    }
    const single = [...new Set(testIds)].filter((id) => !resolved.has(id));
    if (single.length) {
      const tests = await tx
        .select()
        .from(labTest)
        .where(and(eq(labTest.organizationId, organizationId), inArray(labTest.id, single), eq(labTest.status, "active")));
      if (tests.length !== single.length) throw new NotFoundError("Active laboratory test");
      for (const test of tests) {
        resolved.set(test.id, { id: test.id, code: test.code, name: test.name, requiresFasting: test.requiresFasting, panelId: null, panelCode: null });
      }
    }
    if (resolved.size === 0) throw new BusinessRuleError("The chosen panels have no active tests", "no_tests");
    return [...resolved.values()];
  }

  private async cancelItems(tx: DbExecutor, actor: Actor, items: LabOrderItemRecord[], reason: string): Promise<void> {
    if (items.length === 0) return;
    await tx
      .update(labOrderItem)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: actor.userId,
        cancellationReason: reason,
        updatedAt: new Date(),
        version: sql`${labOrderItem.version} + 1`,
      })
      .where(
        inArray(
          labOrderItem.id,
          items.map((i) => i.id),
        ),
      );
  }

  /** Recomputes the order status from its items (complete / cancelled) inside the caller's transaction. */
  async refreshOrderStatus(tx: DbExecutor, actor: Actor, order: LabOrderRecord, reason?: string): Promise<LabOrderRecord> {
    const items = await tx.select({ status: labOrderItem.status }).from(labOrderItem).where(eq(labOrderItem.orderId, order.id));
    const status = orderStatusFromItems(items);
    if (status === order.status) return order;
    const now = new Date();
    const [row] = await tx
      .update(labOrder)
      .set({
        status,
        completedAt: status === "completed" ? now : null,
        cancelledAt: status === "cancelled" ? now : null,
        cancelledBy: status === "cancelled" ? actor.userId : null,
        cancellationReason: status === "cancelled" ? (reason ?? "All tests cancelled") : null,
        updatedAt: now,
        version: sql`${labOrder.version} + 1`,
      })
      .where(eq(labOrder.id, order.id))
      .returning();
    const updated = found(row, "Laboratory order");
    if (status === "cancelled") await this.events.record(tx, orderEvent("LaboratoryOrderCancelled", updated));
    if (status === "completed") await this.events.record(tx, orderEvent("LaboratoryOrderCompleted", updated));
    return updated;
  }

  private async specimen(executor: DbExecutor, actor: Actor, specimen: LabSpecimenRecord): Promise<SpecimenView> {
    const names = await this.context.staffNames(
      actor.organizationId,
      [specimen.collectedBy, specimen.receivedBy].filter((id): id is string => !!id),
    );
    return this.readModel.specimenView(specimen, names);
  }

  private async logSpecimen(tx: DbExecutor, actor: Actor, specimen: LabSpecimenRecord, event: SpecimenEventType, reason?: string): Promise<void> {
    await tx
      .insert(labSpecimenEvent)
      .values({ organizationId: actor.organizationId, specimenId: specimen.id, event, actorUserId: actor.userId, reason: reason ?? null });
  }

  private async find(executor: DbExecutor, organizationId: string, orderId: string): Promise<LabOrderRecord> {
    const [row] = await executor
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.id, orderId)));
    return found(row, "Laboratory order");
  }

  private async lock(tx: DbExecutor, organizationId: string, orderId: string): Promise<LabOrderRecord> {
    const [row] = await tx
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.id, orderId)))
      .for("update");
    return found(row, "Laboratory order");
  }

  private async lockSpecimen(tx: DbExecutor, organizationId: string, specimenId: string): Promise<LabSpecimenRecord> {
    const [row] = await tx
      .select()
      .from(labSpecimen)
      .where(and(eq(labSpecimen.organizationId, organizationId), eq(labSpecimen.id, specimenId)))
      .for("update");
    return found(row, "Specimen");
  }
}

export function orderEvent(type: string, order: LabOrderRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: order.organizationId,
    aggregateType: "lab_order",
    aggregateId: order.id,
    facilityId: order.facilityId,
    patientId: order.patientId,
    payload: { orderNumber: order.orderNumber, status: order.status, priority: order.priority, encounterId: order.encounterId, ...extra },
  };
}

function specimenEvent(type: string, specimen: LabSpecimenRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: specimen.organizationId,
    aggregateType: "lab_specimen",
    aggregateId: specimen.id,
    facilityId: specimen.facilityId,
    patientId: specimen.patientId,
    payload: { orderId: specimen.orderId, accessionNumber: specimen.accessionNumber, status: specimen.status, ...extra },
  };
}
