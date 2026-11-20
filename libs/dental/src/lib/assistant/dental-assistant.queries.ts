import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { type ChartEffect, dentalProcedure, dentalProcedureType, type Notation, type ToothCondition } from "../dental.schema";
import type { DentalPlanInput } from "./dental-plan.rules";

/**
 * The dental side of the assistant's `billing.uncharged-work` rule: procedures performed at a facility in a period and
 * not entered in error at a moment, with the procedure type's code (what billing maps a service to). Ids, codes and
 * times only; the API composes them with billing's charge state and audits the request.
 */
@Injectable()
export class DentalAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async proceduresPerformed(organizationId: string, facilityId: string, from: Date, to: Date, asOf: Date) {
    return this.db
      .select({ id: dentalProcedure.id, code: dentalProcedureType.code, name: dentalProcedureType.name, performedAt: dentalProcedure.performedAt })
      .from(dentalProcedure)
      .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
      .where(
        and(
          eq(dentalProcedure.organizationId, organizationId),
          eq(dentalProcedure.facilityId, facilityId),
          gte(dentalProcedure.performedAt, from),
          lte(dentalProcedure.performedAt, to),
          or(isNull(dentalProcedure.enteredInErrorAt), gt(dentalProcedure.enteredInErrorAt, asOf)),
        ),
      );
  }

  /**
   * `dental.chart-consistency` and `dental.plan-decisions`: for the given patients (their plans at any facility), or, with
   * none given (a replay), those with an open plan at the facility at the moment (its plans only): the chart at the moment
   * — each tooth's latest state from records not entered in error by then — and the plans still open (proposed, accepted,
   * in progress) with their items still to do, added by then. Plan and item statuses are read as they are now (they keep
   * no history). Procedure names, teeth and dates only, never notes.
   */
  async planInputs(organizationId: string, window: { facilityId: string; asOf: Date; patientIds?: string[] }): Promise<DentalPlanInput[]> {
    const at = window.asOf.toISOString();
    const patients =
      window.patientIds ??
      (
        await this.db.execute<{ patient_id: string }>(sql`
          SELECT DISTINCT patient_canonical_id(t.patient_id) AS patient_id
          FROM dental_treatment_plan t
          WHERE t.organization_id = ${organizationId}::uuid AND t.facility_id = ${window.facilityId}::uuid
            AND t.status IN ('proposed', 'accepted', 'in_progress') AND t.created_at <= ${at}::timestamptz
          LIMIT 200
        `)
      ).rows.map((r) => r.patient_id);
    if (patients.length === 0) return [];
    const { rows: setting } = await this.db.execute<{ notation: Notation }>(sql`
      SELECT notation FROM dental_facility_setting WHERE organization_id = ${organizationId}::uuid AND facility_id = ${window.facilityId}::uuid
    `);
    const notation = setting[0]?.notation ?? "fdi";
    const out: DentalPlanInput[] = [];
    for (const patientId of patients) {
      const { rows: plans } = await this.db.execute<{
        plan_id: string;
        title: string;
        item_id: string;
        procedure_name: string;
        chart_effect: ChartEffect | null;
        tooth: string | null;
        status: "proposed" | "accepted";
        created_at: string;
      }>(sql`
        SELECT t.id AS plan_id, t.title, i.id AS item_id, pt.name AS procedure_name, pt.chart_effect, i.tooth, i.status,
               to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM dental_treatment_plan t
        JOIN dental_treatment_plan_item i ON i.plan_id = t.id
        JOIN dental_procedure_type pt ON pt.id = i.procedure_type_id
        WHERE t.organization_id = ${organizationId}::uuid
          AND t.patient_id = ANY(patient_record_ids(${patientId}::uuid))
          AND ${window.patientIds ? sql`TRUE` : sql`t.facility_id = ${window.facilityId}::uuid`}
          AND t.status IN ('proposed', 'accepted', 'in_progress') AND t.created_at <= ${at}::timestamptz
          AND i.status IN ('proposed', 'accepted')
          AND i.created_at <= ${at}::timestamptz
        ORDER BY t.created_at, i.phase, i.created_at
      `);
      if (plans.length === 0) continue;
      const { rows: chart } = await this.db.execute<{ tooth: string; recorded_at: string; conditions: ToothCondition[] | null }>(sql`
        SELECT latest.tooth, to_char(latest.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
               array_agg(f.condition) FILTER (WHERE f.condition IS NOT NULL) AS conditions
        FROM (
          SELECT DISTINCT ON (s.tooth) s.id, s.tooth, s.recorded_at
          FROM dental_tooth_state s
          LEFT JOIN dental_examination e ON e.id = s.examination_id
          LEFT JOIN dental_procedure p ON p.id = s.procedure_id
          WHERE s.organization_id = ${organizationId}::uuid
            AND s.patient_id = ANY(patient_record_ids(${patientId}::uuid))
            AND s.recorded_at <= ${at}::timestamptz
            AND (coalesce(e.entered_in_error_at, p.entered_in_error_at) IS NULL OR coalesce(e.entered_in_error_at, p.entered_in_error_at) > ${at}::timestamptz)
          ORDER BY s.tooth, s.sequence DESC
        ) latest
        LEFT JOIN dental_tooth_finding f ON f.state_id = latest.id
        GROUP BY latest.tooth, latest.recorded_at
      `);
      const byPlan = new Map<string, DentalPlanInput["plans"][number]>();
      for (const row of plans) {
        const plan = byPlan.get(row.plan_id) ?? { planId: row.plan_id, title: row.title, items: [] };
        plan.items.push({
          itemId: row.item_id,
          procedureName: row.procedure_name,
          chartEffect: row.chart_effect,
          tooth: row.tooth,
          status: row.status,
          createdAt: row.created_at,
        });
        byPlan.set(row.plan_id, plan);
      }
      out.push({
        patientId,
        notation,
        chart: chart.map((t) => ({ tooth: t.tooth, conditions: t.conditions ?? [], recordedAt: t.recorded_at })),
        plans: [...byPlan.values()],
      });
    }
    return out;
  }
}
