import type { AppointmentStatus } from "../clinic.schema";

export type AppointmentAction = "confirm" | "reschedule" | "cancel" | "no_show" | "check_in" | "complete";

const ALLOWED: Record<AppointmentAction, readonly AppointmentStatus[]> = {
  confirm: ["booked"],
  reschedule: ["booked", "confirmed"],
  cancel: ["booked", "confirmed"],
  no_show: ["booked", "confirmed"],
  check_in: ["booked", "confirmed"],
  complete: ["checked_in"],
};

export function canApply(action: AppointmentAction, status: AppointmentStatus): boolean {
  return ALLOWED[action].includes(status);
}

/** A no-show can only be recorded once the appointment's start time has passed. */
export function noShowAllowed(startsAt: Date, now: Date): boolean {
  return now >= startsAt;
}
