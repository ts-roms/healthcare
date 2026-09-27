import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  PgErrorCode,
  todayInPhilippines,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type {
  activitySchema,
  changePlanStatusSchema,
  createCarePlanSchema,
  dueActivitiesSchema,
  goalSchema,
  updateActivitySchema,
  updateGoalSchema,
} from "./care-plan.dto";
import { canChangeActivityStatus, canChangePlanStatus, nextDueDate } from "./care-plan.rules";
import {
  carePlan,
  carePlanActivity,
  carePlanActivityReminder,
  type CarePlanActivityRecord,
  carePlanGoal,
  carePlanProblem,
  carePlanProgressNote,
  type CarePlanRecord,
} from "./care-plan.schema";
import { CARE_PLAN_PATIENTS, type CarePlanPatientDirectory } from "./ports";

const OPEN_PLAN_STATUSES = ["draft", "active", "on_hold"] as const;
const OPEN_ACTIVITY_STATUSES = ["planned", "scheduled", "in_progress"] as const;

function strip<T extends { organizationId?: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  return rest;
}

/**
 * Care plans connect problems (diagnoses) to goals and planned activities
 * (follow-up appointments, laboratory monitoring, medication, lifestyle, …).
 * Targets are clinician-set text: the platform tracks, it does not interpret.
 */
