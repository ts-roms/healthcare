import type { AppointmentItem, PractitionerScheduleRow, ScheduleExceptionRow } from "@/lib/api/types";
import { scheduleBlocksOn } from "@/lib/clinic-mapping";

/**
 * The appointments day board (`/appointments`): what a practitioner's day looks like on the timeline, how many slots
 * are still open and the day's figures. Display arithmetic only — the API decides what can be booked
 * (`GET /appointments/availability`); nothing here is a booking rule.
 */

/** A span of the day in minutes from midnight, in the facility's time zone. */
export interface DaySpan {
  start: number;
  end: number;
}

export interface WorkingBlock extends DaySpan {
  roomId: string | null;
  slotMinutes: number;
}

export interface Closure extends DaySpan {
  reason: string;
}

export interface UnavailableBand extends DaySpan {
  label: string;
}

/** Statuses that hold the practitioner's time. */
const HOLDS_TIME: ReadonlySet<AppointmentItem["status"]> = new Set(["booked", "confirmed", "checked_in", "completed"]);

export function holdsTime(a: Pick<AppointmentItem, "status">): boolean {
  return HOLDS_TIME.has(a.status);
}

/** Minutes from midnight of an instant, as the wall clock reads in `timeZone`. */
export function minutesInZone(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

/** "08:00" or "08:00:00" → 480. */
export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number) as [number, number];
  return h * 60 + (m || 0);
}

