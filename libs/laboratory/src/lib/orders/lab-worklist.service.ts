import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, localDate, localDayBounds, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { LabReadModel, type OrderItemView, type OrderView, type SpecimenView } from "../lab-read-model";
import type { WORKLIST_STAGES } from "../laboratory.dto";
import { labCriticalAlert, labOrder, labOrderItem, labResult, labSpecimen, labTest } from "../laboratory.schema";
import { awaitsReferenceLab } from "../send-outs/send-out.rules";
import { labSendOut } from "../send-outs/send-out.schema";

export type WorklistStage = (typeof WORKLIST_STAGES)[number];

export interface WorklistRow {
  /** Specimen id, or the order id for tests still to be collected. */
  key: string;
  order: Omit<OrderView, "items" | "specimens" | "patient">;
  patient: OrderView["patient"];
  specimen: SpecimenView | null;
  items: OrderItemView[];
}

const PRIORITY_RANK = { stat: 0, scheduled: 1, routine: 2 } as const;
const MAX_ORDERS = 200;

/**
 * The laboratory's worklists (one per stage, STAT first) and dashboard, for
 * the facility the user is working in.
 */
@Injectable()
export class LabWorklistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly readModel: LabReadModel,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async worklist(actor: Actor, stage: WorklistStage, departmentId?: string): Promise<WorklistRow[]> {
    const facilityId = requireFacilityId(actor);
    const orderIds = await this.orderIdsFor(actor.organizationId, facilityId, stage);
    if (orderIds.length === 0) return [];
    const orders = await this.db.select().from(labOrder).where(inArray(labOrder.id, orderIds));
    const views = await this.readModel.orders(this.db, actor, orders);
    await this.audit.recordStandalone(actor, { action: "lab.worklist.view", resourceType: "lab_order", metadata: { stage, orders: views.length } });