@Injectable()
export class CarePlanService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    @Inject(CARE_PLAN_PATIENTS) private readonly patients: CarePlanPatientDirectory,
  ) {}

  async create(actor: Actor, input: z.infer<typeof createCarePlanSchema>) {
    return this.withReferenceErrors(() =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(carePlan)
          .values({
            organizationId: actor.organizationId,
            patientId: input.patientId,
            title: input.title,
            category: input.category,
            description: input.description ?? null,
            status: input.status,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            authorPractitionerId: input.authorPractitionerId ?? null,
            sourceEncounterId: input.sourceEncounterId ?? null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Care plan insert returned no row");
        if (input.problems.length) {
          await tx.insert(carePlanProblem).values(
            input.problems.map((p) => ({
              carePlanId: created.id,
              patientId: created.patientId,
              diagnosisId: p.diagnosisId ?? null,
              description: p.description,
            })),
          );
        }
        const goals = input.goals.length
          ? await tx
              .insert(carePlanGoal)
              .values(input.goals.map((g) => ({ ...g, carePlanId: created.id, createdBy: actor.userId })))
              .returning({ id: carePlanGoal.id })
          : [];
        for (const activity of input.activities) {
          const { goalIndex, ...values } = activity;
          if (goalIndex !== undefined && !goals[goalIndex])
            throw new BusinessRuleError(`goalIndex ${goalIndex} does not refer to a goal`, "invalid_goal_index");
          await this.insertActivity(tx, actor, created, { ...values, goalId: goalIndex === undefined ? undefined : goals[goalIndex]!.id });
        }
        await this.audit.record(tx, actor, {
          action: "care-plan.create",
          resourceType: "care_plan",
          resourceId: created.id,
          patientId: created.patientId,
          metadata: {
            category: created.category,
            goals: input.goals.length,
            activities: input.activities.length,
            sourceEncounterId: created.sourceEncounterId,
          },
        });
        await this.events.record(tx, planEvent("CarePlanCreated", created));
        return created.id;
      }),
    ).then((id) => this.detail(this.db, actor.organizationId, id));
  }

  async get(actor: Actor, carePlanId: string) {
    const detail = await this.detail(this.db, actor.organizationId, carePlanId);
    await this.audit.recordStandalone(actor, { action: "care-plan.view", resourceType: "care_plan", resourceId: carePlanId, patientId: detail.patientId });
    return detail;
  }

  async listForPatient(actor: Actor, patientId: string, includeClosed: boolean) {
    const conditions: SQL[] = [eq(carePlan.organizationId, actor.organizationId), eq(carePlan.patientId, patientId)];
    if (!includeClosed) conditions.push(inArray(carePlan.status, [...OPEN_PLAN_STATUSES]));
    const rows = await this.db
      .select()
      .from(carePlan)
      .where(and(...conditions))
      .orderBy(desc(carePlan.startDate));
    await this.audit.recordStandalone(actor, { action: "care-plan.list", resourceType: "care_plan", patientId });
    return rows.map(strip);
  }

  /** Every care plan of the patient with its activities, for a record export (FHIR). Not audited here; the caller audits. */
  async allForPatient(organizationId: string, patientId: string) {
    const plans = await this.db
      .select()
      .from(carePlan)
      .where(and(eq(carePlan.organizationId, organizationId), eq(carePlan.patientId, patientId)))
      .orderBy(asc(carePlan.startDate));
    if (plans.length === 0) return [];
    const activities = await this.db
      .select()
      .from(carePlanActivity)
      .where(
        and(
          eq(carePlanActivity.organizationId, organizationId),
          inArray(
            carePlanActivity.carePlanId,
            plans.map((p) => p.id),
          ),
        ),
      )
      .orderBy(asc(carePlanActivity.createdAt));
    return plans.map((plan) => ({ ...strip(plan), activities: activities.filter((a) => a.carePlanId === plan.id).map(strip) }));
  }

  /** Open care plans with their next due activities, for Patient 360 (caller audits). */
  async openPlansSummary(organizationId: string, patientId: string) {
    const plans = await this.db
      .select()
      .from(carePlan)
      .where(and(eq(carePlan.organizationId, organizationId), eq(carePlan.patientId, patientId), inArray(carePlan.status, [...OPEN_PLAN_STATUSES])))
      .orderBy(desc(carePlan.startDate));
    if (plans.length === 0) return [];
    const activities = await this.db
      .select()
      .from(carePlanActivity)
      .where(
        and(
          inArray(
            carePlanActivity.carePlanId,
            plans.map((p) => p.id),
          ),
          inArray(carePlanActivity.status, [...OPEN_ACTIVITY_STATUSES]),
        ),
      )
      .orderBy(sql`${carePlanActivity.dueDate} ASC NULLS LAST`);
    return plans.map((plan) => ({ ...strip(plan), openActivities: activities.filter((a) => a.carePlanId === plan.id).map(strip) }));
  }

  /**
   * The patient's active plans as the patient sees them in the portal: title,
   * goals and open activities, without staff names, reasons or progress notes.
   * Not audited here: the portal endpoint audits the patient's access.
   */
  async patientView(organizationId: string, patientId: string) {
    const plans = await this.db
      .select()
      .from(carePlan)
      .where(and(eq(carePlan.organizationId, organizationId), eq(carePlan.patientId, patientId), eq(carePlan.status, "active")))
      .orderBy(desc(carePlan.startDate));
    if (plans.length === 0) return [];
    const planIds = plans.map((p) => p.id);
    const [goals, activities] = await Promise.all([
      this.db.select().from(carePlanGoal).where(inArray(carePlanGoal.carePlanId, planIds)),
      this.db
        .select()
        .from(carePlanActivity)
        .where(and(inArray(carePlanActivity.carePlanId, planIds), inArray(carePlanActivity.status, [...OPEN_ACTIVITY_STATUSES])))
        .orderBy(sql`${carePlanActivity.dueDate} ASC NULLS LAST`),
    ]);
    return plans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      category: plan.category,
      startDate: plan.startDate,
      goals: goals
        .filter((g) => g.carePlanId === plan.id && ["proposed", "active", "achieved"].includes(g.status))
        .map((g) => ({
          id: g.id,
          description: g.description,
          targetMeasure: g.targetMeasure,
          targetValue: g.targetValue,
          targetDate: g.targetDate,
          status: g.status,
        })),
      activities: activities
        .filter((a) => a.carePlanId === plan.id)
        .map((a) => ({ id: a.id, kind: a.kind, description: a.description, assignee: a.assignee, dueDate: a.dueDate, status: a.status })),
    }));
  }

  async changeStatus(actor: Actor, carePlanId: string, input: z.infer<typeof changePlanStatusSchema>) {
    if ((input.status === "cancelled" || input.status === "on_hold") && !input.reason) throw new BusinessRuleError("A reason is required", "reason_required");
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, carePlanId);
      if (current.version !== input.version) throw new VersionConflictError("Care plan", input.version);
      if (!canChangePlanStatus(current.status, input.status))
        throw new BusinessRuleError(`Cannot change a ${current.status} care plan to ${input.status}`, "invalid_care_plan_status");
      const [updated] = await tx
        .update(carePlan)
        .set({
          status: input.status,
          statusReason: input.reason ?? null,
          endDate: input.status === "completed" || input.status === "cancelled" ? (current.endDate ?? todayInPhilippines()) : current.endDate,
          updatedBy: actor.userId,
          updatedAt: new Date(),
          version: sql`${carePlan.version} + 1`,
        })
        .where(eq(carePlan.id, carePlanId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "care-plan.status",
        resourceType: "care_plan",
        resourceId: carePlanId,
        patientId: current.patientId,
        reason: input.reason,
        changes: { status: { from: current.status, to: input.status } },
      });
      if (updated) await this.events.record(tx, planEvent(`CarePlan${capitalize(input.status)}`, updated));
    });
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  async addGoal(actor: Actor, carePlanId: string, input: z.infer<typeof goalSchema>) {
    await this.db.transaction(async (tx) => {
      const plan = await this.lockOpen(tx, actor.organizationId, carePlanId);
      const [goal] = await tx
        .insert(carePlanGoal)
        .values({ ...input, carePlanId, createdBy: actor.userId })
        .returning();
      await this.touch(tx, actor, plan);
      await this.audit.record(tx, actor, { action: "care-plan.goal-add", resourceType: "care_plan_goal", resourceId: goal?.id, patientId: plan.patientId });
    });
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  async updateGoal(actor: Actor, carePlanId: string, goalId: string, input: z.infer<typeof updateGoalSchema>) {
    await this.db.transaction(async (tx) => {
      const plan = await this.lockOpen(tx, actor.organizationId, carePlanId);
      const [before] = await tx
        .select()
        .from(carePlanGoal)
        .where(and(eq(carePlanGoal.carePlanId, carePlanId), eq(carePlanGoal.id, goalId)));
      if (!before) throw new NotFoundError("Goal");
      await tx.update(carePlanGoal).set({ status: input.status, statusChangedAt: new Date() }).where(eq(carePlanGoal.id, goalId));
      await this.touch(tx, actor, plan);
      await this.audit.record(tx, actor, {
        action: "care-plan.goal-status",
        resourceType: "care_plan_goal",
        resourceId: goalId,
        patientId: plan.patientId,
        changes: { status: { from: before.status, to: input.status } },
      });
    });
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  async addActivity(actor: Actor, carePlanId: string, input: z.infer<typeof activitySchema>) {
    await this.withReferenceErrors(() =>
      this.db.transaction(async (tx) => {
        const plan = await this.lockOpen(tx, actor.organizationId, carePlanId);
        if (input.goalId) {
          const [goal] = await tx
            .select({ id: carePlanGoal.id })
            .from(carePlanGoal)
            .where(and(eq(carePlanGoal.carePlanId, carePlanId), eq(carePlanGoal.id, input.goalId)));
          if (!goal) throw new NotFoundError("Goal");
        }
        await this.insertActivity(tx, actor, plan, input);
        await this.touch(tx, actor, plan);
      }),
    );
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  /**
   * Moves an activity along; scheduling links the booked appointment (the
   * database guarantees it belongs to the same patient). Completing a
   * recurring activity creates its next occurrence.
   */
  async updateActivity(actor: Actor, carePlanId: string, activityId: string, input: z.infer<typeof updateActivitySchema>) {
    await this.withReferenceErrors(() =>
      this.db.transaction(async (tx) => {
        const plan = await this.lockOpen(tx, actor.organizationId, carePlanId);
        const [current] = await tx
          .select()
          .from(carePlanActivity)
          .where(and(eq(carePlanActivity.carePlanId, carePlanId), eq(carePlanActivity.id, activityId)))
          .for("update");
        if (!current) throw new NotFoundError("Activity");
        if (!canChangeActivityStatus(current.status, input.status)) {
          throw new BusinessRuleError(`Cannot change a ${current.status} activity to ${input.status}`, "invalid_activity_status");
        }
        const completing = input.status === "completed";
        await tx
          .update(carePlanActivity)
          .set({
            status: input.status,
            linkedAppointmentId: input.appointmentId ?? current.linkedAppointmentId,
            completedAt: completing ? new Date() : null,
            completedBy: completing ? actor.userId : null,
            statusReason: input.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(carePlanActivity.id, activityId));
        let next: CarePlanActivityRecord | undefined;
        if (completing && current.recurrenceIntervalDays) {
          next = await this.insertActivity(tx, actor, plan, {
            kind: current.kind,
            description: current.description,
            assignee: current.assignee,
            assigneePractitionerId: current.assigneePractitionerId ?? undefined,
            dueDate: nextDueDate(todayInPhilippines(), current.recurrenceIntervalDays),
            recurrenceIntervalDays: current.recurrenceIntervalDays,
            goalId: current.goalId ?? undefined,
          });
        }
        await this.touch(tx, actor, plan);
        await this.audit.record(tx, actor, {
          action: "care-plan.activity-status",
          resourceType: "care_plan_activity",
          resourceId: activityId,
          patientId: plan.patientId,
          reason: input.reason,
          changes: { status: { from: current.status, to: input.status } },
          metadata: { appointmentId: input.appointmentId, nextActivityId: next?.id },
        });
        if (completing) {
          await this.events.record(tx, {
            ...planEvent("CarePlanActivityCompleted", plan),
            payload: { activityId, kind: current.kind, nextActivityId: next?.id ?? null },
          });
        }
      }),
    );
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  async addProgressNote(actor: Actor, carePlanId: string, note: string) {
    await this.db.transaction(async (tx) => {
      const plan = await this.lock(tx, actor.organizationId, carePlanId);
      const [created] = await tx.insert(carePlanProgressNote).values({ carePlanId, note, recordedBy: actor.userId }).returning({ id: carePlanProgressNote.id });
      await this.audit.record(tx, actor, {
        action: "care-plan.progress-note",
        resourceType: "care_plan",
        resourceId: carePlanId,
        patientId: plan.patientId,
        metadata: { noteId: created?.id },
      });
    });
    return this.detail(this.db, actor.organizationId, carePlanId);
  }

  /**
   * Patient recall list: open activities of open plans that are overdue or
   * due within the window (CLAUDE.md §39 "Patient recall").
   */
  async dueActivities(actor: Actor, query: z.infer<typeof dueActivitiesSchema>) {
    const horizon = nextDueDate(todayInPhilippines(), query.withinDays);
    const conditions: SQL[] = [
      eq(carePlanActivity.organizationId, actor.organizationId),
      inArray(carePlanActivity.status, ["planned", "in_progress"]),
      isNotNull(carePlanActivity.dueDate),
      lte(carePlanActivity.dueDate, horizon),
      inArray(carePlan.status, ["active"]),
    ];
    if (query.kind) conditions.push(eq(carePlanActivity.kind, query.kind));
    if (query.assigneePractitionerId) conditions.push(eq(carePlanActivity.assigneePractitionerId, query.assigneePractitionerId));
    const rows = await this.db
      .select({ activity: carePlanActivity, planTitle: carePlan.title, planCategory: carePlan.category })
      .from(carePlanActivity)
      .innerJoin(carePlan, eq(carePlan.id, carePlanActivity.carePlanId))
      .where(and(...conditions))
      .orderBy(asc(carePlanActivity.dueDate))
      .limit(500);
    const today = todayInPhilippines();
    await this.audit.recordStandalone(actor, {
      action: "care-plan.due-list",
      resourceType: "care_plan_activity",
      metadata: { count: rows.length, withinDays: query.withinDays },
    });
    // Minimal identification only (number, name, sex, age): a recall list is a work list, not a record.
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.activity.patientId))]);
    const reminders = rows.length
      ? await this.db
          .select({ activityId: carePlanActivityReminder.activityId, last: sql<Date>`max(${carePlanActivityReminder.sentAt})` })
          .from(carePlanActivityReminder)
          .where(
            inArray(
              carePlanActivityReminder.activityId,
              rows.map((r) => r.activity.id),
            ),
          )
          .groupBy(carePlanActivityReminder.activityId)
      : [];
    const lastReminder = new Map(reminders.map((r) => [r.activityId, new Date(r.last)]));
    return rows.map(({ activity, planTitle, planCategory }) => ({
      ...strip(activity),
      planTitle,
      planCategory,
      overdue: activity.dueDate !== null && activity.dueDate < today,
      patient: patients.get(activity.patientId) ?? null,
      /** When the patient was last reminded (recall reminders), if ever. */
      lastReminderAt: lastReminder.get(activity.id) ?? null,
    }));
  }

  // ---- internals ----------------------------------------------------------------

  private async detail(executor: DbExecutor, organizationId: string, carePlanId: string) {
    const [plan] = await executor
      .select()
      .from(carePlan)
      .where(and(eq(carePlan.organizationId, organizationId), eq(carePlan.id, carePlanId)));
    if (!plan) throw new NotFoundError("Care plan");
    const [problems, goals, activities, notes] = await Promise.all([
      executor.select().from(carePlanProblem).where(eq(carePlanProblem.carePlanId, carePlanId)).orderBy(asc(carePlanProblem.createdAt)),
      executor.select().from(carePlanGoal).where(eq(carePlanGoal.carePlanId, carePlanId)).orderBy(asc(carePlanGoal.createdAt)),
      executor
        .select()
        .from(carePlanActivity)
        .where(eq(carePlanActivity.carePlanId, carePlanId))
        .orderBy(sql`${carePlanActivity.dueDate} ASC NULLS LAST`, asc(carePlanActivity.createdAt)),
      executor.select().from(carePlanProgressNote).where(eq(carePlanProgressNote.carePlanId, carePlanId)).orderBy(desc(carePlanProgressNote.recordedAt)),
    ]);
    return { ...strip(plan), problems, goals, activities: activities.map(strip), progressNotes: notes };
  }

  private async insertActivity(tx: DbExecutor, actor: Actor, plan: CarePlanRecord, input: z.infer<typeof activitySchema>): Promise<CarePlanActivityRecord> {
    const [created] = await tx
      .insert(carePlanActivity)
      .values({
        carePlanId: plan.id,
        organizationId: plan.organizationId,
        patientId: plan.patientId,
        goalId: input.goalId ?? null,
        kind: input.kind,
        description: input.description,
        assignee: input.assignee,
        assigneePractitionerId: input.assigneePractitionerId ?? null,
        dueDate: input.dueDate ?? null,
        recurrenceIntervalDays: input.recurrenceIntervalDays ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Activity insert returned no row");
    return created;
  }

  private async lock(tx: DbExecutor, organizationId: string, carePlanId: string): Promise<CarePlanRecord> {
    const [plan] = await tx
      .select()
      .from(carePlan)
      .where(and(eq(carePlan.organizationId, organizationId), eq(carePlan.id, carePlanId)))
      .for("update");
    if (!plan) throw new NotFoundError("Care plan");
    return plan;
  }

  private async lockOpen(tx: DbExecutor, organizationId: string, carePlanId: string): Promise<CarePlanRecord> {
    const plan = await this.lock(tx, organizationId, carePlanId);
    if (!(OPEN_PLAN_STATUSES as readonly string[]).includes(plan.status)) throw new BusinessRuleError(`The care plan is ${plan.status}`, "care_plan_closed");
    return plan;
  }

  private async touch(tx: DbExecutor, actor: Actor, plan: CarePlanRecord): Promise<void> {
    await tx
      .update(carePlan)
      .set({ updatedBy: actor.userId, updatedAt: new Date(), version: sql`${carePlan.version} + 1` })
      .where(eq(carePlan.id, plan.id));
  }

  /** Composite (patient_id, id) keys reject diagnoses, encounters or appointments of another patient. */
  private async withReferenceErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.foreignKeyViolation) {
        throw new BusinessRuleError(
          "A referenced patient, diagnosis, encounter, appointment or practitioner does not exist for this patient",
          "invalid_reference",
          {
            constraint: pg.constraint,
          },
        );
      }
      throw error;
    }
  }
}

function planEvent(type: string, plan: CarePlanRecord) {
  return {
    type,
    organizationId: plan.organizationId,
    aggregateType: "care_plan",
    aggregateId: plan.id,
    patientId: plan.patientId,
    payload: { category: plan.category, status: plan.status },
  };
}

function capitalize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
