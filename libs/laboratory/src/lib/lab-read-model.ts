import { Inject, Injectable } from "@nestjs/common";
import type { Actor, DbExecutor } from "@healthcare/core";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import {
  labOrderItem,
  type LabOrderItemRecord,
  type LabOrderRecord,
  labResult,
  type LabResultRecord,
  labSpecimen,
  type LabSpecimenRecord,
  labTest,
} from "./laboratory.schema";
import { publicView } from "./laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext, type LabPatientBrief } from "./ports";

/** Holders of these may see results before release (the laboratory's own workflow). */
const LAB_WORKFLOW_PERMISSIONS = ["lab.result.enter", "lab.result.verify", "lab.result.approve", "lab.result.release", "lab.result.amend"];

export function canSeeUnreleased(actor: Actor): boolean {
  return LAB_WORKFLOW_PERMISSIONS.some((p) => actor.permissions.has(p));
}

export type ResultView = Omit<LabResultRecord, "organizationId"> & {
  enteredByName: string | null;
  verifiedByName: string | null;
  approvedByName: string | null;
  releasedByName: string | null;
};

export type SpecimenView = Omit<LabSpecimenRecord, "organizationId"> & { collectedByName: string | null; receivedByName: string | null };

export type OrderItemView = Omit<LabOrderItemRecord, "organizationId"> & {
  departmentId: string;
  specimenTypeId: string;
  resultType: string;
  unit: string | null;
  codedValues: string[];
  turnaroundMinutes: number | null;
  /** The current result. Before release it is shown only to laboratory staff. */
  result: ResultView | null;
};

export type OrderView = Omit<LabOrderRecord, "organizationId"> & {
  orderingPractitionerName: string | null;
  orderedByName: string | null;
  patient: LabPatientBrief | null;
  items: OrderItemView[];
  specimens: SpecimenView[];
};

/** Composes order, item, specimen and result views with names, applying result visibility. */
@Injectable()
export class LabReadModel {
  constructor(@Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext) {}

  async orders(executor: DbExecutor, actor: Actor, orders: LabOrderRecord[]): Promise<OrderView[]> {
    if (orders.length === 0) return [];
    const orderIds = orders.map((o) => o.id);
    const [items, specimens, results] = await Promise.all([
      executor
        .select({
          item: labOrderItem,
          departmentId: labTest.departmentId,
          specimenTypeId: labTest.specimenTypeId,
          resultType: labTest.resultType,
          unit: labTest.unit,
          codedValues: labTest.codedValues,
          turnaroundMinutes: labTest.turnaroundMinutes,
        })
        .from(labOrderItem)
        .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
        .where(inArray(labOrderItem.orderId, orderIds))
        .orderBy(asc(labTest.name)),
      executor.select().from(labSpecimen).where(inArray(labSpecimen.orderId, orderIds)).orderBy(asc(labSpecimen.collectedAt)),
      this.currentResults(executor, actor, orderIds),
    ]);
    const organizationId = actor.organizationId;
    const [patients, practitioners, staff] = await Promise.all([
      this.context.patientBriefs(organizationId, [...new Set(orders.map((o) => o.patientId))]),
      this.context.practitionerNames(organizationId, [...new Set(orders.map((o) => o.orderingPractitionerId).filter((id): id is string => !!id))]),
      this.context.staffNames(
        organizationId,
        [
          ...new Set([
            ...orders.map((o) => o.orderedBy),
            ...specimens.flatMap((s) => [s.collectedBy, s.receivedBy]),
            ...results.flatMap((r) => [r.enteredBy, r.verifiedBy, r.approvedBy, r.releasedBy]),
          ]),
        ].filter((id): id is string => !!id),
      ),
    ]);
    const resultByItem = new Map(results.map((r) => [r.orderItemId, this.resultView(r, staff)]));
    return orders.map((order) => ({
      ...publicView(order),
      orderingPractitionerName: order.orderingPractitionerId ? (practitioners.get(order.orderingPractitionerId) ?? null) : null,
      orderedByName: staff.get(order.orderedBy) ?? null,
      patient: patients.get(order.patientId) ?? null,
      items: items
        .filter((i) => i.item.orderId === order.id)
        .map(({ item, ...test }) => ({ ...publicView(item), ...test, result: resultByItem.get(item.id) ?? null })),
      specimens: specimens.filter((s) => s.orderId === order.id).map((s) => this.specimenView(s, staff)),
    }));
  }

  async results(organizationId: string, rows: LabResultRecord[]): Promise<ResultView[]> {
    const staff = await this.context.staffNames(organizationId, [
      ...new Set(rows.flatMap((r) => [r.enteredBy, r.verifiedBy, r.approvedBy, r.releasedBy]).filter((id): id is string => !!id)),
    ]);
    return rows.map((r) => this.resultView(r, staff));
  }

  resultView(r: LabResultRecord, staff: Map<string, string>): ResultView {
    const name = (id: string | null) => (id ? (staff.get(id) ?? null) : null);
    return {
      ...publicView(r),
      enteredByName: name(r.enteredBy),
      verifiedByName: name(r.verifiedBy),
      approvedByName: name(r.approvedBy),
      releasedByName: name(r.releasedBy),
    };
  }

  specimenView(s: LabSpecimenRecord, staff: Map<string, string>): SpecimenView {
    return { ...publicView(s), collectedByName: staff.get(s.collectedBy) ?? null, receivedByName: s.receivedBy ? (staff.get(s.receivedBy) ?? null) : null };
  }

  /** Current (not superseded or cancelled) results; released only, unless the actor works in the laboratory. */
  private currentResults(executor: DbExecutor, actor: Actor, orderIds: string[]): Promise<LabResultRecord[]> {
    return executor
      .select()
      .from(labResult)
      .where(
        and(
          inArray(labResult.orderId, orderIds),
          canSeeUnreleased(actor) ? notInArray(labResult.status, ["superseded", "cancelled"]) : eq(labResult.status, "released"),
        ),
      );
  }
}
