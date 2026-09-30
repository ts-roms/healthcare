/**
 * Rules for patients booking their own appointments in MyHealth. Staff booking is not limited by these. Each facility
 * may set its own (`facility_booking_rule`, migration 0075); a facility without one uses {@link DEFAULT_BOOKING_RULES}.
 */
export interface BookingRules {
  /** Book at least this long before the start, so the clinic can prepare. */
  minLeadMinutes: number;
  /** How far ahead patients may book. */
  maxAdvanceDays: number;
  /** Upcoming self-booked appointments one patient may hold at once. */
  maxUpcoming: number;
  /** Patients may cancel or reschedule until this long before the start; later, they call the clinic. */
  changeCutoffMinutes: number;
  /** Patients may join a waiting list for days with no open times. */
  waitlistEnabled: boolean;
  /** Waiting-list entries one patient may hold at the facility. */
  maxWaitlistEntries: number;
}

export const DEFAULT_BOOKING_RULES: BookingRules = {
  minLeadMinutes: 120,
  maxAdvanceDays: 60,
  maxUpcoming: 3,
  changeCutoffMinutes: 120,
  waitlistEnabled: false,
  maxWaitlistEntries: 3,
};

/** The most days one waiting-list entry may span: a request for "some day soon", not for the whole horizon. */
export const MAX_WAITLIST_SPAN_DAYS = 14;

export type PatientBookingRefusal = "too_soon" | "too_far_ahead";

/** Whether a patient may book (or move an appointment to) this start time. */
export function patientBookingWindow(startsAt: Date, now: Date, rules: BookingRules = DEFAULT_BOOKING_RULES): PatientBookingRefusal | null {
  if (startsAt.getTime() < now.getTime() + rules.minLeadMinutes * 60_000) return "too_soon";
  if (startsAt.getTime() > now.getTime() + rules.maxAdvanceDays * 86_400_000) return "too_far_ahead";
  return null;
}

/** Whether a patient may still cancel or reschedule an appointment themselves. */
export function patientMayChange(startsAt: Date, now: Date, rules: BookingRules = DEFAULT_BOOKING_RULES): boolean {
  return startsAt.getTime() - now.getTime() >= rules.changeCutoffMinutes * 60_000;
}

export type WaitlistRangeProblem = "invalid_range" | "too_wide" | "in_the_past" | "too_far_ahead";

const dayNumber = (date: string) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);

/** Whether a patient's waiting-list dates are usable: today or later, within the booking horizon, and not too wide. Dates are the facility's calendar days. */
export function waitlistRangeProblem(earliest: string, latest: string, today: string, rules: BookingRules): WaitlistRangeProblem | null {
  if (latest < earliest) return "invalid_range";
  if (earliest < today) return "in_the_past";
  if (dayNumber(latest) - dayNumber(earliest) + 1 > MAX_WAITLIST_SPAN_DAYS) return "too_wide";
  if (dayNumber(latest) - dayNumber(today) > rules.maxAdvanceDays) return "too_far_ahead";
  return null;
}

/** Whether a waiting-list entry could be served by a time that opened: same facility is assumed; practitioner and visit type are "any" when unset. */
export function waitlistMatches(
  entry: { earliestDate: string; latestDate: string; practitionerId: string | null; visitTypeId: string | null },
  opened: { date: string; practitionerId: string; visitTypeId: string | null },
): boolean {
  if (opened.date < entry.earliestDate || opened.date > entry.latestDate) return false;
  if (entry.practitionerId && entry.practitionerId !== opened.practitionerId) return false;
  if (entry.visitTypeId && opened.visitTypeId && entry.visitTypeId !== opened.visitTypeId) return false;
  return true;
}

/** The old name, for callers that only need the platform's defaults. */
export const PATIENT_BOOKING_RULES = DEFAULT_BOOKING_RULES;
