import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";
import type { DeltaCheckInput, PendingStage } from "./delta-check.rules";

/**
 * What `laboratory.delta-check` reads at a facility and a moment: numeric results entered but not yet released (nor
 * cancelled or superseded) at that moment, each with the same patient's last released numeric result of the same test
 * (records merged into theirs included) before it was entered. Order numbers, test names, values and units only —
 * never a patient's details; the API audits the request.
 */
@Injectable()
export class LabAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async deltaInputs(organizationId: string, facilityId: string, asOf: Date, lookbackDays: number): Promise<DeltaCheckInput[]> {
    const at = asOf.toISOString();
    const { rows } = await this.db.execute<{
      result_id: string;
      order_number: string;
      test_name: string;
      unit: string | null;
      value: string;
      verified: boolean;
      approved: boolean;
      prev_value: string | null;
      prev_unit: string | null;
      prev_released_at: string | null;
    }>(sql`
      SELECT r.id AS result_id, o.order_number, t.name AS test_name, r.unit, r.value_numeric AS value,
             (r.verified_at IS NOT NULL AND r.verified_at <= ${at}::timestamptz) AS verified,
             (r.approved_at IS NOT NULL AND r.approved_at <= ${at}::timestamptz) AS approved,
             p.value_numeric AS prev_value, p.unit AS prev_unit, to_char(p.released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prev_released_at
      FROM lab_result r
      JOIN lab_order o ON o.id = r.order_id
      JOIN lab_test t ON t.id = r.test_id
      LEFT JOIN LATERAL (
        SELECT prev.value_numeric, prev.unit, prev.released_at
        FROM lab_result prev
        WHERE prev.organization_id = r.organization_id
          AND prev.test_id = r.test_id
          AND prev.order_id <> r.order_id
          AND prev.value_numeric IS NOT NULL
          AND prev.released_at IS NOT NULL
          AND prev.released_at < r.entered_at
          AND prev.released_at >= r.entered_at - make_interval(days => ${lookbackDays})
          AND (prev.superseded_at IS NULL OR prev.superseded_at > r.entered_at)
          AND patient_canonical_id(prev.patient_id) = patient_canonical_id(r.patient_id)
        ORDER BY prev.released_at DESC
        LIMIT 1
      ) p ON true
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.facility_id = ${facilityId}::uuid
        AND r.value_numeric IS NOT NULL
        AND r.entered_at <= ${at}::timestamptz
        AND (r.released_at IS NULL OR r.released_at > ${at}::timestamptz)
        AND (r.cancelled_at IS NULL OR r.cancelled_at > ${at}::timestamptz)
        AND (r.superseded_at IS NULL OR r.superseded_at > ${at}::timestamptz)
      ORDER BY r.entered_at
    `);
    return rows.map((row) => {
      const stage: PendingStage = row.approved ? "approved" : row.verified ? "verified" : "entered";
      return {
        resultId: row.result_id,
        orderNumber: row.order_number,
        testName: row.test_name,
        unit: row.unit,
        value: Number(row.value),
        stage,
        previous:
          row.prev_value !== null && row.prev_released_at ? { value: Number(row.prev_value), unit: row.prev_unit, releasedAt: row.prev_released_at } : null,
      };
    });
  }

  /** `laboratory.order-sets`: tests ordered in a consultation by a moment, cancelled ones left out (ids only). */
  async orderedTestIds(organizationId: string, encounterId: string, asOf: Date): Promise<string[]> {
    const { rows } = await this.db.execute<{ test_id: string }>(sql`
      SELECT DISTINCT i.test_id
      FROM lab_order_item i
      JOIN lab_order o ON o.id = i.order_id
      WHERE o.organization_id = ${organizationId}::uuid
        AND o.encounter_id = ${encounterId}::uuid
        AND o.ordered_at <= ${asOf.toISOString()}::timestamptz
        AND (o.cancelled_at IS NULL OR o.cancelled_at > ${asOf.toISOString()}::timestamptz)
        AND (i.cancelled_at IS NULL OR i.cancelled_at > ${asOf.toISOString()}::timestamptz)
    `);
    return rows.map((r) => r.test_id);
  }
}
