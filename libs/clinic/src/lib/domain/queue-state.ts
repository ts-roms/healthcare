import type { VisitPriority, VisitStatus } from "../clinic.schema";

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

const PRIORITY_RANK: Record<VisitPriority, number> = { emergency: 0, urgent: 1, routine: 2 };

/** Queue order: priority first, then arrival time. */
export function compareQueueOrder(a: { priority: VisitPriority; checkedInAt: Date }, b: { priority: VisitPriority; checkedInAt: Date }): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.checkedInAt.getTime() - b.checkedInAt.getTime();
}

/** "A-007" style ticket label shown on display boards. */
export function queueTicket(queueNumber: number): string {
  return `A-${String(queueNumber).padStart(3, "0")}`;
}
