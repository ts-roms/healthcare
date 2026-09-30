import type { ConsentType, PortalConsent } from "./api/types";

/** Consents in the patient's words: what each covers. */
export const CONSENT_TEXT: Record<ConsentType, { title: string; about: string }> = {
  data_processing: { title: "Use of your personal and health information", about: "The clinic keeps and uses your information to care for you." },
  treatment_general: { title: "General consent to treatment", about: "You agree to routine examination and care at the clinic." },
  telemedicine: { title: "Online consultations", about: "You agree to consultations by video or phone." },
  data_sharing_hmo: { title: "Sharing with your HMO", about: "The clinic may share what your HMO needs to cover your care." },
  data_sharing_philhealth: { title: "Sharing with PhilHealth", about: "The clinic may share what PhilHealth needs for your benefits." },
  portal_access: { title: "MyHealth", about: "You use MyHealth to see your records and manage visits." },
  research: { title: "Research", about: "Your information may be used, as the clinic describes, for approved research." },
};

/** What withdrawing means, told before the patient confirms. */
export const WITHDRAW_EFFECT: Partial<Record<ConsentType, string>> = {
  telemedicine: "The clinic will not offer you online consultations until you give this consent again at the clinic.",
  data_sharing_hmo: "The clinic stops sharing your information with your HMO from now on. Ask the clinic how this affects HMO coverage of your visits.",
  data_sharing_philhealth: "The clinic stops sharing your information with PhilHealth from now on. Ask the clinic how this affects your PhilHealth benefits.",
  research: "Your information is not used for new research from now on.",
  portal_access: "You are signed out of MyHealth now and cannot sign in again until you give this consent again at the clinic.",
};

export type ConsentState = "given" | "withdrawn" | "refused" | "expired" | "not_recorded";

export function consentState(consent: Pick<PortalConsent, "current" | "inEffect">): ConsentState {
  if (!consent.current) return "not_recorded";
  if (consent.inEffect) return "given";
  if (consent.current.decision === "granted") return "expired";
  return consent.current.decision === "withdrawn" ? "withdrawn" : "refused";
}

export const CONSENT_STATE_TEXT: Record<ConsentState, string> = {
  given: "Given",
  withdrawn: "Withdrawn",
  refused: "Not given",
  expired: "Expired",
  not_recorded: "Not given yet",
};

/** What a patient sees to give a consent online: only when the clinic offers it, and it is not already in effect. */
export function canGiveOnline(consent: Pick<PortalConsent, "canGive" | "inEffect">): boolean {
  return consent.canGive && !consent.inEffect;
}

/** Messages for the API's refusals, in the patient's words. */
export function consentMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "consent_not_in_effect":
      return "This consent is not currently given.";
    case "consent_wording_changed":
      return "The clinic changed the wording while you were reading. Please read it again.";
    case "consent_already_given":
      return "You have already given this consent.";
    case "consent_not_offered_online":
    case "consent_give_at_clinic":
      return "This consent is given at the clinic. Please ask the front desk.";
    case "consent_withdraw_at_clinic":
      return "This consent is withdrawn at the clinic, which can explain what it means for your care.";
    default:
      return fallback;
  }
}
