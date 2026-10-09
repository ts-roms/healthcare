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