    const rows: WorklistRow[] = [];
    for (const { items, specimens, patient, ...order } of views) {
      const relevant = items.filter((i) => inStage(i, stage) && (!departmentId || i.departmentId === departmentId));
      const groups = new Map<string, OrderItemView[]>();
      for (const item of relevant) {
        const key = stage === "collect" ? order.id : (item.specimenId ?? order.id);
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const [key, groupItems] of groups) {
        rows.push({ key, order, patient, specimen: specimens.find((s) => s.id === key) ?? null, items: groupItems });
      }
    }
    return rows.sort(
      (a, b) =>
        PRIORITY_RANK[a.order.priority] - PRIORITY_RANK[b.order.priority] || new Date(a.order.orderedAt).getTime() - new Date(b.order.orderedAt).getTime(),
    );
  }

  /** Today's laboratory at the facility: queue sizes per stage, critical results, rejections, turnaround. */
  async dashboard(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const now = new Date();
    const { start, end } = localDayBounds(localDate(now, facility.timezone), facility.timezone);
    const org = actor.organizationId;

    const [items] = await this.db
      .select({
        pendingCollection: sql<number>`count(*) filter (where ${labOrderItem.status} = 'pending_collection')::int`,
        awaitingReceipt: sql<number>`count(*) filter (where ${labOrderItem.status} = 'collected')::int`,
        // Tests with a send-out in flight wait on the reference laboratory, not on result entry.
        awaitingEntry: sql<number>`count(*) filter (where ${labOrderItem.status} = 'received' and not exists (
          select 1 from ${labSendOut} where ${labSendOut.orderItemId} = ${labOrderItem.id} and ${labSendOut.status} in ('prepared', 'dispatched')))::int`,
        statOpen: sql<number>`count(*) filter (where ${labOrder.priority} = 'stat' and ${labOrderItem.status} not in ('released', 'cancelled'))::int`,
        overdue: sql<number>`count(*) filter (where ${labOrderItem.status} not in ('released', 'cancelled') and ${labTest.turnaroundMinutes} is not null
          and ${labSpecimen.collectedAt} + make_interval(mins => ${labTest.turnaroundMinutes}) < now())::int`,
      })
      .from(labOrderItem)
      .innerJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
      .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
      .where(and(eq(labOrder.organizationId, org), eq(labOrder.facilityId, facilityId), eq(labOrder.status, "active")));

    const [results] = await this.db
      .select({
        awaitingVerification: sql<number>`count(*) filter (where ${labResult.status} = 'entered')::int`,
        awaitingApproval: sql<number>`count(*) filter (where ${labResult.status} = 'verified')::int`,
        awaitingRelease: sql<number>`count(*) filter (where ${labResult.status} = 'approved')::int`,
      })
      .from(labResult)
      .where(and(eq(labResult.organizationId, org), eq(labResult.facilityId, facilityId), inArray(labResult.status, ["entered", "verified", "approved"])));

    const [released] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        averageTurnaroundMinutes: sql<number | null>`round(avg(extract(epoch from ${labResult.releasedAt} - ${labSpecimen.collectedAt}) / 60))::int`,
      })
      .from(labResult)
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
      .where(
        and(
          eq(labResult.organizationId, org),
          eq(labResult.facilityId, facilityId),
          eq(labResult.status, "released"),
          gte(labResult.releasedAt, start),
          lt(labResult.releasedAt, end),
        ),
      );

    const [rejected] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(labSpecimen)
      .where(
        and(eq(labSpecimen.organizationId, org), eq(labSpecimen.facilityId, facilityId), gte(labSpecimen.rejectedAt, start), lt(labSpecimen.rejectedAt, end)),
      );

    const [sentOut] = await this.db
      .select({
        toDispatch: sql<number>`count(*) filter (where ${labSendOut.status} = 'prepared')::int`,
        awaitingResults: sql<number>`count(*) filter (where ${labSendOut.status} = 'dispatched')::int`,
        overdue: sql<number>`count(*) filter (where ${labSendOut.status} = 'dispatched' and ${labSendOut.turnaroundMinutes} is not null
          and ${labSendOut.dispatchedAt} + make_interval(mins => ${labSendOut.turnaroundMinutes}) < now())::int`,
      })
      .from(labSendOut)
      .where(and(eq(labSendOut.organizationId, org), eq(labSendOut.facilityId, facilityId), inArray(labSendOut.status, ["prepared", "dispatched"])));

    const [critical] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(labCriticalAlert)
      .where(and(eq(labCriticalAlert.organizationId, org), eq(labCriticalAlert.facilityId, facilityId), notInArray(labCriticalAlert.status, ["acknowledged"])));

    return {
      facilityId,
      date: localDate(now, facility.timezone),
      ...items!,
      ...results!,
      releasedToday: released?.count ?? 0,
      averageTurnaroundMinutes: released?.averageTurnaroundMinutes ?? null,
      rejectedToday: rejected?.count ?? 0,
      criticalUnacknowledged: critical?.count ?? 0,
      sendOutsToDispatch: sentOut?.toDispatch ?? 0,
      sendOutsAwaitingResults: sentOut?.awaitingResults ?? 0,
      sendOutsOverdue: sentOut?.overdue ?? 0,
    };
  }

  private async orderIdsFor(organizationId: string, facilityId: string, stage: WorklistStage): Promise<string[]> {
    const itemStatus = { collect: "pending_collection", receive: "collected", enter: "received" } as const;
    if (stage === "collect" || stage === "receive" || stage === "enter") {
      const rows = await this.db
        .selectDistinct({ id: labOrder.id, orderedAt: labOrder.orderedAt })
        .from(labOrderItem)
        .innerJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
        .where(
          and(
            eq(labOrder.organizationId, organizationId),
            eq(labOrder.facilityId, facilityId),
            eq(labOrder.status, "active"),
            eq(labOrderItem.status, itemStatus[stage]),
          ),
        )
        .orderBy(asc(labOrder.orderedAt))
        .limit(MAX_ORDERS);
      return rows.map((r) => r.id);
    }
    const resultStatus = { verify: "entered", approve: "verified", release: "approved" } as const;
    const rows = await this.db
      .selectDistinct({ id: labResult.orderId })
      .from(labResult)
      .where(and(eq(labResult.organizationId, organizationId), eq(labResult.facilityId, facilityId), eq(labResult.status, resultStatus[stage])))
      .limit(MAX_ORDERS);
    return rows.map((r) => r.id);
  }
}

function inStage(item: OrderItemView, stage: WorklistStage): boolean {
  switch (stage) {
    case "collect":
      return item.status === "pending_collection";
    case "receive":
      return item.status === "collected";
    case "enter":
      // Not while a reference laboratory has the test (see /laboratory/send-outs).
      return item.status === "received" && !awaitsReferenceLab(item.sendOut?.status);
    case "verify":
      return item.result?.status === "entered";
    case "approve":
      return item.result?.status === "verified";
    case "release":
      return item.result?.status === "approved";
  }
}
