import type { RouteStepStatus, VisitPriority, VisitStatus } from "../clinic.schema";

/** Allowed queue transitions. Completion happens only when the encounter is signed. */
const TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  waiting: ["in_triage", "in_consultation", "cancelled", "left_without_being_seen"],
  in_triage: ["awaiting_consultation", "in_consultation", "left_without_being_seen"],
  awaiting_consultation: ["in_triage", "in_consultation", "left_without_being_seen"],
  in_consultation: ["awaiting_consultation", "completed"],
  completed: [],
  cancelled: [],
  left_without_being_seen: [],
};

export const ACTIVE_VISIT_STATUSES: readonly VisitStatus[] = ["waiting", "in_triage", "awaiting_consultation", "in_consultation"];

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requiresReason(to: VisitStatus): boolean {
  return to === "cancelled" || to === "left_without_being_seen";
}

/** Age from which a patient counts as a senior for the optional senior lane (an indicator for staff, not a legal test). */
export const SENIOR_AGE = 60;

/** A senior routine visit ranks between urgent and other routine visits when the facility has the senior lane on. */
const PRIORITY_RANK: Record<VisitPriority, number> = { emergency: 0, urgent: 1, routine: 3 };
const SENIOR_RANK = 2;

interface Orderable {
  priority: VisitPriority;
  checkedInAt: Date;
  /** The facility's senior lane is on and the patient is a senior; never moves an urgent or emergency visit. */
  senior?: boolean;
}

const rankOf = (v: Orderable) => (v.priority === "routine" && v.senior ? SENIOR_RANK : PRIORITY_RANK[v.priority]);

/** Queue order: priority first (seniors after urgent when `senior` is set), then arrival time. */
export function compareQueueOrder(a: Orderable, b: Orderable): number {
  return rankOf(a) - rankOf(b) || a.checkedInAt.getTime() - b.checkedInAt.getTime();
}

/**
 * Statuses from which a visit may be sent to a service point (migration 0113, ADR-0014): after triage has started or
 * finished. A waiting patient is triaged first, a patient with the provider is not moved, a closed visit is history.
 */
export const ROUTABLE_VISIT_STATUSES: readonly VisitStatus[] = ["in_triage", "awaiting_consultation"];

export function canRouteVisit(status: VisitStatus): boolean {
  return ROUTABLE_VISIT_STATUSES.includes(status);
}

/**
 * The queue of one service point: the facility's rows that are at it (null = the consultation line that existed
 * before service points), in service order — priority, then arrival. The whole facility queue uses the same order.
 */
export function servicePointQueue<T extends { priority: VisitPriority; checkedInAt: Date; servicePointId: string | null }>(
  rows: readonly T[],
  servicePointId: string | null,
): T[] {
  return rows.filter((r) => r.servicePointId === servicePointId).sort(compareQueueOrder);
}

/** How many times a called patient who did not come forward goes back in line before staff must close the visit. */
export const MAX_SKIPS = 3;

export type SkipRefusal = "visit_closed" | "not_called" | "skip_limit_reached" | "not_waiting";

/**
 * Whether a called visit may go back into the line: it is open, it was called, it is still waiting for care (not with
 * the provider), and it has not been skipped too often.
 */
export function skipRefusal(visit: { status: VisitStatus; calledAt: Date | null; skippedCount: number }): SkipRefusal | null {
  if (!ACTIVE_VISIT_STATUSES.includes(visit.status)) return "visit_closed";
  if (visit.status === "in_consultation") return "not_waiting";
  if (!visit.calledAt) return "not_called";
  if (visit.skippedCount >= MAX_SKIPS) return "skip_limit_reached";
  return null;
}

/** How many times a visit closed as left-without-being-seen may be put back in line. */
export const MAX_REQUEUES = 3;

export type RecallRefusal = "visit_closed" | "not_called";

/** A recall repeats the call to the same place: the visit must be open and already called. */
export function recallRefusal(visit: { status: VisitStatus; calledAt: Date | null }): RecallRefusal | null {
  if (!ACTIVE_VISIT_STATUSES.includes(visit.status)) return "visit_closed";
  if (!visit.calledAt) return "not_called";
  return null;
}

export type NoShowRefusal = "visit_closed" | "not_called" | "not_waiting";

/**
 * A called patient who never came forward is closed as a no-show. Only a patient who was called (so the desk tried),
 * who is still waiting for care (not with the provider), and whose visit is open.
 */
export function noShowRefusal(visit: { status: VisitStatus; calledAt: Date | null }): NoShowRefusal | null {
  if (!ACTIVE_VISIT_STATUSES.includes(visit.status)) return "visit_closed";
  if (visit.status === "in_consultation") return "not_waiting";
  if (!visit.calledAt) return "not_called";
  return null;
}

export type RequeueRefusal = "not_left" | "not_today" | "requeue_limit_reached";

/**
 * A visit closed as left-without-being-seen (including a no-show) may go back in line the same day, a limited number
 * of times. Cancelled visits (checked in by mistake) and completed visits never reopen.
 */
