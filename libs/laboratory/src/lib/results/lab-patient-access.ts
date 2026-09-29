import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, NotFoundError, filedAsPatient } from "@healthcare/core";
import { and, asc, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { analyteKey } from "../laboratory.rules";
import { labCriticalAlert, labOrder, labOrderItem, labResult, labSpecimen, labTest } from "../laboratory.schema";

/** What a patient sees of one result: no staff names, internal comments, methods or instruments. */
export interface PatientResultView {
  id: string;
  testId: string;
  testName: string;
  orderId: string;
  orderNumber: string;
  resultType: "numeric" | "text" | "coded";
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal" | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  collectedAt: Date | null;
  releasedAt: Date | null;
  /** A later version corrected an earlier released value. */
  corrected: boolean;
  /** The reference laboratory that performed the test (null: the facility's own laboratory). */
  performingLaboratory: string | null;
}

/**
 * Laboratory results a patient may see in the portal (CLAUDE.md §17): the
 * current version, released, of a test the laboratory marks as releasable to
 * patients — and, for a critical value, only after the ordering side has
 * acknowledged it, so the patient is not the first to learn of it.
 * Not audited here: the portal endpoints audit the patient's access.
 */
@Injectable()
export class LabPatientAccess {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async results(organizationId: string, patientId: string): Promise<PatientResultView[]> {
    return this.query(and(eq(labResult.organizationId, organizationId), filedAsPatient(labResult.patientId, patientId)), 200);
  }

  /** Released values of one analyte over time (tests sharing the LOINC code line up). */
  async trend(organizationId: string, patientId: string, testId: string) {
    const [anchor] = await this.db
      .select()
      .from(labTest)
      .where(and(eq(labTest.organizationId, organizationId), eq(labTest.id, testId)));
    if (!anchor) throw new NotFoundError("Laboratory test");
    const equivalent = anchor.loincCode
      ? await this.db
          .select({ id: labTest.id })
          .from(labTest)
          .where(and(eq(labTest.organizationId, organizationId), or(eq(labTest.id, testId), eq(labTest.loincCode, anchor.loincCode))))
      : [{ id: testId }];
    const points = await this.query(
      and(
        eq(labResult.organizationId, organizationId),
        filedAsPatient(labResult.patientId, patientId),
        inArray(
          labResult.testId,
          equivalent.map((t) => t.id),
        ),
      ),
      500,
      "oldest",
    );
    return { analyte: analyteKey(anchor), testName: anchor.name, unit: anchor.unit, points };
  }

  /** The visible results of one of the patient's orders (for the patient's printed report). */
  async orderResults(organizationId: string, patientId: string, orderId: string): Promise<PatientResultView[]> {
    return this.query(
      and(eq(labResult.organizationId, organizationId), filedAsPatient(labResult.patientId, patientId), eq(labResult.orderId, orderId)),
      200,
      "oldest",
    );
  }

  /** Whether any result of this order is now visible to the patient (for "results ready" notices). */
  async orderHasVisibleResults(organizationId: string, orderId: string): Promise<boolean> {
    const rows = await this.query(and(eq(labResult.organizationId, organizationId), eq(labResult.orderId, orderId)), 1);
    return rows.length > 0;
  }

  private async query(scope: SQL | undefined, limit: number, order: "newest" | "oldest" = "newest"): Promise<PatientResultView[]> {
    const when = sql`coalesce(${labSpecimen.collectedAt}, ${labResult.releasedAt})`;
    const rows = await this.db
      .select({
        result: labResult,
        testName: labOrderItem.testName,
        orderNumber: labOrder.orderNumber,
        collectedAt: labSpecimen.collectedAt,
      })
      .from(labResult)
      .innerJoin(labOrderItem, eq(labOrderItem.id, labResult.orderItemId))
      .innerJoin(labOrder, eq(labOrder.id, labResult.orderId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labOrderItem.specimenId))
      .leftJoin(labCriticalAlert, eq(labCriticalAlert.resultId, labResult.id))
      .where(
        and(
          scope,
          eq(labResult.status, "released"),
          eq(labResult.patientReleasable, true),
          or(eq(labResult.critical, false), eq(labCriticalAlert.status, "acknowledged")),
        ),
      )
      .orderBy(order === "newest" ? desc(when) : asc(when))
      .limit(limit);
    return rows.map(({ result: r, testName, orderNumber, collectedAt }) => ({
      id: r.id,
      testId: r.testId,
      testName,
      orderId: r.orderId,
      orderNumber,
      resultType: r.resultType,
      valueNumeric: r.valueNumeric,
      valueText: r.valueText,
      valueCoded: r.valueCoded,
      unit: r.unit,
      flag: r.flag,
      refLow: r.refLow,
      refHigh: r.refHigh,
      refText: r.refText,
      collectedAt,
      releasedAt: r.releasedAt,
      corrected: r.versionNumber > 1,
      performingLaboratory: r.performingLaboratory,
    }));
  }
}
