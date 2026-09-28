import type { SendOutStatus } from "./send-out.schema";

/**
 * Send-out rules (pure; enforced again by the database trigger lab_send_out_guard):
 *   prepared → dispatched | cancelled
 *   dispatched → results_received | rejected (by the reference laboratory) | cancelled
 * results_received, rejected and cancelled are final.
 */
const TRANSITIONS: Record<SendOutStatus, readonly SendOutStatus[]> = {
  prepared: ["dispatched", "cancelled"],
  dispatched: ["results_received", "rejected", "cancelled"],
  results_received: [],
  rejected: [],
  cancelled: [],
};

export function canMoveSendOut(from: SendOutStatus, to: SendOutStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** In flight: at most one per ordered test (partial unique index lab_send_out_in_flight_idx). */
export const IN_FLIGHT_SEND_OUT_STATUSES = ["prepared", "dispatched"] as const satisfies readonly SendOutStatus[];

/** Send-outs that decide who performs the test of a specimen: in flight, or answered by the reference laboratory. */
export const CURRENT_SEND_OUT_STATUSES = ["prepared", "dispatched", "results_received"] as const satisfies readonly SendOutStatus[];

/** Tests the laboratory is still waiting on: in-house result entry is blocked until the reference laboratory answers. */
export function awaitsReferenceLab(status: SendOutStatus | null | undefined): boolean {
  return status === "prepared" || status === "dispatched";
}

export function manifestNumber(sequence: number): string {
  return `SM${String(sequence).padStart(8, "0")}`;
}

/** Expected turnaround: the referral's (reference laboratory) figure, else the test's own. */
export function expectedTurnaround(referralMinutes: number | null | undefined, testMinutes: number | null | undefined): number | null {
  return referralMinutes ?? testMinutes ?? null;
}

export interface SendOutTiming {
  /** When results are expected (dispatch + turnaround); null before dispatch or without a turnaround. */
  dueAt: Date | null;
  /** Minutes since dispatch while waiting on the reference laboratory; null otherwise. */
  minutesOut: number | null;
  overdue: boolean;
}

/** Turnaround as the laboratory sees it (counted from dispatch). A display aid for follow-up, not a rule. */
export function sendOutTiming(
  row: { status: SendOutStatus; dispatchedAt: Date | null; turnaroundMinutes: number | null; resultsReceivedAt?: Date | null },
  now: Date,
): SendOutTiming {
  if (!row.dispatchedAt) return { dueAt: null, minutesOut: null, overdue: false };
  const dueAt = row.turnaroundMinutes ? new Date(row.dispatchedAt.getTime() + row.turnaroundMinutes * 60_000) : null;
  const waiting = row.status === "dispatched";
  const end = waiting ? now : (row.resultsReceivedAt ?? null);
  const minutesOut = end ? Math.max(0, Math.round((end.getTime() - row.dispatchedAt.getTime()) / 60_000)) : null;
  return { dueAt, minutesOut, overdue: waiting && !!dueAt && dueAt.getTime() < now.getTime() };
}

export interface DispatchCandidate {
  id: string;
  status: SendOutStatus;
  facilityId: string;
  referenceLaboratoryId: string;
}

/** Why a set of send-outs cannot travel together in one dispatch, or null when it can. */
export function dispatchProblem(sendOuts: DispatchCandidate[], facilityId: string): { code: string; message: string } | null {
  if (sendOuts.length === 0) return { code: "nothing_to_dispatch", message: "Choose the send-outs to dispatch" };
  if (sendOuts.some((s) => s.facilityId !== facilityId)) return { code: "wrong_facility", message: "These send-outs belong to another facility" };
  if (sendOuts.some((s) => s.status !== "prepared"))
    return { code: "send_out_not_prepared", message: "Only prepared send-outs are dispatched (some were already dispatched, cancelled or answered)" };
  if (new Set(sendOuts.map((s) => s.referenceLaboratoryId)).size > 1)
    return { code: "mixed_reference_laboratories", message: "One dispatch goes to one reference laboratory; dispatch each laboratory's specimens separately" };
  return null;
}
