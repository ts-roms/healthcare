import type { BookingOptions, BookingSlots } from "./api/types";

/**
 * Helpers for booking in MyHealth. The API decides what is bookable and
 * enforces every rule; these only shape choices and words for the screen.
 */

/** Local calendar dates (YYYY-MM-DD) patients can pick, from the first day with bookable time up to the booking horizon. */
export function bookingDays(
  now: Date,
  rules: Pick<BookingOptions["rules"], "minLeadMinutes" | "maxAdvanceDays">,
  timeZone: string,
  count = Infinity,
): string[] {
  const first = new Date(now.getTime() + rules.minLeadMinutes * 60_000);
  const last = new Date(now.getTime() + rules.maxAdvanceDays * 86_400_000);
  const days: string[] = [];
  for (let t = first.getTime(); t <= last.getTime() && days.length < count; t += 86_400_000) {
    const day = localDate(new Date(t), timeZone);
    if (days.at(-1) !== day) days.push(day);
  }
  // The horizon's own day still has bookable time before the cut-off.
  const lastDay = localDate(last, timeZone);
  if (days.length < count && days.at(-1) !== lastDay) days.push(lastDay);
  return days;
}

/** The days in pages of `size` (a week at a time fits a phone). */
export function dayPages(days: string[], size = 7): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < days.length; i += size) pages.push(days.slice(i, i + size));
  return pages;
}

export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

/** "Wed 30" / "Sep" for a date chip. Dates are calendar days, so format them at noon UTC. */
export function dayChip(date: string): { weekday: string; day: string; month: string } {
  const at = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(at);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** "Wednesday, September 30" */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-PH", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function slotTime(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(startsAt));
}

export type Slot = BookingSlots["slots"][number];

/** Slots split into morning (before 12:00) and afternoon, in facility time. */
export function slotsByPartOfDay(slots: Slot[], timeZone: string): Array<{ label: "Morning" | "Afternoon"; slots: Slot[] }> {
  const hour = (s: Slot) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date(s.startsAt)));
  const groups = [
    { label: "Morning" as const, slots: slots.filter((s) => hour(s) < 12) },
    { label: "Afternoon" as const, slots: slots.filter((s) => hour(s) >= 12) },
  ];
  return groups.filter((g) => g.slots.length > 0);
}

/** Only facilities where the chosen practitioner works (or all, for "any doctor"). */
export function practitionersAt(options: BookingOptions, facilityId: string | null) {
  return options.facilities.find((f) => f.id === facilityId)?.practitioners ?? [];
}

const MESSAGES: Record<string, string> = {
  slot_unavailable: "Someone just took that time. Please choose another.",
  booking_too_soon: "That time is too soon to book online. Choose a later time or call the clinic.",
  booking_too_far_ahead: "That date is too far ahead to book online.",
  too_many_bookings: "You already have the most online bookings allowed. Cancel one, or call the clinic.",
  change_window_closed: "It is too close to the appointment to change it online. Please call the clinic.",
  not_bookable_online: "This kind of visit cannot be booked online. Please call the clinic.",
  version_conflict: "This appointment was just changed. Reload the page to see the latest.",
};

/** A friendly message for a refused booking change. */
export function bookingMessage(code: string | undefined, fallback: string): string {
  return (code && MESSAGES[code]) || fallback;
}
