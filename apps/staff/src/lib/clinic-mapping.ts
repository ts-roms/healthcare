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
    station: v.calledTo
      ? `Called to ${v.calledTo}`
      : [VISIT_STATUS_LABEL[v.status], checkedInOnline(v) ? "Checked in online" : null, v.chiefComplaint].filter(Boolean).join(" · "),
    status: QUEUE_COLUMN[v.status],
    arrivedAt: v.checkedInAt,
    priority: v.priority === "routine" ? undefined : v.priority,
  };
}

/** An in-person patient who checked in from MyHealth, so the desk knows they may not have come to the counter. */
export function checkedInOnline(v: Pick<QueueVisit, "checkedInVia" | "modality">): boolean {
  return v.checkedInVia === "patient_portal" && v.modality === "in_person";
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
    reason: [visitType?.name, a.bookedByPatient ? "Booked online by the patient" : null, a.reason].filter(Boolean).join(" · ") || undefined,
  };
}

export type AppointmentAction = "confirm" | "check_in" | "reschedule" | "cancel" | "no_show";

/**
 * Actions to offer on a schedule row (`libs/clinic` appointment-state):
 * check-in only on the appointment's own day (never at the desk for an online one), a no-show only after it started.
 */
export function appointmentActions(
  a: Pick<AppointmentItem, "status" | "startsAt">,
  context: { now: Date; isToday: boolean; canManage: boolean; canCheckIn: boolean; online?: boolean },
): AppointmentAction[] {
  const open = a.status === "booked" || a.status === "confirmed";
  if (!open) return [];
  const actions: AppointmentAction[] = [];
  // An online appointment is checked in by the patient entering the MyHealth waiting room, not at the front desk.
  if (context.canCheckIn && context.isToday && !context.online) actions.push("check_in");
  if (context.canManage && a.status === "booked") actions.push("confirm");
  if (context.canManage && context.now >= new Date(a.startsAt)) actions.push("no_show");
  if (context.canManage) actions.push("reschedule", "cancel");
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

/**
 * The day's appointments laid out by room (migration 0096 views): one column per active room of the facility, in
 * name order, then "No room" for bookings without one. Rooms with nothing booked are kept so an empty room shows as such.
 */
export function groupByRoom<T extends { room?: { id: string; name: string } | null; startsAt: string }>(
  items: T[],
  rooms: ReadonlyArray<{ id: string; name: string; status?: "active" | "inactive" }>,
): Array<{ roomId: string | null; name: string; items: T[] }> {
  const byRoom = new Map<string | null, T[]>();
  for (const item of items) {
    const key = item.room?.id ?? null;
    byRoom.set(key, [...(byRoom.get(key) ?? []), item]);
  }
  const sortByStart = (rows: T[]) => rows.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  const known = new Set(rooms.map((r) => r.id));
  const columns: Array<{ roomId: string | null; name: string; items: T[] }> = rooms
    .filter((r) => r.status !== "inactive" || byRoom.has(r.id))
    .map((r) => ({ roomId: r.id, name: r.name, items: sortByStart(byRoom.get(r.id) ?? []) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // A room the list does not know (retired, or another facility's) still gets its column.
  for (const [key, rows] of byRoom) {
    if (key && !known.has(key)) columns.push({ roomId: key, name: rows[0]?.room?.name ?? "Room", items: sortByStart(rows) });
  }
  const none = byRoom.get(null);
  if (none?.length) columns.push({ roomId: null, name: "No room", items: sortByStart(none) });
  return columns;
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

/** Referral status as a label, badge variant and icon tone (never colour alone). */
export const REFERRAL_STATUS: Record<
  "sent" | "accepted" | "declined" | "completed" | "cancelled",
  { label: string; variant: "info" | "success" | "warning" | "neutral"; tone: "waiting" | "done" | "stopped" }
> = {
  sent: { label: "Awaiting answer", variant: "info", tone: "waiting" },
  accepted: { label: "Accepted", variant: "success", tone: "waiting" },
  declined: { label: "Declined", variant: "warning", tone: "stopped" },
  completed: { label: "Completed", variant: "success", tone: "done" },
  cancelled: { label: "Cancelled", variant: "neutral", tone: "stopped" },
};

export const REFERRAL_URGENCY_LABEL: Record<"routine" | "urgent" | "emergency", string> = {
  routine: "Routine",
  urgent: "Urgent",
  emergency: "Emergency",
};

/** Who a referral goes to, in one line. */
export function referralRecipient(r: {
  kind: "internal" | "external";
  toPractitioner: { displayName: string } | null;
  externalProvider: string | null;
  externalFacility: string | null;
}): string {
  return r.kind === "internal"
    ? (r.toPractitioner?.displayName ?? "A practitioner here")
    : [r.externalProvider, r.externalFacility].filter(Boolean).join(", ") || "Outside provider";
}

/** "2026-10-01T09:30" as a wall-clock time in `timeZone` → the ISO instant (e.g. "2026-10-01T01:30:00.000Z" for Manila). */
export function zonedLocalToIso(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error("Expected YYYY-MM-DDTHH:MM");
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment, from what the wall clock reads there.
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - Math.floor(instant / 60_000) * 60_000;
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first)).toISOString();
}
