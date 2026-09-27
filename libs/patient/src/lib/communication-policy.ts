import type { CommunicationCategory, CommunicationChannel, PatientStatus } from "./patient.schema";

export type ContactResolution = { allowed: true; destination: string | null } | { allowed: false; reason: string };

export interface CommunicationFacts {
  status: PatientStatus;
  channel: CommunicationChannel;
  category: CommunicationCategory;
  /** Explicit preference for this channel and category, if recorded. */
  optedIn: boolean | undefined;
  primaryMobile: string | undefined;
  primaryEmail: string | undefined;
  /** An active MyHealth account with portal-access consent (in-app messages are read there). */
  portalActive?: boolean;
}

/**
 * Whether the platform may contact a patient, and where.
 * - Recorded preferences always win.
 * - Without one, care-related messages (clinical, administrative) are allowed;
 *   outreach/marketing-style messages require an explicit opt-in.
 * - Deceased or merged records are never contacted; inactive patients get no outreach.
 * - In-app messages go to the MyHealth inbox, so they need an active portal account.
 */
export function resolvePatientContact(facts: CommunicationFacts): ContactResolution {
  if (facts.status === "deceased") return { allowed: false, reason: "patient_deceased" };
  if (facts.status === "merged") return { allowed: false, reason: "patient_merged" };
  if (facts.status === "inactive" && facts.category === "outreach") return { allowed: false, reason: "patient_inactive" };

  if (facts.optedIn === false) return { allowed: false, reason: "opted_out" };
  if (facts.optedIn === undefined && facts.category === "outreach") return { allowed: false, reason: "no_outreach_opt_in" };

  switch (facts.channel) {
    case "sms":
      return facts.primaryMobile ? { allowed: true, destination: facts.primaryMobile } : { allowed: false, reason: "no_mobile_number" };
    case "email":
      return facts.primaryEmail ? { allowed: true, destination: facts.primaryEmail } : { allowed: false, reason: "no_email_address" };
    case "push":
      return { allowed: false, reason: "no_push_device" };
    case "in_app":
      return facts.portalActive ? { allowed: true, destination: null } : { allowed: false, reason: "no_portal_account" };
  }
}
