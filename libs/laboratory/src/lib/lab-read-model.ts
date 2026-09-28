import { Inject, Injectable } from "@nestjs/common";
import type { Actor, DbExecutor } from "@healthcare/core";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import {
  labOrderItem,
  type LabOrderItemRecord,
  labReagentLoad,
  labResultReagent,
  type LabOrderRecord,
  labResult,
  type LabResultRecord,
  labSpecimen,
  type LabSpecimenRecord,
  labTest,
} from "./laboratory.schema";
import { publicView } from "./laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext, type LabPatientBrief } from "./ports";
import { attachmentsOf, type AttachmentView } from "./results/lab-result-attachments";
import { labReferenceLaboratory, labSendOut, type SendOutStatus } from "./send-outs/send-out.schema";

/** The latest send-out of a test on its current specimen (null: performed in-house, or not decided yet). */
export interface ItemSendOutView {
  id: string;
  status: SendOutStatus;
  referenceLaboratoryId: string;
  referenceLaboratoryName: string;
  dispatchedAt: Date | null;
  referenceAccession: string | null;
  resultsReceivedAt: Date | null;
  rejectionReason: string | null;
}

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
  /** Files attached to this version (pending uploads only for laboratory staff). */
  attachments: AttachmentView[];
  /** Reagent lots loaded on the instrument for the test when the result was entered. */
  reagents: Array<{ loadId: string; itemCode: string; itemName: string; lotNumber: string | null; expiryDate: string | null }>;
};

export type SpecimenView = Omit<LabSpecimenRecord, "organizationId"> & { collectedByName: string | null; receivedByName: string | null };

export type OrderItemView = Omit<LabOrderItemRecord, "organizationId"> & {
  departmentId: string;
  specimenTypeId: string;
  resultType: string;
  unit: string | null;
  codedValues: string[];
  turnaroundMinutes: number | null;
  sendOut: ItemSendOutView | null;
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
    const [items, specimens, results, sendOuts] = await Promise.all([
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
      executor
        .select({ sendOut: labSendOut, name: labReferenceLaboratory.name })
        .from(labSendOut)
        .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labSendOut.referenceLaboratoryId))
        .where(inArray(labSendOut.orderId, orderIds))
        .orderBy(asc(labSendOut.preparedAt)),
    ]);
    // Latest send-out per test and specimen (later rows win).
    const sendOutByItem = new Map<string, ItemSendOutView>();
    for (const { sendOut: so, name } of sendOuts) {
      sendOutByItem.set(`${so.orderItemId}:${so.specimenId}`, {
        id: so.id,
        status: so.status,
        referenceLaboratoryId: so.referenceLaboratoryId,
        referenceLaboratoryName: name,
        dispatchedAt: so.dispatchedAt,
        referenceAccession: so.referenceAccession,
        resultsReceivedAt: so.resultsReceivedAt,
        rejectionReason: so.rejectionReason,
      });
    }
    const organizationId = actor.organizationId;
    const [patients, practitioners, staff, reagents] = await Promise.all([
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
      this.reagentsOn(
        executor,
        results.map((r) => r.id),
      ),
    ]);
    const attachments = await attachmentsOf(
      executor,
      actor,
      results.map((r) => r.id),
    );
    const resultByItem = new Map(results.map((r) => [r.orderItemId, this.resultView(r, staff, attachments.get(r.id), reagents.get(r.id))]));
    return orders.map((order) => ({
      ...publicView(order),
      orderingPractitionerName: order.orderingPractitionerId ? (practitioners.get(order.orderingPractitionerId) ?? null) : null,
      orderedByName: staff.get(order.orderedBy) ?? null,
      patient: patients.get(order.patientId) ?? null,
      items: items
        .filter((i) => i.item.orderId === order.id)
        .map(({ item, ...test }) => {
          const sendOut = item.specimenId ? (sendOutByItem.get(`${item.id}:${item.specimenId}`) ?? null) : null;
          return { ...publicView(item), ...test, sendOut, result: resultByItem.get(item.id) ?? null };
        }),
      specimens: specimens.filter((s) => s.orderId === order.id).map((s) => this.specimenView(s, staff)),
    }));
  }

  /** Result views with names, attachments and reagent lots; pass the transaction when the rows were just written in it. */
  async results(executor: DbExecutor, actor: Actor, rows: LabResultRecord[]): Promise<ResultView[]> {
    const [staff, attachments, reagents] = await Promise.all([
      this.context.staffNames(actor.organizationId, [
        ...new Set(rows.flatMap((r) => [r.enteredBy, r.verifiedBy, r.approvedBy, r.releasedBy]).filter((id): id is string => !!id)),
      ]),
      attachmentsOf(
        executor,
        actor,
        rows.map((r) => r.id),
      ),
      this.reagentsOn(
        executor,
        rows.map((r) => r.id),
      ),
    ]);
    return rows.map((r) => this.resultView(r, staff, attachments.get(r.id), reagents.get(r.id)));
  }

  resultView(r: LabResultRecord, staff: Map<string, string>, attachments: AttachmentView[] = [], reagents: ResultView["reagents"] = []): ResultView {
    const name = (id: string | null) => (id ? (staff.get(id) ?? null) : null);
    return {
      ...publicView(r),
      enteredByName: name(r.enteredBy),
      verifiedByName: name(r.verifiedBy),
      approvedByName: name(r.approvedBy),
      releasedByName: name(r.releasedBy),
      attachments,
      reagents,
    };
  }

  specimenView(s: LabSpecimenRecord, staff: Map<string, string>): SpecimenView {
    return { ...publicView(s), collectedByName: staff.get(s.collectedBy) ?? null, receivedByName: s.receivedBy ? (staff.get(s.receivedBy) ?? null) : null };
  }

  private async reagentsOn(executor: DbExecutor, resultIds: string[]): Promise<Map<string, ResultView["reagents"]>> {
    const map = new Map<string, ResultView["reagents"]>();
    if (resultIds.length === 0) return map;
    const rows = await executor
      .select({ resultId: labResultReagent.resultId, load: labReagentLoad })
      .from(labResultReagent)
      .innerJoin(labReagentLoad, eq(labReagentLoad.id, labResultReagent.reagentLoadId))
      .where(inArray(labResultReagent.resultId, resultIds));
    for (const { resultId, load } of rows) {
      map.set(resultId, [
        ...(map.get(resultId) ?? []),
        { loadId: load.id, itemCode: load.itemCode, itemName: load.itemName, lotNumber: load.lotNumber, expiryDate: load.expiryDate },
      ]);
    }
    return map;
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
