import type { AppointmentItem, CalendarEventItem } from "./api/types";
import { shiftDate, todayIn, zonedLocalToIso } from "./clinic-mapping";

export type CalendarView = "month" | "week" | "day";
export const CALENDAR_VIEWS: CalendarView[] = ["month", "week", "day"];

export const EVENT_KIND_LABEL: Record<CalendarEventItem["kind"], string> = {
  meeting: "Meeting",
  event: "Event",
  blocked: "Blocked time",
  training: "Training",
  reminder: "Reminder",
};

/** A day of the week (0 = Sunday) for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Sunday that starts the week containing `date`. */
export function startOfWeek(date: string): string {
  return shiftDate(date, -weekdayOf(date));
}

/** The first day of the month containing `date`. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The days a view shows: the whole weeks covering the month, seven days, or one day. */
export function viewDays(view: CalendarView, date: string): string[] {
  if (view === "day") return [date];
  if (view === "week") {
    const first = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => shiftDate(first, i));
  }
  const first = startOfWeek(startOfMonth(date));
  const nextMonth = shiftDate(startOfMonth(date), 31);
  const last = startOfMonth(nextMonth);
  const end = shiftDate(startOfWeek(shiftDate(last, -1)), 7);
  const days: string[] = [];
  for (let d = first; d < end; d = shiftDate(d, 1)) days.push(d);
  return days;
}

/** The date a "previous" / "next" step moves to. */
export function stepDate(view: CalendarView, date: string, direction: -1 | 1): string {
  if (view === "day") return shiftDate(date, direction);
  if (view === "week") return shiftDate(date, 7 * direction);
  const [y, m] = date.split("-").map(Number) as [number, number];
  const moved = new Date(Date.UTC(y, m - 1 + direction, 1));
  return moved.toISOString().slice(0, 10);
}

/** The instants [from, to) that cover a view's days in the facility's time zone. */
export function viewRange(view: CalendarView, date: string, timeZone: string): { from: string; to: string; days: string[] } {
  const days = viewDays(view, date);
  return {
    days,
    from: zonedLocalToIso(`${days[0]}T00:00`, timeZone),
    to: zonedLocalToIso(`${shiftDate(days[days.length - 1]!, 1)}T00:00`, timeZone),
  };
}

/** The facility-local date of an instant. */
export function localDay(iso: string, timeZone: string): string {
  return todayIn(timeZone, new Date(iso));
}

/** Every local day an item covers (an all-day or overnight event spans several); `endsAt` is exclusive. */
export function daysCovered(startsAt: string, endsAt: string, timeZone: string): string[] {
  const first = localDay(startsAt, timeZone);
  const lastInstant = new Date(Math.max(Date.parse(startsAt), Date.parse(endsAt) - 1));
  const last = todayIn(timeZone, lastInstant);
  const days: string[] = [];
  for (let d = first; d <= last && days.length < 45; d = shiftDate(d, 1)) days.push(d);
  return days;
}

export interface CalendarEntry {
  key: string;
  source: "event" | "appointment";
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Cancelled events and appointments stay listed, marked. */
  cancelled: boolean;
  detail: string | null;
  event?: CalendarEventItem;
  appointment?: AppointmentItem;
}

/** Events and appointments as one list of entries, by start time (all-day first). */
export function toEntries(
  events: CalendarEventItem[],
  appointments: AppointmentItem[],
  names: (a: AppointmentItem) => { title: string; detail: string | null },
): CalendarEntry[] {
  const fromEvents = events.map<CalendarEntry>((event) => ({
    key: `event-${event.id}`,
    source: "event",
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    cancelled: event.status === "cancelled",
    detail: [EVENT_KIND_LABEL[event.kind], event.location].filter(Boolean).join(" · "),
    event,
  }));
  const fromAppointments = appointments.map<CalendarEntry>((appointment) => ({
    key: `appointment-${appointment.id}`,
    source: "appointment",
    title: names(appointment).title,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    allDay: false,
    cancelled: appointment.status === "cancelled" || appointment.status === "no_show",
    detail: names(appointment).detail,
    appointment,
  }));
  return [...fromEvents, ...fromAppointments].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key),
  );
}

/** Entries by the local days they cover. */
export function entriesByDay(entries: CalendarEntry[], timeZone: string): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    for (const day of daysCovered(entry.startsAt, entry.endsAt, timeZone)) {
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    }
  }
  return byDay;
}

/** Local "HH:MM" of an instant, for a time input. */
export function localTimeOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** The instants an event form describes: all-day covers whole local days (`endDate` inclusive). */
export function eventInstants(
  form: { startDate: string; startTime: string; endDate: string; endTime: string; allDay: boolean },
  timeZone: string,
): { startsAt: string; endsAt: string } | null {
  if (!form.startDate || !form.endDate) return null;
  if (form.allDay) {
    if (form.endDate < form.startDate) return null;
    return { startsAt: zonedLocalToIso(`${form.startDate}T00:00`, timeZone), endsAt: zonedLocalToIso(`${shiftDate(form.endDate, 1)}T00:00`, timeZone) };
  }
  if (!form.startTime || !form.endTime) return null;
  const startsAt = zonedLocalToIso(`${form.startDate}T${form.startTime}`, timeZone);
  const endsAt = zonedLocalToIso(`${form.endDate}T${form.endTime}`, timeZone);
  return endsAt > startsAt ? { startsAt, endsAt } : null;
}