/** 480 → "08:00". */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The practitioner's published working blocks at the facility on `date`, in start order. */
export function workingBlocks(rows: readonly PractitionerScheduleRow[], practitionerId: string, facilityId: string, date: string): WorkingBlock[] {
  return scheduleBlocksOn(rows, practitionerId, facilityId, date)
    .map((s) => ({ start: clockToMinutes(s.startTime), end: clockToMinutes(s.endTime), roomId: s.roomId, slotMinutes: s.slotMinutes }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Closures that touch the practitioner on `date` (their own and the whole facility's), clipped to the day.
 * `dayStart` is the instant the date begins in the facility's zone.
 */
export function closuresOn(
  exceptions: readonly ScheduleExceptionRow[],
  practitionerId: string,
  dayStartIso: string,
  dayEndIso: string,
  timeZone: string,
): Closure[] {
  const from = Date.parse(dayStartIso);
  const to = Date.parse(dayEndIso);
  return exceptions
    .filter((e) => (e.practitionerId === null || e.practitionerId === practitionerId) && Date.parse(e.endsAt) > from && Date.parse(e.startsAt) < to)
    .map((e) => ({
      start: Date.parse(e.startsAt) <= from ? 0 : minutesInZone(e.startsAt, timeZone),
      end: Date.parse(e.endsAt) >= to ? 24 * 60 : minutesInZone(e.endsAt, timeZone),
      reason: e.reason,
    }))
    .sort((a, b) => a.start - b.start);
}

/** The day the timeline always shows, so a day with few bookings still reads as a full day. */
export const CLINIC_DAY: DaySpan = { start: 8 * 60, end: 17 * 60 };

/**
 * The hours the timeline shows: the whole clinic day (08:00–17:00), widened on whole hours to any working block or
 * appointment outside it (an evening booking, an early clinic).
 */
export function timelineRange(blocks: readonly DaySpan[], appointments: readonly DaySpan[]): DaySpan {
  const spans = [CLINIC_DAY, ...blocks, ...appointments];
  const start = Math.min(...spans.map((s) => s.start));
  const end = Math.min(24 * 60, Math.max(...spans.map((s) => s.end)));
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

/**
 * The parts of the shown range the practitioner is not available: before, between ("Break") and after their working
 * blocks, and closures (with their reason). With no working blocks at all the whole range is "Not scheduled".
 */
export function unavailableBands(blocks: readonly DaySpan[], closures: readonly Closure[], range: DaySpan): UnavailableBand[] {
  const bands: UnavailableBand[] = [];
  if (blocks.length === 0) {
    bands.push({ ...range, label: "Not scheduled" });
  } else {
    let cursor = range.start;
    blocks.forEach((b, i) => {
      if (b.start > cursor) bands.push({ start: cursor, end: Math.min(b.start, range.end), label: i === 0 ? "Not scheduled" : "Break" });
      cursor = Math.max(cursor, b.end);
    });
    if (cursor < range.end) bands.push({ start: cursor, end: range.end, label: "Not scheduled" });
  }
  for (const c of closures) {
    const start = Math.max(c.start, range.start);
    const end = Math.min(c.end, range.end);
    if (end > start) bands.push({ start, end, label: c.reason || "Closed" });
  }
  return bands.filter((b) => b.end > b.start);
}

/**
 * Slots in the working blocks (each block cut into its `slotMinutes`) and how many are still free: not overlapped by an
 * appointment that holds time or by a closure. A count for the desk, not the API's availability.
 */
export function slotCount(blocks: readonly WorkingBlock[], closures: readonly DaySpan[], booked: readonly DaySpan[]): { open: number; total: number } {
  let open = 0;
  let total = 0;
  const overlaps = (a: DaySpan, b: DaySpan) => a.start < b.end && b.start < a.end;
  for (const block of blocks) {
    const step = Math.max(5, block.slotMinutes);
    for (let start = block.start; start + step <= block.end; start += step) {
      const slot = { start, end: start + step };
      total++;
      if (!closures.some((c) => overlaps(c, slot)) && !booked.some((b) => overlaps(b, slot))) open++;
    }
  }
  return { open, total };
}

/** An appointment on the timeline, with the lane it sits in when appointments overlap. */
export interface PlacedAppointment<T> extends DaySpan {
  item: T;
  lane: number;
  lanes: number;
}

/** Places appointments on the timeline; overlapping ones (e.g. a double booking) sit side by side. */
export function placeAppointments<T extends Pick<AppointmentItem, "startsAt" | "endsAt">>(items: readonly T[], timeZone: string): PlacedAppointment<T>[] {
  const spans = items
    .map((item) => {
      const start = minutesInZone(item.startsAt, timeZone);
      const end = Math.max(start + 5, minutesInZone(item.endsAt, timeZone) || 24 * 60);
      return { item, start, end, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  // Clusters of mutually overlapping appointments share a lane count.
  let cluster: typeof spans = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((s) => s.lane + 1));
    for (const s of cluster) s.lanes = lanes;
    cluster = [];
  };
  for (const span of spans) {
    if (span.start >= clusterEnd) close();
    const used = new Set(cluster.filter((s) => s.end > span.start).map((s) => s.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    span.lane = lane;
    cluster.push(span);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  close();
  return spans;
}

export interface DayFigures {
  /** Appointments that hold time (not cancelled or missed). */
  scheduled: number;
  bookedMinutes: number;
  /** Arrived: checked in or seen. */
  checkedIn: number;
  /** The next booked or confirmed appointment that has not ended (on another day: the first of the day). */
  nextUp: AppointmentItem | null;
}

export function dayFigures(items: readonly AppointmentItem[], now: Date): DayFigures {
  const holding = items.filter(holdsTime);
  const next = items
    .filter((a) => (a.status === "booked" || a.status === "confirmed") && Date.parse(a.endsAt) >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return {
    scheduled: holding.length,
    bookedMinutes: holding.reduce((sum, a) => sum + Math.max(0, Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000)), 0),
    checkedIn: items.filter((a) => a.status === "checked_in" || a.status === "completed").length,
    nextUp: next ?? null,
  };
}

/** "1 h 30 min", "45 min". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The Monday-to-Sunday week that contains `date` (YYYY-MM-DD, calendar arithmetic). */
export function weekOf(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d));
  const offset = (base.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d - offset + i)).toISOString().slice(0, 10));
}

/** Initials for an avatar: "Dr. Ana Santos" → "AS", "SANTOS, Maria Reyes" → "MS". */
export function initialsOf(name: string): string {
  const cleaned = name.replace(/^(dr|dra|mr|mrs|ms)\.?\s+/i, "").trim();
  const [family, given] = cleaned.includes(",") ? cleaned.split(",").map((s) => s.trim()) : [null, cleaned];
  const words = (given ?? "").split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = family ? family[0] : words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last ?? ""}`.toUpperCase() || "?";
}
