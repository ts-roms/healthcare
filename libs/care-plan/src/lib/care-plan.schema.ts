import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const CARE_PLAN_CATEGORIES = ["chronic_disease", "preventive", "post_procedure", "maternal", "other"] as const;
export const CARE_PLAN_STATUSES = ["draft", "active", "on_hold", "completed", "cancelled"] as const;
export const ACTIVITY_KINDS = [
  "follow_up_appointment",
  "laboratory_monitoring",
  "medication",
  "lifestyle",
  "education",
  "referral",
  "patient_task",
  "provider_task",
] as const;
export const GOAL_STATUSES = ["proposed", "active", "achieved", "not_achieved", "cancelled"] as const;
export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number];
export type ActivityStatus = "planned" | "scheduled" | "in_progress" | "completed" | "cancelled";

export const carePlan = pgTable("care_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  title: text("title").notNull(),
  category: text("category").$type<(typeof CARE_PLAN_CATEGORIES)[number]>().notNull(),
  description: text("description"),
  status: text("status").$type<CarePlanStatus>().notNull().default("active"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  authorPractitionerId: uuid("author_practitioner_id"),
  sourceEncounterId: uuid("source_encounter_id"),
  statusReason: text("status_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const carePlanProblem = pgTable("care_plan_problem", {
  id: uuid("id").primaryKey().defaultRandom(),
  carePlanId: uuid("care_plan_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  diagnosisId: uuid("diagnosis_id"),
  description: text("description").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const carePlanGoal = pgTable("care_plan_goal", {
  id: uuid("id").primaryKey().defaultRandom(),
  carePlanId: uuid("care_plan_id").notNull(),
  description: text("description").notNull(),
  targetMeasure: text("target_measure"),
  targetValue: text("target_value"),
  targetDate: date("target_date", { mode: "string" }),
  status: text("status").$type<(typeof GOAL_STATUSES)[number]>().notNull().default("active"),
  statusChangedAt: ts("status_changed_at"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const carePlanActivity = pgTable("care_plan_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  carePlanId: uuid("care_plan_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  goalId: uuid("goal_id"),
  kind: text("kind").$type<(typeof ACTIVITY_KINDS)[number]>().notNull(),
  description: text("description").notNull(),
  assignee: text("assignee").$type<"patient" | "care_team">().notNull(),
  assigneePractitionerId: uuid("assignee_practitioner_id"),
  dueDate: date("due_date", { mode: "string" }),
  recurrenceIntervalDays: integer("recurrence_interval_days"),
  status: text("status").$type<ActivityStatus>().notNull().default("planned"),
  linkedAppointmentId: uuid("linked_appointment_id"),
  completedAt: ts("completed_at"),
  completedBy: uuid("completed_by"),
  statusReason: text("status_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const carePlanProgressNote = pgTable("care_plan_progress_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  carePlanId: uuid("care_plan_id").notNull(),
  note: text("note").notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

/** One recall reminder sent for an activity's due date (append-only). */
export const carePlanActivityReminder = pgTable("care_plan_activity_reminder", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  kind: text("kind").$type<"due" | "overdue">().notNull(),
  notificationId: uuid("notification_id"),
  sentAt: ts("sent_at").notNull().defaultNow(),
});

export type CarePlanRecord = typeof carePlan.$inferSelect;
export type CarePlanActivityRecord = typeof carePlanActivity.$inferSelect;
