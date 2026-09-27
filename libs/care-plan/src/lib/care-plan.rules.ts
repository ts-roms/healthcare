import type { ActivityStatus, CarePlanStatus } from "./care-plan.schema";

const PLAN_TRANSITIONS: Record<CarePlanStatus, readonly CarePlanStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const ACTIVITY_TRANSITIONS: Record<ActivityStatus, readonly ActivityStatus[]> = {
  planned: ["scheduled", "in_progress", "completed", "cancelled"],
  scheduled: ["in_progress", "completed", "cancelled", "planned"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canChangePlanStatus(from: CarePlanStatus, to: CarePlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

export function canChangeActivityStatus(from: ActivityStatus, to: ActivityStatus): boolean {
  return ACTIVITY_TRANSITIONS[from].includes(to);
}

/** Next due date of a recurring activity (e.g. HbA1c every 90 days), counted from completion. */
export function nextDueDate(completedOn: string, intervalDays: number): string {
  const [y, m, d] = completedOn.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + intervalDays)).toISOString().slice(0, 10);
}

/** Activities a patient acts on by booking something (a visit, a laboratory test), so worth a recall reminder. */
export const RECALL_KINDS = ["follow_up_appointment", "laboratory_monitoring"] as const;

export const RECALL_RULES = {
  /** "Due" reminder from this many days before the due date. */
  dueWindowDays: 7,
  /** "Overdue" reminder once this many days have passed without booking. */
  overdueAfterDays: 7,
  /** Stop reminding after this; the care team follows up from the recall list. */
  giveUpAfterDays: 30,
  /** Local hours (Asia/Manila) in which reminders are sent: no messages at night. */
  sendFromHour: 8,
  sendUntilHour: 20,
} as const;

/** Which recall reminder applies to an open activity today, if any. Dates are local YYYY-MM-DD. */
export function recallReminderKind(dueDate: string, today: string): "due" | "overdue" | null {
  const days = daysBetween(dueDate, today); // positive once the due date has passed
  if (days >= RECALL_RULES.overdueAfterDays && days <= RECALL_RULES.giveUpAfterDays) return "overdue";
  if (days >= -RECALL_RULES.dueWindowDays && days < RECALL_RULES.overdueAfterDays) return "due";
  return null;
}

export function withinSendingHours(localHour: number): boolean {
  return localHour >= RECALL_RULES.sendFromHour && localHour < RECALL_RULES.sendUntilHour;
}

function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}
