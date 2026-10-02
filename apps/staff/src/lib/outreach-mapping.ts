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
};

/** "Age 50–64 · Female · Makati City · No visit for 12 months". */
export function describeCriteria(c: OutreachSegmentCriteria): string {
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
  return parts.join(" · ") || "No criteria";
}
