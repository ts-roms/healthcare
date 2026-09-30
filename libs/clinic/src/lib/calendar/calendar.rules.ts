import type { CalendarVisibility } from "./calendar.schema";

/** Whether someone sees an event: facility events by everyone with calendar.read, invitee events only by the organizer and attendees. */
export function calendarEventVisibleTo(
  event: { visibility: CalendarVisibility; organizerUserId: string },
  attendeeUserIds: readonly string[],
  userId: string,
): boolean {
  return event.visibility === "facility" || event.organizerUserId === userId || attendeeUserIds.includes(userId);
}

/** The organizer changes or cancels an event; so does anyone who configures the clinic. */
export function calendarEventEditableBy(event: { organizerUserId: string; status: "scheduled" | "cancelled" }, userId: string, canConfigure: boolean): boolean {
  return event.status === "scheduled" && (event.organizerUserId === userId || canConfigure);
}
