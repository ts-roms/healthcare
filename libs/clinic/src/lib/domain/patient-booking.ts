/**
 * Rules for patients booking their own appointments in MyHealth. Staff booking
 * is not limited by these; clinics can change the numbers here once they are
 * configurable per organization.
 */
export const PATIENT_BOOKING_RULES = {
  /** Book at least this long before the start, so the clinic can prepare. */
  minLeadMinutes: 120,
  /** How far ahead patients may book. */
  maxAdvanceDays: 60,
  /** Upcoming self-booked appointments one patient may hold at once. */
  maxUpcoming: 3,
  /** Patients may cancel or reschedule until this long before the start; later, they call the clinic. */
  changeCutoffMinutes: 120,
} as const;

export type PatientBookingRefusal = "too_soon" | "too_far_ahead";

/** Whether a patient may book (or move an appointment to) this start time. */
export function patientBookingWindow(startsAt: Date, now: Date): PatientBookingRefusal | null {
  if (startsAt.getTime() < now.getTime() + PATIENT_BOOKING_RULES.minLeadMinutes * 60_000) return "too_soon";
  if (startsAt.getTime() > now.getTime() + PATIENT_BOOKING_RULES.maxAdvanceDays * 86_400_000) return "too_far_ahead";
  return null;
}

/** Whether a patient may still cancel or reschedule an appointment themselves. */
export function patientMayChange(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() >= PATIENT_BOOKING_RULES.changeCutoffMinutes * 60_000;
}
