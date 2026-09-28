import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { labOrder, labOrderItem, labReportArchive, labResult, labSpecimen, labTest } from "../laboratory.schema";
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
}
