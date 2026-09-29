import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, timelineFacility, timelineInstant, timelineRange, type TimelineWindow } from "@healthcare/core";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { labCriticalAlert, labOrder, labOrderItem, labReportArchive, labResult, labSpecimen, labTest } from "../laboratory.schema";
import { labReferenceLaboratory } from "../send-outs/send-out.schema";

/**
 * A patient's laboratory record for a record export (FHIR): every order with its
 * tests and, per test, the current released result only. Unreleased and
 * superseded versions never leave the laboratory this way. A result performed
 * by a reference laboratory (send-out) carries that laboratory's name as
 * attributed on the result and its recorded accreditation reference. Not
 * audited here: the caller audits the access it serves.
 */
@Injectable()
export class LabRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async patientRecord(organizationId: string, patientId: string) {
    const orders = await this.db
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.patientId, patientId)))
      .orderBy(asc(labOrder.orderedAt));
    if (orders.length === 0) return [];
    const orderIds = orders.map((o) => o.id);
    const [items, results] = await Promise.all([
      this.db
        .select({ item: labOrderItem, loincCode: labTest.loincCode })
        .from(labOrderItem)
        .innerJoin(labTest, eq(labTest.id, labOrderItem.testId))
        .where(and(eq(labOrderItem.organizationId, organizationId), inArray(labOrderItem.orderId, orderIds)))
        .orderBy(asc(labOrderItem.testName)),
      this.db
        .select({ result: labResult, collectedAt: labSpecimen.collectedAt, referenceLabAccreditation: labReferenceLaboratory.accreditationReference })
        .from(labResult)
        .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
        .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
        .leftJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labResult.referenceLaboratoryId))
        .where(and(eq(labResult.organizationId, organizationId), inArray(labResult.orderId, orderIds), eq(labResult.status, "released"))),
    ]);
    const resultByItem = new Map(
      results.map((r) => [
        r.result.orderItemId,
        {
          ...r.result,
          collectedAt: r.collectedAt,
          referenceLaboratory:
            r.result.referenceLaboratoryId && r.result.performingLaboratory
              ? { id: r.result.referenceLaboratoryId, name: r.result.performingLaboratory, accreditationReference: r.referenceLabAccreditation ?? null }
              : null,
        },
      ]),
    );
    return orders.map((order) => ({
      ...order,
      items: items.filter((i) => i.item.orderId === order.id).map(({ item, loincCode }) => ({ ...item, loincCode, result: resultByItem.get(item.id) ?? null })),
    }));
  }

  /** The patient's stored report archives (versions of each order's report and the documents holding them), oldest first. */
  async reportArchives(
    organizationId: string,
    patientId: string,
  ): Promise<Array<{ orderId: string; documentId: string; archiveVersion: number; storedAt: Date }>> {
    const rows = await this.db
      .select({
        orderId: labReportArchive.orderId,
        documentId: labReportArchive.documentId,
        archiveVersion: labReportArchive.archiveVersion,
        storedAt: labReportArchive.storedAt,
      })
      .from(labReportArchive)
      .where(and(eq(labReportArchive.organizationId, organizationId), eq(labReportArchive.patientId, patientId), eq(labReportArchive.status, "stored")))
      .orderBy(asc(labReportArchive.orderId), asc(labReportArchive.archiveVersion));
    return rows.flatMap((r) =>
      r.documentId && r.storedAt ? [{ orderId: r.orderId, documentId: r.documentId, archiveVersion: r.archiveVersion, storedAt: r.storedAt }] : [],
    );
  }

  // ---- Patient 360 workspace (composed in apps/api) ------------------------------------------------------------

  /**
   * Critical results of the patient not yet acknowledged by the care team (open or communicated), oldest first, at
   * any facility: test, order and when raised — never the value (the laboratory's critical-results screen shows it).
   */
  unacknowledgedCriticalAlerts(organizationId: string, patientId: string, limit: number) {
    return this.db
      .select({
        id: labCriticalAlert.id,
        facilityId: labCriticalAlert.facilityId,
        status: labCriticalAlert.status,
        raisedAt: labCriticalAlert.raisedAt,
        orderId: labResult.orderId,
        orderNumber: labOrder.orderNumber,
        testName: labOrderItem.testName,
      })
      .from(labCriticalAlert)
      .innerJoin(labResult, eq(labResult.id, labCriticalAlert.resultId))
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .innerJoin(labOrder, eq(labOrder.id, labResult.orderId))
      .where(and(eq(labCriticalAlert.organizationId, organizationId), eq(labCriticalAlert.patientId, patientId), ne(labCriticalAlert.status, "acknowledged")))
      .orderBy(asc(labCriticalAlert.raisedAt), asc(labCriticalAlert.id))
      .limit(limit);
  }

  /**
   * The patient's open laboratory orders (not completed or cancelled), latest first: number, priority, when ordered,
   * the encounter and each test's name and status — no clinical indication or notes.
   */
  async openOrders(organizationId: string, patientId: string, limit: number) {
    const orders = await this.db
      .select({
        id: labOrder.id,
        facilityId: labOrder.facilityId,
        orderNumber: labOrder.orderNumber,
        priority: labOrder.priority,
        status: labOrder.status,
        orderedAt: labOrder.orderedAt,
        encounterId: labOrder.encounterId,
      })
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.patientId, patientId), eq(labOrder.status, "active")))
      .orderBy(desc(labOrder.orderedAt), desc(labOrder.id))
      .limit(limit);
    if (orders.length === 0) return [];
    const items = await this.db
      .select({ id: labOrderItem.id, orderId: labOrderItem.orderId, testName: labOrderItem.testName, status: labOrderItem.status })
      .from(labOrderItem)
      .where(
        and(
          eq(labOrderItem.organizationId, organizationId),
          inArray(
            labOrderItem.orderId,
            orders.map((o) => o.id),
          ),
        ),
      )
      .orderBy(asc(labOrderItem.testName));
    return orders.map((o) => ({ ...o, tests: items.filter((i) => i.orderId === o.id).map(({ orderId: _orderId, ...i }) => i) }));
  }

  // ---- Patient timeline (composed in apps/api) ----------------------------------------------------------------

  /**
   * Laboratory orders for the patient timeline, when ordered: number, status, priority, encounter and the names of
   * the tests (no clinical indication or notes). Cancelled orders are included with their status. Not audited here.
   */
  timelineOrders(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = labOrder.orderedAt;
    return this.db
      .select({
        id: labOrder.id,
        at: timelineInstant(at),
        facilityId: labOrder.facilityId,
        orderNumber: labOrder.orderNumber,
        status: labOrder.status,
        priority: labOrder.priority,
        encounterId: labOrder.encounterId,
        // The outer table is named literally: Drizzle leaves columns unqualified in a single-table select.
        tests: sql<string[]>`coalesce((SELECT array_agg(i.test_name ORDER BY i.test_name) FROM ${labOrderItem} i WHERE i.order_id = lab_order.id), '{}')`,
      })
      .from(labOrder)
      .where(
        and(
          eq(labOrder.organizationId, organizationId),
          eq(labOrder.patientId, patientId),
          timelineFacility(labOrder.facilityId, window),
          timelineRange("lab_order", at, labOrder.id, window),
        ),
      )
      .orderBy(desc(at), desc(labOrder.id))
      .limit(window.limit);
  }

  /**
   * Releases of laboratory results for the patient timeline: one row per release of an order's results (the result
   * versions one person released in the same second — releasing an order is one transaction), identified by its
   * first result version. Test names and counts, whether any result was abnormal or critical and whether it was a
   * correction — never values. A release whose results were all corrected later is `superseded`. Not audited here.
   */
  timelineReleases(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = sql`min(${labResult.releasedAt})`;
    const id = sql`(array_agg(${labResult.id} ORDER BY ${labResult.id}))[1]`;
    return this.db
      .select({
        id: sql<string>`${id}`,
        at: timelineInstant(at),
        orderId: labResult.orderId,
        facilityId: labResult.facilityId,
        orderNumber: labOrder.orderNumber,
        encounterId: labOrder.encounterId,
        tests: sql<string[]>`array_agg(${labOrderItem.testName} ORDER BY ${labOrderItem.testName})`,
        abnormal: sql<boolean>`coalesce(bool_or(${labResult.flag} IS NOT NULL AND ${labResult.flag} <> 'normal'), false)`,
        critical: sql<boolean>`bool_or(${labResult.critical})`,
        correction: sql<boolean>`bool_or(${labResult.versionNumber} > 1)`,
        superseded: sql<boolean>`bool_and(${labResult.status} = 'superseded')`,
      })
      .from(labResult)
      .innerJoin(labOrder, eq(labOrder.id, labResult.orderId))
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .where(
        and(
          eq(labResult.organizationId, organizationId),
          eq(labResult.patientId, patientId),
          isNotNull(labResult.releasedAt),
          timelineFacility(labResult.facilityId, window),
        ),
      )
      .groupBy(
        labResult.orderId,
        labResult.facilityId,
        labOrder.orderNumber,
        labOrder.encounterId,
        labResult.releasedBy,
        sql`date_trunc('second', ${labResult.releasedAt})`,
      )
      .having(timelineRange("lab_result_release", at, id, window))
      .orderBy(desc(at), desc(id))
      .limit(window.limit);
  }
}
