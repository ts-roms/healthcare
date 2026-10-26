import type { OutreachCampaignStatus, OutreachChannel, OutreachSegmentCriteria } from "./api/types";

/** Display rules for outreach; the API enforces every rule. */

export const CHANNEL_LABEL: Record<OutreachChannel, string> = { sms: "Text message", email: "Email", push: "Push", in_app: "MyHealth inbox" };

export const CAMPAIGN_STATUS: Record<OutreachCampaignStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Awaiting approval", tone: "info" },
  approved: { label: "Approved, waiting to send", tone: "info" },
  sending: { label: "Sending", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

/** The reasons the notification service gives when it does not send, in plain words. */
export const SUPPRESSION_LABEL: Record<string, string> = {
  no_outreach_opt_in: "No outreach opt-in on this channel",
  patient_inactive: "Record inactive",
  patient_deceased: "Record marked deceased",
  patient_merged: "Record merged",
  no_contact: "No contact detail",
  no_portal_account: "No MyHealth account",
  no_push_subscription: "No device for push",
  opted_out: "Opted out",
  no_mobile_number: "No mobile number",
  no_email_address: "No email address",
  no_push_device: "No device for push",
  frequency_cap: "Already reached by other campaigns recently",
};

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const MY_HEALTH_LABEL = { active: "Has an active MyHealth account", not_active: "No active MyHealth account" } as const;
export const IDENTIFIER_LABEL = { philhealth_pin: "PhilHealth number on file", hmo_member_id: "HMO membership number on file" } as const;

/** "Age 50–64 · Female · Makati City · No visit for 12 months". Facility names are looked up by id (a facility not listed reads "a facility"). */
export function describeCriteria(c: OutreachSegmentCriteria, facilityNames: Record<string, string> = {}): string {
  const parts: string[] = [];
  if (c.ageMin !== undefined || c.ageMax !== undefined) parts.push(`Age ${c.ageMin ?? 0}–${c.ageMax ?? "any"}`);
  if (c.sex) parts.push(c.sex === "female" ? "Female" : "Male");
  if (c.cityMunicipality) parts.push(c.cityMunicipality);
  if (c.province) parts.push(c.province);
  if (c.registeredFrom || c.registeredTo) parts.push(`Registered ${c.registeredFrom ?? "…"} to ${c.registeredTo ?? "…"}`);
  if (c.lastVisitBefore) parts.push(`Last visit before ${c.lastVisitBefore}`);
  if (c.noVisitForMonths !== undefined) parts.push(`No visit for ${c.noVisitForMonths} months`);
  if (c.carePlanActivityDueWithinDays !== undefined) parts.push(`Care-plan activity due within ${c.carePlanActivityDueWithinDays} days`);
  if (c.optedInChannel) parts.push(`Opted in to ${CHANNEL_LABEL[c.optedInChannel].toLowerCase()}`);
  if (c.birthMonth !== undefined) parts.push(`Born in ${MONTH_NAMES[c.birthMonth - 1] ?? c.birthMonth}`);
  if (c.myHealth) parts.push(MY_HEALTH_LABEL[c.myHealth]);
  if (c.registeredFacilityId) parts.push(`Registered at ${facilityNames[c.registeredFacilityId] ?? "a facility"}`);
  if (c.identifierOnFile) parts.push(IDENTIFIER_LABEL[c.identifierOnFile]);
  return parts.join(" · ") || "No criteria";
}

// ---- wording variables (mirrors libs/crm; the API checks every campaign) ----------------------------------------------

/** What a campaign's wording may fill in for each patient: their first name and the organization's name, nothing else. */
export const PLACEHOLDERS = [
  { token: "{{firstName}}", label: "Insert first name" },
  { token: "{{clinicName}}", label: "Insert clinic name" },
] as const;
/** The longest first name a message carries (a longer one is cut at its first word). */
export const FIRST_NAME_MAX = 30;
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** The wording as one patient sees it. */
export function fillWording(text: string, firstName: string, clinicName: string): string {
  return text.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
    name === "firstName" ? firstName : name === "clinicName" ? clinicName.slice(0, 80) : whole,
  );
}

/** The longest the wording can be once filled in (a first name of the greatest length): what the length limits are checked against. */
export function worstCaseLength(text: string, clinicName: string): number {
  return fillWording(text, "x".repeat(FIRST_NAME_MAX), clinicName).length;
}

/** Placeholder names in the text that the platform does not fill in. */
export function unknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? "";
    if (!PLACEHOLDERS.some((p) => p.token === `{{${name}}}`)) unknown.add(name);
  }
  return [...unknown];
}

export const DELIVERY_MODE_LABEL: Record<"all" | "first_available", string> = {
  all: "On every channel I chose",
  first_available: "One message per patient, on the first channel that reaches them",
};
export const DELIVERY_MODE_HELP: Record<"all" | "first_available", string> = {
  all: "A patient who can be reached on several of the channels gets the message on each.",
  first_available:
    "Tried in this order: push, text message, email, MyHealth inbox. A patient gets one message, on the first of your channels that can reach them.",
};
