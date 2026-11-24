import { Inject, Injectable } from "@nestjs/common";
import { canonicalPatientId, DATABASE, type Database } from "@healthcare/core";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { appointment, visit, visitType } from "../clinic.schema";
import { clinicProcedure } from "../procedures/procedure.schema";
import type { NoShowRiskInput } from "./no-show-risk.rules";
import type { QueueWaitInput } from "./queue-wait.rules";

/**
 * The figures the clinic's assistant rules read, at one facility and one moment. Each state is rebuilt from its
 * timestamps (booked, confirmed, cancelled, checked in, called), so a past moment reads what was true then. Counts and
 * minutes only, never a patient's details; the API audits the assistant request.
 */
@Injectable()
export class ClinicAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `clinic.no-show-risk`: appointments starting in [dayStart, dayEnd) not yet checked in at `asOf`, with their patients' attendance. */
  async noShowInputs(
    organizationId: string,
    facilityId: string,
    window: { dayStart: Date; dayEnd: Date; date: string; asOf: Date; historyDays: number },
  ): Promise<NoShowRiskInput[]> {
    const { asOf } = window;
    const day = await this.db
      .select({
        id: appointment.id,
        startsAt: appointment.startsAt,
        confirmedAt: appointment.confirmedAt,
        canonical: canonicalPatientId(appointment.patientId),
      })
      .from(appointment)
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          eq(appointment.facilityId, facilityId),
          gte(appointment.startsAt, window.dayStart),
          lt(appointment.startsAt, window.dayEnd),
          gte(appointment.startsAt, asOf),
          lte(appointment.createdAt, asOf),
          or(isNull(appointment.cancelledAt), gt(appointment.cancelledAt, asOf)),
          or(isNull(appointment.checkedInAt), gt(appointment.checkedInAt, asOf)),
          or(isNull(appointment.noShowAt), gt(appointment.noShowAt, asOf)),
        ),
      );
    if (day.length === 0) return [];
    const patients = [...new Set(day.map((a) => a.canonical))];
    const since = new Date(asOf.getTime() - window.historyDays * 86_400_000);
    const canonical = canonicalPatientId(appointment.patientId);
    const history = await this.db
      .select({
        canonical,
        attended: sql<number>`count(*) filter (where ${appointment.checkedInAt} is not null and ${appointment.checkedInAt} <= ${asOf.toISOString()}::timestamptz)::int`,
        missed: sql<number>`count(*) filter (where ${appointment.noShowAt} is not null and ${appointment.noShowAt} <= ${asOf.toISOString()}::timestamptz)::int`,
      })
      .from(appointment)
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          gte(appointment.startsAt, since),
          lt(appointment.startsAt, asOf),
          sql`${canonical} = ANY(${sql.param(patients)}::uuid[])`,
        ),
      )
      .groupBy(sql`1`);
    const byPatient = new Map(history.map((h) => [h.canonical, h]));
    return day.map((a) => ({
      appointmentId: a.id,
      startsAt: a.startsAt.toISOString(),
      date: window.date,
      confirmed: a.confirmedAt !== null && a.confirmedAt <= asOf,
      attended: byPatient.get(a.canonical)?.attended ?? 0,
      missed: byPatient.get(a.canonical)?.missed ?? 0,
    }));
  }

  /**
   * `crm.audience-ideas`: how long the organization's patients take to come back — the gaps between one patient's
   * completed consultations (linked records counted as one patient) started in the `lookbackDays` before `asOf`, in
   * days, and the gap `fraction` of them fall within. Gaps under a day (two consultations the same day) are left out.
   */
  async returnFigures(
    organizationId: string,
    window: { asOf: Date; lookbackDays: number; fraction: number },
  ): Promise<{ returns: number; days: number | null }> {
    const asOf = window.asOf.toISOString();
    const from = new Date(window.asOf.getTime() - window.lookbackDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{ returns: number; days: number | null }>(sql`
      SELECT count(*)::int AS returns, round(percentile_cont(${window.fraction}::float8) WITHIN GROUP (ORDER BY gap_days))::int AS days
      FROM (
        SELECT extract(epoch FROM started_at - lag(started_at) OVER (PARTITION BY patient_canonical_id(patient_id) ORDER BY started_at)) / 86400 AS gap_days
        FROM encounter
        WHERE organization_id = ${organizationId}::uuid
          AND status = 'completed' AND completed_at <= ${asOf}::timestamptz
          AND started_at > ${from}::timestamptz AND started_at <= ${asOf}::timestamptz
      ) gaps
      WHERE gap_days >= 1
    `);
    const row = rows[0];
    return { returns: Number(row?.returns ?? 0), days: row?.days === null || row?.days === undefined ? null : Number(row.days) };
  }

  /** `clinic.queue-wait`: per visit type, past waits to the first call, and how long each visit of `date` still waiting at `asOf` has waited. */
  async queueWaitInputs(organizationId: string, facilityId: string, window: { date: string; asOf: Date; historyDays: number }): Promise<QueueWaitInput[]> {
    const { asOf } = window;
    const since = new Date(asOf.getTime() - window.historyDays * 86_400_000);
    // Past waits: visits never sent back in line, from check-in to the call.
    const past = await this.db
      .select({
        visitTypeId: visit.visitTypeId,
        minutes: sql<number>`greatest(0, extract(epoch from (${visit.calledAt} - ${visit.checkedInAt})) / 60)::float8`,
      })
      .from(visit)
      .where(
        and(
          eq(visit.organizationId, organizationId),
          eq(visit.facilityId, facilityId),
          isNotNull(visit.calledAt),
          eq(visit.skippedCount, 0),
          gte(visit.checkedInAt, since),
          lte(visit.calledAt, asOf),
          lt(visit.queueDate, window.date),
        ),
      );
    // Waiting now: checked in, not yet called, triaged or seen at the moment.
    const asOfSql = sql`${asOf.toISOString()}::timestamptz`;
    const notYet = (column: typeof visit.calledAt) => or(isNull(column), gt(column, asOf));
    const waiting = await this.db
      .select({
        visitTypeId: visit.visitTypeId,
        minutes: sql<number>`greatest(0, extract(epoch from (${asOfSql} - coalesce(${visit.queuedAt}, ${visit.checkedInAt}))) / 60)::float8`,
      })
      .from(visit)
      .where(
        and(
          eq(visit.organizationId, organizationId),
          eq(visit.facilityId, facilityId),
          eq(visit.queueDate, window.date),
          lte(visit.checkedInAt, asOf),
          ne(visit.status, "cancelled"),
          notYet(visit.calledAt),
          notYet(visit.triageStartedAt),
          notYet(visit.consultationStartedAt),
          notYet(visit.completedAt),
          notYet(visit.noShowAt),
        ),
      );
    if (waiting.length === 0) return [];
    const typeIds = [...new Set(waiting.map((w) => w.visitTypeId))];
    const types = await this.db
      .select({ id: visitType.id, name: visitType.name })
      .from(visitType)
      .where(and(eq(visitType.organizationId, organizationId), inArray(visitType.id, typeIds)));
    return types.map((t) => ({
      visitTypeId: t.id,
      visitTypeName: t.name,
      pastWaits: past.filter((p) => p.visitTypeId === t.id).map((p) => p.minutes),
      waitingNow: waiting.filter((w) => w.visitTypeId === t.id).map((w) => w.minutes),
    }));
  }

  /** `billing.uncharged-work`, clinic side: procedures performed at the facility in [from, to] and not entered in error by `asOf`. */
  async proceduresPerformed(organizationId: string, facilityId: string, from: Date, to: Date, asOf: Date) {
    return this.db
      .select({ id: clinicProcedure.id, code: clinicProcedure.code, name: clinicProcedure.name, performedAt: clinicProcedure.performedAt })
      .from(clinicProcedure)
      .where(
        and(
          eq(clinicProcedure.organizationId, organizationId),
          eq(clinicProcedure.facilityId, facilityId),
          gte(clinicProcedure.performedAt, from),
          lte(clinicProcedure.performedAt, to),
          lte(clinicProcedure.recordedAt, asOf),
          or(isNull(clinicProcedure.enteredInErrorAt), gt(clinicProcedure.enteredInErrorAt, asOf)),
        ),
      );
  }
}
