import type { PrivacyAssessment, PrivacyDataCategory, PrivacyEntryKind, PrivacyIncident, RecordsRequestKind } from "./api/types";

/** What a patient's request is, as the records office reads it (migration 0114). */
export const RECORDS_KIND_LABEL: Record<RecordsRequestKind, string> = {
  access: "Copies of records",
  rectification: "Correction",
  erasure: "Erasure or blocking",
  objection: "Objection to a use",
};

/** What answering each kind means for the records office. */
export const RECORDS_KIND_HINT: Record<RecordsRequestKind, string> = {
  access: "Share documents from the patient's record.",
  rectification: "Correct the record through the ordinary screens (edit details, mark an entry as made in error), then say what was done.",
  erasure: "Decide under your organization's procedure; records are never deleted by the platform — archive or restrict as your policy says, then answer.",
  objection: "Stop the use the patient objects to where your procedure allows (for example outreach: communication preferences), then answer.",
};

export const PRIVACY_CATEGORY_LABEL: Record<PrivacyDataCategory, string> = {
  identifiers: "Names, numbers and identifiers",
  contact: "Contact details and addresses",
  health: "Health information",
  financial: "Billing and payment details",
  credentials: "Passwords or sign-in details",
  other: "Other personal data",
};

export const PRIVACY_ASSESSMENT: Record<PrivacyAssessment, { label: string; variant: "warning" | "danger" | "neutral" }> = {
  pending: { label: "Not yet assessed", variant: "warning" },
  notifiable: { label: "Notifiable", variant: "danger" },
  not_notifiable: { label: "Not notifiable", variant: "neutral" },
};

export const PRIVACY_ENTRY_LABEL: Record<PrivacyEntryKind, string> = {
  reported: "Reported",
  note: "Note",
  containment: "Containment",
  assessment: "Assessment",
  npc_notified: "NPC notified",
  subjects_notified: "Affected people told",
  closed: "Closed",
};

/** "41 h left", "12 h overdue" or null when no notification is pending. */
export function notificationClock(incident: Pick<PrivacyIncident, "notificationPending" | "hoursLeft">): string | null {
  if (!incident.notificationPending || incident.hoursLeft === null) return null;
  const hours = Math.abs(incident.hoursLeft);
  const text = hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} h`;
  return incident.hoursLeft < 0 ? `${text} past the window` : `${text} left`;
}
