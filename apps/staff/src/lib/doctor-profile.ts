import type { AppointmentItem, PractitionerDetail, ScheduleExceptionRow } from "./api/types";
import { shiftDate, todayIn, zonedLocalToIso } from "./clinic-mapping";

/**
 * Figures and drawing data for a doctor's profile (`/doctors/[id]`): weekly hours, the schedule bars, slots in a week,
 * the month calendar's marks, the upcoming list and the steps left to finish the profile. Everything here is derived from
 * the practitioner's active schedule, closures and appointments at one facility; the API stays the authority on what can
 * be booked.
 */

/** A weekly schedule row as the profile needs it (`dayOfWeek` 0 = Sunday, times "HH:MM" or "HH:MM:SS"). */
export interface ScheduleHours {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

/** "08:30" or "08:30:00" as minutes after midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Appointment slots one schedule row offers: whole slots that fit between its start and end. */
export function slotsOf(row: ScheduleHours): number {
  return Math.max(0, Math.floor((minutesOf(row.endTime) - minutesOf(row.startTime)) / row.slotMinutes));
}

/** Hours worked in a week and on how many days. */
export function weeklyHours(rows: readonly ScheduleHours[]): { minutes: number; clinicDays: number } {
  return {
    minutes: rows.reduce((sum, r) => sum + Math.max(0, minutesOf(r.endTime) - minutesOf(r.startTime)), 0),
    clinicDays: new Set(rows.map((r) => r.dayOfWeek)).size,
  };
}

/** "4 h", "37 h 30 min", "45 min". */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return m === 0 ? "0 h" : `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The hours the schedule bars cover: 08:00–20:00, widened to whole hours when a schedule starts earlier or ends later. */
export function barWindow(rows: readonly ScheduleHours[]): { start: number; end: number } {
  const starts = rows.map((r) => minutesOf(r.startTime));
  const ends = rows.map((r) => minutesOf(r.endTime));
  return { start: Math.min(8 * 60, ...starts.map((s) => Math.floor(s / 60) * 60)), end: Math.max(20 * 60, ...ends.map((e) => Math.ceil(e / 60) * 60)) };
}

export interface DayBar {
  dayOfWeek: number;
  /** Filled stretches of the bar, as percentages of the window. */
  segments: { left: number; width: number }[];
  /** "08:00-12:00" (several stretches joined by a comma); null when the doctor is not in clinic that day. */
  hours: string | null;
  slots: number;
}

/** Monday to Sunday, in that order, as the bars the schedule card draws. */
export function dayBars(rows: readonly ScheduleHours[], window: { start: number; end: number } = barWindow(rows)): DayBar[] {
  const span = window.end - window.start;
  return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
    const own = rows.filter((r) => r.dayOfWeek === dayOfWeek).sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
    return {
      dayOfWeek,
      segments: own.map((r) => ({
        left: ((minutesOf(r.startTime) - window.start) / span) * 100,
        width: ((minutesOf(r.endTime) - minutesOf(r.startTime)) / span) * 100,
      })),
      hours: own.length ? own.map((r) => `${hhmm(minutesOf(r.startTime))}-${hhmm(minutesOf(r.endTime))}`).join(", ") : null,
      slots: own.reduce((sum, r) => sum + slotsOf(r), 0),
    };
  });
}

/** The line under the bars: the slot length, or that it varies. */
export function slotLengthNote(rows: readonly ScheduleHours[]): string {
  const lengths = [...new Set(rows.map((r) => r.slotMinutes))];
  return lengths.length === 1 ? `Slots are ${lengths[0]} minutes.` : "Slot length varies by day.";
}

/** The Monday after today, or tomorrow when today is a Sunday: where "next week" starts. */
export function nextWeekStart(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return shiftDate(today, dow === 0 ? 1 : 8 - dow);
}

/** Whether a closure touches the local day `date` in the facility's zone. */
export function closureTouchesDay(closure: Pick<ScheduleExceptionRow, "startsAt" | "endsAt">, date: string, timeZone: string): boolean {
  const dayStart = Date.parse(zonedLocalToIso(`${date}T00:00`, timeZone));
  const dayEnd = Date.parse(zonedLocalToIso(`${shiftDate(date, 1)}T00:00`, timeZone));
  return Date.parse(closure.startsAt) < dayEnd && Date.parse(closure.endsAt) > dayStart;
}

/**
 * Slots the schedule offers in the week after this one. A day touched by any closure (the doctor's leave or the whole
 * facility's) counts as none: a closure that covers only part of a day takes the whole day out of this figure.
 */
export function nextWeekCapacity(
  rows: readonly ScheduleHours[],
  closures: readonly Pick<ScheduleExceptionRow, "startsAt" | "endsAt">[],
  today: string,
  timeZone: string,
): number {
  const start = nextWeekStart(today);
  let slots = 0;
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(start, i);
    if (closures.some((c) => closureTouchesDay(c, date, timeZone))) continue;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    slots += rows.filter((r) => r.dayOfWeek === dow).reduce((sum, r) => sum + slotsOf(r), 0);
  }
  return slots;
}

/** Days of the month `YYYY-MM` that a closure touches. */
export function closedDaysIn(month: string, closures: readonly Pick<ScheduleExceptionRow, "startsAt" | "endsAt">[], timeZone: string): Set<string> {
  const days = new Set<string>();
  const first = `${month}-01`;
  for (let i = 0; i < 31; i++) {
    const date = shiftDate(first, i);
    if (!date.startsWith(month)) break;
    if (closures.some((c) => closureTouchesDay(c, date, timeZone))) days.add(date);
  }
  return days;
}

/** The month `YYYY-MM` as shown, from the `?month=` of the address (anything else is the current month). */
export function monthOf(param: string | undefined, today: string): string {
  return param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : today.slice(0, 7);
}

/** The month before or after `YYYY-MM`. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first and the last local day of a month, for the appointment and closure queries. */
export function monthRange(month: string): { first: string; next: string } {
  return { first: `${month}-01`, next: `${shiftMonth(month, 1)}-01` };
}

export interface UpcomingDay {
  date: string;
  /** "MON, OCT 26" */
  label: string;
  items: AppointmentItem[];
}

/** Booked or confirmed appointments that have not ended, grouped by their day in the facility's zone, soonest first. */
export function upcomingByDay(items: readonly AppointmentItem[], timeZone: string, now: Date = new Date()): UpcomingDay[] {
  const open = items
    .filter((a) => (a.status === "booked" || a.status === "confirmed" || a.status === "checked_in") && Date.parse(a.endsAt) >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const days: UpcomingDay[] = [];
  for (const a of open) {
    const date = todayIn(timeZone, new Date(a.startsAt));
    let day = days.find((d) => d.date === date);
    if (!day) {
      day = {
        date,
        label: new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
          .format(new Date(`${date}T12:00:00Z`))
          .toUpperCase(),
        items: [],
      };
      days.push(day);
    }
    day.items.push(a);
  }
  return days;
}

export interface SetupStep {
  key: "account" | "licence" | "schedule";
  label: string;
  /** Why it matters, shown beside the step. */
  hint: string;
}

/** What is still missing from a profile: a staff account to document and prescribe with, the licence number, a schedule. */
export function setupSteps(practitioner: Pick<PractitionerDetail, "userId" | "licenseNumber">, hasSchedule: boolean): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!practitioner.userId) steps.push({ key: "account", label: "Link a staff account", hint: "needed to document & prescribe" });
  if (!practitioner.licenseNumber) steps.push({ key: "licence", label: "Add PRC licence number", hint: "printed on certificates and referrals" });
  if (!hasSchedule) steps.push({ key: "schedule", label: "Add a weekly schedule", hint: "so patients can be booked" });
  return steps;
}
