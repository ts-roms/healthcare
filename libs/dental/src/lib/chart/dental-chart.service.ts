import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, DomainEventPublisher } from "@healthcare/core";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { recordExaminationSchema } from "../dental.dto";
import { type Finding, normalizeSurfaces, sortFindings, toothStateIssues } from "../dental.rules";
import { dentalExamination, type DentalExaminationRecord, dentalProcedure, dentalToothFinding, dentalToothState } from "../dental.schema";
import { found, rejectIssues, requireDentist, requireOpenEncounter, strip } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

/** One tooth's charted state and where it came from. */
export interface ChartTooth {
  /** The tooth state (an append-only row). */
  stateId: string;
  tooth: string;
  findings: Finding[];
  note: string | null;
  source: { type: "examination" | "procedure"; id: string };
  recordedAt: Date;
  recordedBy: string;
}

export interface NewToothState {
  organizationId: string;
  patientId: string;
  tooth: string;
  source: { type: "examination" | "procedure"; id: string };
  findings: Finding[];
  note?: string | null;
  recordedBy: string;
}

/**
 * The odontogram. Examinations and procedures append tooth states; nothing is edited in place. The current chart is
 * the latest state of each tooth whose examination or procedure has not been marked entered in error, so a correction
 * reveals the tooth's previous state again.
 */
