import type { Appointment, AppointmentStatus, QueueEntry, QueueStatus } from "@healthcare/domain";
import type { AppointmentItem, AppointmentStatusApi, Practitioner, QueueVisit, VisitStatus, VisitType } from "./api/types";

/**
 * Adapters from the clinic API to the design system's queue board and
 * schedule rows. The API is authoritative for every rule: the helpers that
 * decide which buttons to show only mirror it so staff are not offered
 * actions the API would refuse.
 */

const QUEUE_COLUMN: Record<VisitStatus, QueueStatus> = {
  waiting: "waiting",
  in_triage: "vitals",
  awaiting_consultation: "ready",
  in_consultation: "with-provider",
  completed: "done",
  cancelled: "done",
  left_without_being_seen: "done",
};

const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  waiting: "Waiting",
  in_triage: "In triage",
  awaiting_consultation: "Ready for provider",
  in_consultation: "With provider",
  completed: "Seen",
  cancelled: "Cancelled",
  left_without_being_seen: "Left without being seen",
};

/** Columns of the live queue board (the API queue has no billing step yet). */
export const QUEUE_BOARD_STATUSES: QueueStatus[] = ["waiting", "vitals", "ready", "with-provider", "done"];

export function visitStatusLabel(status: VisitStatus): string {
  return VISIT_STATUS_LABEL[status];
}

export function toQueueEntry(v: QueueVisit): QueueEntry {
  return {
    id: v.id,
    ticket: v.ticket,
    patientName: v.patient?.displayName ?? "Patient",
    // Where the patient was called to, else what they are waiting for.
    station: v.calledTo ? `Called to ${v.calledTo}` : [VISIT_STATUS_LABEL[v.status], v.chiefComplaint].filter(Boolean).join(" · "),
    status: QUEUE_COLUMN[v.status],
    arrivedAt: v.checkedInAt,
    priority: v.priority === "routine" ? undefined : v.priority,
  };
}

export type QueueMove = "in_triage" | "awaiting_consultation" | "cancelled" | "left_without_being_seen";

/** Moves the API allows from each status (`libs/clinic` queue-state); closing moves need a reason. */
const QUEUE_MOVES: Record<VisitStatus, QueueMove[]> = {
  waiting: ["in_triage", "cancelled", "left_without_being_seen"],
  in_triage: ["awaiting_consultation", "left_without_being_seen"],
  awaiting_consultation: ["in_triage", "left_without_being_seen"],
  in_consultation: [],
  completed: [],
  cancelled: [],
  left_without_being_seen: [],
};

export function queueMoves(status: VisitStatus): QueueMove[] {
  return QUEUE_MOVES[status];
}

/** Triage can be recorded (or repeated) until the consultation starts (`libs/clinic` triage service). */
export function canTriage(status: VisitStatus): boolean {
  return status === "waiting" || status === "in_triage" || status === "awaiting_consultation";
}

/** A consultation can start from any active status before it (`libs/clinic` queue-state transitions to in_consultation). */
export function canStartConsultation(status: VisitStatus): boolean {
  return status === "waiting" || status === "in_triage" || status === "awaiting_consultation";
}

export function moveNeedsReason(move: QueueMove): boolean {
  return move === "cancelled" || move === "left_without_being_seen";
}

export const QUEUE_MOVE_LABEL: Record<QueueMove, string> = {
  in_triage: "Send to triage",
  awaiting_consultation: "Ready for provider",
  cancelled: "Cancel visit",
  left_without_being_seen: "Left without being seen",
};

const APPOINTMENT_STATUS: Record<AppointmentStatusApi, AppointmentStatus> = {
  booked: "booked",
  confirmed: "confirmed",
  checked_in: "arrived",
  completed: "completed",
  cancelled: "cancelled",
  no_show: "no-show",
};

export function toAppointment(a: AppointmentItem, practitioners: Map<string, Practitioner>, visitTypes: Map<string, VisitType>): Appointment {
  const visitType = visitTypes.get(a.visitTypeId);
  const online = visitType?.modality === "telemedicine";
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patient ? `${a.patient.displayName} · ${a.patient.patientNumber}` : "Patient",
    provider: practitioners.get(a.practitionerId)?.displayName ?? "Practitioner",
    start: a.startsAt,
    durationMin: Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000),
    type: online ? "telemedicine" : "consultation",
    mode: online ? "online" : "in-person",
    status: APPOINTMENT_STATUS[a.status],
    reason: [visitType?.name, a.reason].filter(Boolean).join(" · ") || undefined,
  };
}

export type AppointmentAction = "confirm" | "check_in" | "cancel" | "no_show";

/**
 * Actions to offer on a schedule row (`libs/clinic` appointment-state):
 * check-in only on the appointment's own day, a no-show only after it started.
 */
export function appointmentActions(
  a: Pick<AppointmentItem, "status" | "startsAt">,
  context: { now: Date; isToday: boolean; canManage: boolean; canCheckIn: boolean },
): AppointmentAction[] {
  const open = a.status === "booked" || a.status === "confirmed";
  if (!open) return [];
  const actions: AppointmentAction[] = [];
  if (context.canCheckIn && context.isToday) actions.push("check_in");
  if (context.canManage && a.status === "booked") actions.push("confirm");
  if (context.canManage && context.now >= new Date(a.startsAt)) actions.push("no_show");
  if (context.canManage) actions.push("cancel");
  return actions;
}

/** Schedule rows grouped by practitioner, practitioners in name order, rows by start time. */
export function groupByPractitioner<T extends { practitionerId: string; startsAt: string }>(
  items: T[],
  practitioners: Map<string, Practitioner>,
): Array<{ practitioner: Practitioner | undefined; practitionerId: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.practitionerId, [...(groups.get(item.practitionerId) ?? []), item]);
  return [...groups.entries()]
    .map(([practitionerId, rows]) => ({
      practitionerId,
      practitioner: practitioners.get(practitionerId),
      items: rows.sort((x, y) => x.startsAt.localeCompare(y.startsAt)),
    }))
    .sort((x, y) => (x.practitioner?.displayName ?? "").localeCompare(y.practitioner?.displayName ?? ""));
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no time zone). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's date in the facility's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Open appointments that have not ended yet, in start order (for "next patients"). */
export function upcomingAppointments<T extends Pick<AppointmentItem, "status" | "startsAt" | "endsAt">>(items: T[], now: Date = new Date()): T[] {
  return items
    .filter((a) => (a.status === "booked" || a.status === "confirmed") && Date.parse(a.endsAt) >= now.getTime())
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt));
}
