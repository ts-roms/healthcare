import type { PrivacyAssessment, PrivacyIncidentStatus } from "./privacy.schema";

/** The organization's default notification window when it has set none (hours from discovery; reference only). */
export const DEFAULT_BREACH_NOTIFICATION_HOURS = 72;

/** When the organization means to have notified, from the discovery and its own window in hours. */
export function notifyBy(discoveredAt: Date, hours: number): Date {
  return new Date(discoveredAt.getTime() + hours * 3_600_000);
}

export interface IncidentClock {
  status: PrivacyIncidentStatus;
  assessment: PrivacyAssessment;
  notifyBy: Date;
  npcNotifiedAt: Date | null;
}

/**
 * The notification window still matters while the incident is open and either not yet assessed or assessed as
 * notifiable without the NPC notification recorded; once recorded, assessed as not notifiable, or closed, it is over.
 */
export function notificationPending(incident: IncidentClock): boolean {
  if (incident.status !== "open") return false;
  if (incident.assessment === "not_notifiable") return false;
  return incident.npcNotifiedAt === null;
}

/** The window passed without a recorded NPC notification (an open, pending or notifiable incident). */
export function notificationOverdue(incident: IncidentClock, now: Date = new Date()): boolean {
  return notificationPending(incident) && now > incident.notifyBy;
}

/** Hours left in the window (negative once passed); null when no notification is pending. */
export function hoursLeft(incident: IncidentClock, now: Date = new Date()): number | null {
  if (!notificationPending(incident)) return null;
  return Math.round(((incident.notifyBy.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
}

/** An incident is closed only once assessed; the closure note says what was concluded. */
export function canClose(incident: { status: PrivacyIncidentStatus; assessment: PrivacyAssessment }): boolean {
  return incident.status === "open" && incident.assessment !== "pending";
}
