import type { ActivityStatus, CarePlanStatus } from './care-plan.schema';

const PLAN_TRANSITIONS: Record<CarePlanStatus, readonly CarePlanStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const ACTIVITY_TRANSITIONS: Record<ActivityStatus, readonly ActivityStatus[]> = {
  planned: ['scheduled', 'in_progress', 'completed', 'cancelled'],
  scheduled: ['in_progress', 'completed', 'cancelled', 'planned'],
  in_progress: ['completed', 'cancelled'],
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
  const [y, m, d] = completedOn.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + intervalDays)).toISOString().slice(0, 10);
}
