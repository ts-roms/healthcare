import { z } from "zod";
import type { CareActivity, CareActivityKind, CareActivityStatus, CarePlanCategory, CarePlanStatus, CareGoalStatus } from "./api/types";

/**
 * Care-plan helpers. Transitions mirror `libs/care-plan` (`care-plan.rules.ts`)
 * only to decide which buttons to offer; the API enforces them.
 */

export const CATEGORY_LABEL: Record<CarePlanCategory, string> = {
  chronic_disease: "Chronic disease",
  preventive: "Preventive",
  post_procedure: "Post-procedure",
  maternal: "Maternal",
  other: "Other",
};

export const KIND_LABEL: Record<CareActivityKind, string> = {
  follow_up_appointment: "Follow-up visit",
  laboratory_monitoring: "Lab monitoring",
  medication: "Medication",
  lifestyle: "Lifestyle",
  education: "Education",
  referral: "Referral",
  patient_task: "Patient task",
  provider_task: "Care-team task",
};

export const PLAN_STATUS_LABEL: Record<CarePlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ACTIVITY_STATUS_LABEL: Record<CareActivityStatus, string> = {
  planned: "Planned",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
};

export const GOAL_STATUS_LABEL: Record<CareGoalStatus, string> = {
  proposed: "Proposed",
  active: "Active",
  achieved: "Achieved",
  not_achieved: "Not achieved",
  cancelled: "Cancelled",
};

/** A plan never moves back to draft. */
export type PlanTarget = Exclude<CarePlanStatus, "draft">;

const PLAN_TRANSITIONS: Record<CarePlanStatus, readonly PlanTarget[]> = {
  draft: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function planTransitions(status: CarePlanStatus): readonly PlanTarget[] {
  return PLAN_TRANSITIONS[status];
}

/** Closing or pausing a plan is explained. */
export function planChangeNeedsReason(to: CarePlanStatus): boolean {
  return to === "on_hold" || to === "cancelled";
}

export type ActivityAction = "book" | "complete" | "cancel";

/**
 * Actions on an activity of an open plan: a planned follow-up visit can be
 * booked (the appointment is then linked and the activity becomes scheduled);
 * open activities can be completed or cancelled (with a reason).
 */
export function activityActions(
  a: Pick<CareActivity, "status" | "kind" | "assignee">,
  context: { planStatus: CarePlanStatus; canManage: boolean; canBook: boolean },
): ActivityAction[] {
  if (!context.canManage || (context.planStatus !== "active" && context.planStatus !== "on_hold")) return [];
  if (a.status === "completed" || a.status === "cancelled") return [];
  const actions: ActivityAction[] = [];
  if (context.canBook && a.kind === "follow_up_appointment" && a.status === "planned") actions.push("book");
  actions.push("complete", "cancel");
  return actions;
}

/** "Overdue" is shown for an open activity whose due date has passed (facility-local dates, YYYY-MM-DD). */
export function isOverdue(a: Pick<CareActivity, "status" | "dueDate">, today: string): boolean {
  return (a.status === "planned" || a.status === "in_progress") && a.dueDate !== null && a.dueDate < today;
}

export const FOLLOW_UP_PRESETS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
] as const;

/** YYYY-MM-DD plus whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- New care plan form -------------------------------------------------------------------------------

export interface GoalForm {
  key: string;
  description: string;
  targetMeasure: string;
  targetValue: string;
  targetDate: string;
}

export interface ActivityForm {
  key: string;
  kind: CareActivityKind;
  description: string;
  assignee: "patient" | "care_team";
  dueDate: string;
  recurrenceIntervalDays: string;
  /** Key of a goal in the same form, or "". */
  goalKey: string;
}

let counter = 0;
const nextKey = (prefix: string) => `${prefix}-${++counter}`;

export function blankGoal(): GoalForm {
  return { key: nextKey("goal"), description: "", targetMeasure: "", targetValue: "", targetDate: "" };
}

export function blankActivity(kind: CareActivityKind = "follow_up_appointment"): ActivityForm {
  return {
    key: nextKey("activity"),
    kind,
    description: "",
    assignee: kind === "patient_task" ? "patient" : "care_team",
    dueDate: "",
    recurrenceIntervalDays: "",
    goalKey: "",
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optional = (v: string) => v.trim() || undefined;

export interface CarePlanPayload {
  title: string;
  category: CarePlanCategory;
  description?: string;
  startDate: string;
  endDate?: string;
  problems: Array<{ diagnosisId?: string; description: string }>;
  goals: Array<{ description: string; targetMeasure?: string; targetValue?: string; targetDate?: string }>;
  activities: Array<{
    kind: CareActivityKind;
    description: string;
    assignee: "patient" | "care_team";
    dueDate?: string;
    recurrenceIntervalDays?: number;
    goalIndex?: number;
  }>;
}

/**
 * Builds the `POST /care-plans` body. Blank goal/activity rows are ignored;
 * activities reference goals by index, as the API expects.
 */
export function buildCarePlanPayload(form: {
  title: string;
  category: CarePlanCategory;
  description: string;
  startDate: string;
  endDate: string;
  problems: Array<{ diagnosisId?: string; description: string }>;
  goals: GoalForm[];
  activities: ActivityForm[];
}): { ok: true; payload: CarePlanPayload } | { ok: false; message: string } {
  if (!form.title.trim()) return { ok: false, message: "Give the care plan a title." };
  if (!DATE.test(form.startDate)) return { ok: false, message: "Choose a start date." };
  if (form.endDate && form.endDate < form.startDate) return { ok: false, message: "The end date must not precede the start date." };
  const goals = form.goals.filter((g) => g.description.trim());
  const activities = form.activities.filter((a) => a.description.trim());
  if (goals.length === 0 && activities.length === 0) return { ok: false, message: "Add at least one goal or activity." };
  const goalIndex = new Map(goals.map((g, i) => [g.key, i]));
  const payloadActivities: CarePlanPayload["activities"] = [];
  for (const a of activities) {
    let recurrence: number | undefined;
    if (a.recurrenceIntervalDays.trim()) {
      recurrence = Number(a.recurrenceIntervalDays);
      if (!Number.isInteger(recurrence) || recurrence < 1 || recurrence > 730)
        return { ok: false, message: `"${a.description.trim()}": repeat every 1–730 days.` };
    }
    payloadActivities.push({
      kind: a.kind,
      description: a.description.trim(),
      assignee: a.assignee,
      dueDate: DATE.test(a.dueDate) ? a.dueDate : undefined,
      recurrenceIntervalDays: recurrence,
      goalIndex: a.goalKey ? goalIndex.get(a.goalKey) : undefined,
    });
  }
  return {
    ok: true,
    payload: {
      title: form.title.trim(),
      category: form.category,
      description: optional(form.description),
      startDate: form.startDate,
      endDate: optional(form.endDate),
      problems: form.problems,
      goals: goals.map((g) => ({
        description: g.description.trim(),
        targetMeasure: optional(g.targetMeasure),
        targetValue: optional(g.targetValue),
        targetDate: DATE.test(g.targetDate) ? g.targetDate : undefined,
      })),
      activities: payloadActivities,
    },
  };
}

/** Server-side shape check for the payload (the API validates fully). */
export const carePlanPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(["chronic_disease", "preventive", "post_procedure", "maternal", "other"]),
  description: z.string().max(4000).optional(),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  problems: z.array(z.object({ diagnosisId: z.uuid().optional(), description: z.string().min(1).max(300) })).max(20),
  goals: z.array(z.record(z.string(), z.unknown())).max(30),
  activities: z.array(z.record(z.string(), z.unknown())).max(50),
});