export function requeueRefusal(visit: { status: VisitStatus; queueDate: string; requeuedCount: number }, today: string): RequeueRefusal | null {
  if (visit.status !== "left_without_being_seen") return "not_left";
  if (visit.queueDate !== today) return "not_today";
  if (visit.requeuedCount >= MAX_REQUEUES) return "requeue_limit_reached";
  return null;
}

/** "A-007" style ticket label shown on display boards. */
export function queueTicket(queueNumber: number): string {
  return `A-${String(queueNumber).padStart(3, "0")}`;
}

/** How many called tickets the waiting-room display lists (the newest is the one being called now). */
export const QUEUE_DISPLAY_CALLS = 8;

export interface QueueDisplayRow {
  queueNumber: number;
  status: VisitStatus;
  calledAt: Date | null;
  calledTo: string | null;
  /** Online visits never appear on a waiting-room screen. */
  inPerson: boolean;
}

export interface QueueDisplayCall {
  ticket: string;
  calledTo: string;
  calledAt: Date;
}

/**
 * What the waiting-room display shows (migration 0112): the open visits staff called, newest first, with where to go,
 * and how many open visits wait (for triage or for the doctor). Ticket labels and rooms only — never a patient detail,
 * priority or the order of those waiting (priority would make it appear to jump).
 */
export function queueDisplay(rows: readonly QueueDisplayRow[], limit = QUEUE_DISPLAY_CALLS): { calls: QueueDisplayCall[]; waiting: number } {
  const open = rows.filter((r) => r.inPerson && ACTIVE_VISIT_STATUSES.includes(r.status));
  const calls = open
    .filter((r): r is QueueDisplayRow & { calledAt: Date; calledTo: string } => r.calledAt !== null && !!r.calledTo)
    .sort((a, b) => b.calledAt.getTime() - a.calledAt.getTime())
    .slice(0, limit)
    .map((r) => ({ ticket: queueTicket(r.queueNumber), calledTo: r.calledTo, calledAt: r.calledAt }));
  const waiting = open.filter((r) => r.status === "waiting" || r.status === "awaiting_consultation").length;
  return { calls, waiting };
}

// ---- Visit routes (migration 0115) ----------------------------------------------------------------------------

/** The planned stops of a visit in the plan's order (removed steps are history and never counted). */
export interface RouteStepLike {
  position: number;
  status: RouteStepStatus;
  servicePointId: string;
}

/** The step the visit is at now, if the visit is at a step of its route. */
export function currentRouteStep<T extends RouteStepLike>(steps: readonly T[]): T | null {
  return steps.find((s) => s.status === "current") ?? null;
}

/** The next stop still ahead: the planned step with the lowest position. */
export function nextRouteStep<T extends RouteStepLike>(steps: readonly T[]): T | null {
  return [...steps].filter((s) => s.status === "planned").sort((a, b) => a.position - b.position)[0] ?? null;
}

/** Steps still part of the plan, in order (removed ones left out). */
export function routeInPlan<T extends RouteStepLike>(steps: readonly T[]): T[] {
  return [...steps].filter((s) => s.status !== "removed").sort((a, b) => a.position - b.position);
}

/** A route is complete when no step is current or still planned (and at least one was planned). */
export function routeComplete(steps: readonly RouteStepLike[]): boolean {
  const inPlan = routeInPlan(steps);
  return inPlan.length > 0 && inPlan.every((s) => s.status === "done" || s.status === "skipped");
}

export type RouteAdvance<T> = { ok: true; current: T | null; next: T | null } | { ok: false; code: "visit_not_routable" | "no_route" | "route_complete" };

/**
 * Whether "done here, send on" may run: the visit must be in a state that can be routed (the same rule as any move
 * between service points), it must have a route, and the route must not be complete. The answer names the step
 * being finished (if the visit is at one) and the step to go to (null at the last stop: the step is marked done and
 * the visit stays where it is).
 */
export function canAdvanceRoute<T extends RouteStepLike>(status: VisitStatus, steps: readonly T[]): RouteAdvance<T> {
  if (!canRouteVisit(status)) return { ok: false, code: "visit_not_routable" };
  if (routeInPlan(steps).length === 0) return { ok: false, code: "no_route" };
  const current = currentRouteStep(steps);
  const next = nextRouteStep(steps);
  if (!current && !next) return { ok: false, code: "route_complete" };
  return { ok: true, current, next };
}

/**
 * Checks a plan of next stops: at least one, no stop repeated back to back, and the first not the service point the
 * visit is already at — "send on" would otherwise go nowhere. Returns the refusal code, or null when the plan is fine.
 */
export function routePlanProblem(servicePointIds: readonly string[], atServicePointId: string | null): "route_empty" | "route_step_repeated" | null {
  if (servicePointIds.length === 0) return "route_empty";
  let previous = atServicePointId;
  for (const id of servicePointIds) {
    if (id === previous) return "route_step_repeated";
    previous = id;
  }
  return null;
}
