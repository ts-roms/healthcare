/**
 * Rules for patients booking their own appointments in MyHealth. Staff booking is not limited by these. Each facility
 * may set its own (`facility_booking_rule`, migration 0077); a facility without one uses {@link DEFAULT_BOOKING_RULES}.
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
  /** The platform marks the day's unattended appointments as no-shows after {@link autoNoShowHour} (migration 0086). */
  autoNoShow: boolean;
  /** Local hour (12–23) after which a day's unattended appointments are marked. */
  autoNoShowHour: number;
  /** Patients may check in for an in-person appointment in MyHealth. */
  onlineCheckIn: boolean;
  /** Online check-in opens this long before the start… */
  checkInOpensMinutes: number;
  /** …and closes this long after it (later, the patient checks in at the desk). */
  checkInClosesMinutes: number;
}

export const DEFAULT_BOOKING_RULES: BookingRules = {
  minLeadMinutes: 120,
  maxAdvanceDays: 60,
  maxUpcoming: 3,
  changeCutoffMinutes: 120,
  waitlistEnabled: false,
  maxWaitlistEntries: 3,
  autoNoShow: false,
  autoNoShowHour: 20,
  onlineCheckIn: false,
  checkInOpensMinutes: 60,
  checkInClosesMinutes: 15,
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

export type OnlineCheckInRefusal = "not_offered" | "too_early" | "too_late";

/** Whether a patient may check in online now for an in-person appointment starting at `startsAt`. */
export function onlineCheckInWindow(startsAt: Date, now: Date, rules: BookingRules = DEFAULT_BOOKING_RULES): OnlineCheckInRefusal | null {
  if (!rules.onlineCheckIn) return "not_offered";
  if (now.getTime() < startsAt.getTime() - rules.checkInOpensMinutes * 60_000) return "too_early";
  if (now.getTime() > startsAt.getTime() + rules.checkInClosesMinutes * 60_000) return "too_late";
  return null;
}

/**
 * Whether an appointment nobody attended is due to be marked as a no-show automatically: the facility has it on, the
 * appointment has ended, and the local time is past the facility's hour on the appointment's own day (so a morning
 * appointment waits until the evening, when the clinic can no longer see the patient late).
 * `dayStart` is the start of the appointment's local day in the facility's time zone.
 */
export function autoNoShowDue(appointment: { endsAt: Date; dayStart: Date }, now: Date, rules: BookingRules): boolean {
  if (!rules.autoNoShow) return false;
  if (appointment.endsAt.getTime() > now.getTime()) return false;
  return now.getTime() >= appointment.dayStart.getTime() + rules.autoNoShowHour * 3_600_000;
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
