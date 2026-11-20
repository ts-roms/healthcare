import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";
import type { DeltaCheckInput, PendingStage } from "./delta-check.rules";
import type { OpenLabItem, QcSeries, TurnaroundInput } from "./lab-quality.rules";

/**
 * What the laboratory's assistant rules read at a facility and a moment, each rebuilt from timestamps. `laboratory.delta-check`: numeric results entered but not yet released (nor
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

  /**
   * `laboratory.turnaround-risk`: order items at the facility collected in the window and still open at `asOf` (not
   * released, cancelled or rejected then), each with the stage it waited at; the median collection-to-release time of
   * their tests' first releases in the window, per priority class and overall; and the catalog targets. No patient.
   */
  async turnaroundInputs(organizationId: string, facilityId: string, window: { asOf: Date; lookbackDays: number }): Promise<TurnaroundInput> {
    const at = window.asOf.toISOString();
    const from = new Date(window.asOf.getTime() - window.lookbackDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{
      item_id: string;
      order_number: string;
      test_id: string;
      test_name: string;
      stat: boolean;
      collected_at: string;
      received: boolean;
      entered: boolean;
      verified: boolean;
      approved: boolean;
    }>(sql`
      SELECT i.id AS item_id, o.order_number, i.test_id, i.test_name, (o.priority = 'stat') AS stat,
             to_char(s.collected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS collected_at,
             (s.received_at IS NOT NULL AND s.received_at <= ${at}::timestamptz) AS received,
             (r.id IS NOT NULL) AS entered,
             (r.verified_at IS NOT NULL AND r.verified_at <= ${at}::timestamptz) AS verified,
             (r.approved_at IS NOT NULL AND r.approved_at <= ${at}::timestamptz) AS approved
      FROM lab_order_item i
      JOIN lab_order o ON o.id = i.order_id
      JOIN lab_specimen s ON s.id = i.specimen_id
      LEFT JOIN LATERAL (
        SELECT x.id, x.verified_at, x.approved_at
        FROM lab_result x
        WHERE x.order_item_id = i.id AND x.entered_at <= ${at}::timestamptz AND (x.cancelled_at IS NULL OR x.cancelled_at > ${at}::timestamptz)
        ORDER BY x.version_number DESC
        LIMIT 1
      ) r ON true
      WHERE o.organization_id = ${organizationId}::uuid
        AND o.facility_id = ${facilityId}::uuid
        AND s.collected_at > ${from}::timestamptz AND s.collected_at <= ${at}::timestamptz
        AND (s.rejected_at IS NULL OR s.rejected_at > ${at}::timestamptz)
        AND (i.cancelled_at IS NULL OR i.cancelled_at > ${at}::timestamptz)
        AND (o.cancelled_at IS NULL OR o.cancelled_at > ${at}::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM lab_result y WHERE y.order_item_id = i.id AND y.released_at IS NOT NULL AND y.released_at <= ${at}::timestamptz
        )
      ORDER BY s.collected_at
      LIMIT 500
    `);
    if (rows.length === 0) return { items: [], usual: [], targets: [] };
    const items: OpenLabItem[] = rows.map((r) => ({
      orderItemId: r.item_id,
      orderNumber: r.order_number,
      testId: r.test_id,
      testName: r.test_name,
      stat: r.stat,
      collectedAt: r.collected_at,
      stage: !r.received ? "receive" : !r.entered ? "enter" : r.approved ? "release" : r.verified ? "approve" : "verify",
    }));
    const tests = [...new Set(items.map((i) => i.testId))];
    const median = sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.released_at - s.collected_at) / 60)`;
    const released = sql`
      FROM lab_result r
      JOIN lab_order o ON o.id = r.order_id
      JOIN lab_order_item i ON i.id = r.order_item_id
      JOIN lab_specimen s ON s.id = i.specimen_id
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.facility_id = ${facilityId}::uuid
        AND r.version_number = 1
        AND r.test_id = ANY(${sql.param(tests)}::uuid[])
        AND r.released_at > ${from}::timestamptz AND r.released_at <= ${at}::timestamptz
        AND r.released_at >= s.collected_at`;
    const { rows: byPriority } = await this.db.execute<{ test_id: string; stat: boolean; releases: number; median: number }>(sql`
      SELECT r.test_id, (o.priority = 'stat') AS stat, count(*)::int AS releases, ${median} AS median ${released}
      GROUP BY r.test_id, (o.priority = 'stat')
    `);
    const { rows: overall } = await this.db.execute<{ test_id: string; releases: number; median: number }>(sql`
      SELECT r.test_id, count(*)::int AS releases, ${median} AS median ${released}
      GROUP BY r.test_id
    `);
    const { rows: targets } = await this.db.execute<{ id: string; minutes: number }>(sql`
      SELECT id, turnaround_minutes AS minutes FROM lab_test WHERE id = ANY(${sql.param(tests)}::uuid[]) AND turnaround_minutes IS NOT NULL
    `);
    return {
      items,
      usual: [
        ...byPriority.map((u) => ({ testId: u.test_id, stat: u.stat, medianMinutes: Number(u.median), releases: Number(u.releases) })),
        ...overall.map((u) => ({ testId: u.test_id, stat: null, medianMinutes: Number(u.median), releases: Number(u.releases) })),
      ],
      targets: targets.map((t) => ({ testId: t.id, minutes: Number(t.minutes) })),
    };
  }

  /**
   * `laboratory.qc-trend`: the facility's QC runs in the window up to `asOf`, entered by then, grouped per instrument,
   * test and control lot, oldest first, at most `maxRuns` each, with the names a person reads.
   */
  async qcSeries(organizationId: string, facilityId: string, window: { asOf: Date; lookbackDays: number; maxRuns: number }): Promise<QcSeries[]> {
    const at = window.asOf.toISOString();
    const from = new Date(window.asOf.getTime() - window.lookbackDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{
      instrument_id: string;
      instrument_name: string;
      test_id: string;
      test_name: string;
      qc_lot_id: string;
      material_name: string;
      level: string;
      lot_number: string;
      run_at: string;
      z_score: string;
      status: "accepted" | "warning" | "rejected";
    }>(sql`
      SELECT q.instrument_id, ins.name AS instrument_name, q.test_id, t.name AS test_name, q.qc_lot_id,
             m.name AS material_name, m.level, l.lot_number,
             to_char(q.run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS run_at, q.z_score, q.status
      FROM lab_qc_run q
      JOIN lab_instrument ins ON ins.id = q.instrument_id
      JOIN lab_test t ON t.id = q.test_id
      JOIN lab_qc_lot l ON l.id = q.qc_lot_id
      JOIN lab_qc_material m ON m.id = l.material_id
      WHERE q.organization_id = ${organizationId}::uuid
        AND q.facility_id = ${facilityId}::uuid
        AND q.run_at > ${from}::timestamptz AND q.run_at <= ${at}::timestamptz
        AND q.entered_at <= ${at}::timestamptz
      ORDER BY q.instrument_id, q.test_id, q.qc_lot_id, q.run_at, q.entered_at
    `);
    const series = new Map<string, QcSeries>();
    for (const r of rows) {
      const key = `${r.instrument_id}:${r.test_id}:${r.qc_lot_id}`;
      const current = series.get(key) ?? {
        instrumentId: r.instrument_id,
        instrumentName: r.instrument_name,
        testId: r.test_id,
        testName: r.test_name,
        qcLotId: r.qc_lot_id,
        materialName: r.material_name,
        level: r.level,
        lotNumber: r.lot_number,
        runs: [],
      };
      current.runs.push({ runAt: r.run_at, z: Number(r.z_score), status: r.status });
      series.set(key, current);
    }
    return [...series.values()].map((s) => ({ ...s, runs: s.runs.slice(-window.maxRuns) }));
  }

  /**
   * `laboratory.rejection-rate`: specimens collected at the facility in the window up to `asOf` per staff account that
   * collected them, and those rejected by then; the organization's other facilities together (null without any). Counts
   * only — never a patient or a rejection's reason. The API adds the names.
   */
  async rejectionFigures(
    organizationId: string,
    facilityId: string,
    window: { asOf: Date; windowDays: number },
  ): Promise<{ collectors: Array<{ userId: string; collected: number; rejected: number }>; others: { collected: number; rejected: number } | null }> {
    const at = window.asOf.toISOString();
    const from = new Date(window.asOf.getTime() - window.windowDays * 86_400_000).toISOString();
    const rejected = sql`count(*) FILTER (WHERE s.rejected_at IS NOT NULL AND s.rejected_at <= ${at}::timestamptz)::int`;
    const { rows: collectors } = await this.db.execute<{ user_id: string; collected: number; rejected: number }>(sql`
      SELECT s.collected_by AS user_id, count(*)::int AS collected, ${rejected} AS rejected
      FROM lab_specimen s
      WHERE s.organization_id = ${organizationId}::uuid AND s.facility_id = ${facilityId}::uuid
        AND s.collected_at > ${from}::timestamptz AND s.collected_at <= ${at}::timestamptz
      GROUP BY s.collected_by
    `);
    const { rows: others } = await this.db.execute<{ facilities: number; collected: number; rejected: number }>(sql`
      SELECT count(DISTINCT s.facility_id)::int AS facilities, count(*)::int AS collected, ${rejected} AS rejected
      FROM lab_specimen s
      WHERE s.organization_id = ${organizationId}::uuid AND s.facility_id <> ${facilityId}::uuid
        AND s.collected_at > ${from}::timestamptz AND s.collected_at <= ${at}::timestamptz
    `);
    const rest = others[0];
    return {
      collectors: collectors.map((c) => ({ userId: c.user_id, collected: Number(c.collected), rejected: Number(c.rejected) })),
      others: rest && Number(rest.facilities) > 0 ? { collected: Number(rest.collected), rejected: Number(rest.rejected) } : null,
    };
  }

  /** `laboratory.monitoring-gap`: the patient's latest release of each test (records linked to theirs included) before `asOf`. */
  async lastReleases(organizationId: string, patientId: string, testIds: string[], asOf: Date): Promise<Array<{ testId: string; releasedAt: string }>> {
    if (testIds.length === 0) return [];
    const { rows } = await this.db.execute<{ test_id: string; released_at: string }>(sql`
      SELECT r.test_id, to_char(max(r.released_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS released_at
      FROM lab_result r
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.patient_id = ANY(patient_record_ids(${patientId}::uuid))
        AND r.test_id = ANY(${sql.param(testIds)}::uuid[])
        AND r.released_at IS NOT NULL AND r.released_at <= ${asOf.toISOString()}::timestamptz
      GROUP BY r.test_id
    `);
    return rows.map((r) => ({ testId: r.test_id, releasedAt: r.released_at }));
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