@Injectable()
export class DentalChartService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async recordExamination(actor: Actor, patientId: string, input: z.infer<typeof recordExaminationSchema>) {
    const dentist = await requireDentist(this.context, actor);
    const encounter = await requireOpenEncounter(this.context, actor, input.encounterId, patientId);
    const issues: Record<string, string[]> = {};
    const seen = new Set<string>();
    for (const t of input.teeth) {
      if (seen.has(t.tooth)) (issues[t.tooth] ??= []).push("charted twice");
      seen.add(t.tooth);
      (issues[t.tooth] ??= []).push(...toothStateIssues(t.tooth, t.findings));
    }
    rejectIssues(issues, "Some teeth are not charted correctly", "invalid_chart");
    if (!input.teeth.length && !input.notes && !input.oralHygiene) {
      throw new BusinessRuleError("Chart at least one tooth or record the examination findings", "empty_examination");
    }

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(dentalExamination)
        .values({
          organizationId: actor.organizationId,
          facilityId: encounter.facilityId,
          patientId,
          encounterId: encounter.id,
          practitionerId: dentist.id,
          oralHygiene: input.oralHygiene ?? null,
          notes: input.notes || null,
          recordedBy: actor.userId,
        })
        .returning();
      const exam = found(created, "Examination");
      for (const t of input.teeth) {
        await this.appendState(tx, {
          organizationId: actor.organizationId,
          patientId,
          tooth: t.tooth,
          source: { type: "examination", id: exam.id },
          findings: t.findings,
          note: t.note || null,
          recordedBy: actor.userId,
        });
      }
      const teeth = input.teeth.map((t) => t.tooth);
      await this.audit.record(tx, actor, {
        action: "dental.examination.record",
        resourceType: "dental_examination",
        resourceId: exam.id,
        patientId,
        metadata: { encounterId: encounter.id, teeth },
      });
      await this.events.record(tx, {
        type: "DentalExaminationRecorded",
        organizationId: actor.organizationId,
        aggregateType: "dental_examination",
        aggregateId: exam.id,
        facilityId: exam.facilityId,
        patientId,
        payload: { encounterId: encounter.id, teethCharted: teeth.length },
      });
      if (teeth.length) await this.chartUpdated(tx, actor.organizationId, patientId, exam.facilityId, "examination", exam.id, teeth);
      return { ...strip(exam), teeth: await this.statesOf(tx, actor.organizationId, { examinationIds: [exam.id] }) };
    });
  }

  /** Removes an examination (and the teeth it charted) from the current chart; the record stays, with the reason. */
  async markExaminationEnteredInError(actor: Actor, examinationId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalExamination)
        .where(and(eq(dentalExamination.organizationId, actor.organizationId), eq(dentalExamination.id, examinationId)))
        .for("update");
      const exam = found(current, "Examination");
      if (exam.status !== "recorded") throw new BusinessRuleError("The examination is already marked entered in error", "already_entered_in_error");
      const [row] = (await tx
        .update(dentalExamination)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId })
        .where(eq(dentalExamination.id, examinationId))
        .returning()) as [DentalExaminationRecord];
      await this.audit.record(tx, actor, {
        action: "dental.examination.entered-in-error",
        resourceType: "dental_examination",
        resourceId: examinationId,
        patientId: exam.patientId,
        reason,
      });
      const teeth = (await this.statesOf(tx, actor.organizationId, { examinationIds: [examinationId] })).map((s) => s.tooth);
      if (teeth.length) await this.chartUpdated(tx, actor.organizationId, exam.patientId, exam.facilityId, "examination", examinationId, teeth);
      return strip(row);
    });
  }

  /** The current chart (teeth never charted are absent). */
  async chart(organizationId: string, patientId: string, executor: DbExecutor = this.db, teeth?: string[]): Promise<ChartTooth[]> {
    if (teeth && !teeth.length) return [];
    const rows = await executor
      .selectDistinctOn([dentalToothState.tooth], {
        id: dentalToothState.id,
        tooth: dentalToothState.tooth,
        sourceType: dentalToothState.sourceType,
        examinationId: dentalToothState.examinationId,
        procedureId: dentalToothState.procedureId,
        note: dentalToothState.note,
        recordedAt: dentalToothState.recordedAt,
        recordedBy: dentalToothState.recordedBy,
      })
      .from(dentalToothState)
      .leftJoin(dentalExamination, eq(dentalExamination.id, dentalToothState.examinationId))
      .leftJoin(dentalProcedure, eq(dentalProcedure.id, dentalToothState.procedureId))
      .where(
        and(
          eq(dentalToothState.organizationId, organizationId),
          eq(dentalToothState.patientId, patientId),
          sql`coalesce(${dentalExamination.status}, ${dentalProcedure.status}) = 'recorded'`,
          teeth ? inArray(dentalToothState.tooth, teeth) : undefined,
        ),
      )
      .orderBy(asc(dentalToothState.tooth), desc(dentalToothState.sequence));
    const findings = await this.findingsOf(
      executor,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      stateId: r.id,
      tooth: r.tooth,
      findings: findings.get(r.id) ?? [],
      note: r.note,
      source: { type: r.sourceType, id: (r.examinationId ?? r.procedureId)! },
      recordedAt: r.recordedAt,
      recordedBy: r.recordedBy,
    }));
  }

  /** Every state of one tooth, newest first, including those of corrected records (flagged). */
  async toothHistory(organizationId: string, patientId: string, tooth: string) {
    const rows = await this.db
      .select({
        state: dentalToothState,
        status: sql<"recorded" | "entered_in_error">`coalesce(${dentalExamination.status}, ${dentalProcedure.status})`,
      })
      .from(dentalToothState)
      .leftJoin(dentalExamination, eq(dentalExamination.id, dentalToothState.examinationId))
      .leftJoin(dentalProcedure, eq(dentalProcedure.id, dentalToothState.procedureId))
      .where(and(eq(dentalToothState.organizationId, organizationId), eq(dentalToothState.patientId, patientId), eq(dentalToothState.tooth, tooth)))
      .orderBy(desc(dentalToothState.sequence));
    const findings = await this.findingsOf(
      this.db,
      rows.map((r) => r.state.id),
    );
    return rows.map((r) => ({
      tooth: r.state.tooth,
      findings: findings.get(r.state.id) ?? [],
      note: r.state.note,
      source: { type: r.state.sourceType, id: (r.state.examinationId ?? r.state.procedureId)!, status: r.status },
      recordedAt: r.state.recordedAt,
      recordedBy: r.state.recordedBy,
    }));
  }

  /** Recent examinations with the teeth each one charted, newest first. */
  async examinations(organizationId: string, patientId: string, limit = 50) {
    const exams = await this.db
      .select()
      .from(dentalExamination)
      .where(and(eq(dentalExamination.organizationId, organizationId), eq(dentalExamination.patientId, patientId)))
      .orderBy(desc(dentalExamination.recordedAt))
      .limit(limit);
    const states = await this.statesOf(this.db, organizationId, { examinationIds: exams.map((e) => e.id) });
    return exams.map((e) => ({ ...strip(e), teeth: states.filter((s) => s.examinationId === e.id) }));
  }

  /** Appends one tooth's state (within the caller's transaction). */
  async appendState(executor: DbExecutor, input: NewToothState): Promise<void> {
    const [state] = await executor
      .insert(dentalToothState)
      .values({
        organizationId: input.organizationId,
        patientId: input.patientId,
        tooth: input.tooth,
        sourceType: input.source.type,
        examinationId: input.source.type === "examination" ? input.source.id : null,
        procedureId: input.source.type === "procedure" ? input.source.id : null,
        note: input.note ?? null,
        recordedBy: input.recordedBy,
      })
      .returning({ id: dentalToothState.id });
    if (input.findings.length) {
      await executor.insert(dentalToothFinding).values(
        input.findings.map((f) => ({
          organizationId: input.organizationId,
          stateId: state!.id,
          condition: f.condition,
          surfaces: normalizeSurfaces(f.surfaces),
        })),
      );
    }
  }

  async chartUpdated(
    executor: DbExecutor,
    organizationId: string,
    patientId: string,
    facilityId: string,
    source: "examination" | "procedure",
    sourceId: string,
    teeth: string[],
  ): Promise<void> {
    await this.events.record(executor, {
      type: "DentalChartUpdated",
      organizationId,
      aggregateType: "patient",
      aggregateId: patientId,
      facilityId,
      patientId,
      payload: { source, sourceId, teeth },
    });
  }

  private async statesOf(executor: DbExecutor, organizationId: string, by: { examinationIds?: string[]; procedureIds?: string[] }) {
    const examinationIds = by.examinationIds ?? [];
    const procedureIds = by.procedureIds ?? [];
    if (!examinationIds.length && !procedureIds.length) return [];
    const rows = await executor
      .select()
      .from(dentalToothState)
      .where(
        and(
          eq(dentalToothState.organizationId, organizationId),
          or(
            examinationIds.length ? inArray(dentalToothState.examinationId, examinationIds) : undefined,
            procedureIds.length ? inArray(dentalToothState.procedureId, procedureIds) : undefined,
          ),
        ),
      )
      .orderBy(asc(dentalToothState.tooth));
    const findings = await this.findingsOf(
      executor,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      tooth: r.tooth,
      examinationId: r.examinationId,
      procedureId: r.procedureId,
      findings: findings.get(r.id) ?? [],
      note: r.note,
    }));
  }

  /** Findings of a patient's procedures' tooth states (what each procedure left on the chart). */
  procedureStates(executor: DbExecutor, organizationId: string, procedureIds: string[]) {
    return this.statesOf(executor, organizationId, { procedureIds });
  }

  private async findingsOf(executor: DbExecutor, stateIds: string[]): Promise<Map<string, Finding[]>> {
    const map = new Map<string, Finding[]>();
    if (!stateIds.length) return map;
    const rows = await executor.select().from(dentalToothFinding).where(inArray(dentalToothFinding.stateId, stateIds));
    for (const r of rows) {
      const list = map.get(r.stateId) ?? [];
      list.push({ condition: r.condition, surfaces: r.surfaces });
      map.set(r.stateId, list);
    }
    for (const [id, list] of map) map.set(id, sortFindings(list));
    return map;
  }
}
