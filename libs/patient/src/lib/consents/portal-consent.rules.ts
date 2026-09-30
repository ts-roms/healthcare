import type { ConsentType } from "../patient.schema";

/**
 * Consents the patient may withdraw in MyHealth (docs/architecture/portal-app.md, "Privacy and consents"). Consent to
 * data processing and to general treatment is withdrawn with the clinic, which explains what withdrawing means for care
 * and records (assumption, to confirm with the organization's data protection officer).
 */
export const PATIENT_WITHDRAWABLE_CONSENTS: readonly ConsentType[] = [
  "telemedicine",
  "data_sharing_hmo",
  "data_sharing_philhealth",
  "research",
  "portal_access",
];

export function patientMayWithdraw(consentType: ConsentType): boolean {
  return PATIENT_WITHDRAWABLE_CONSENTS.includes(consentType);
}

/** A consent decision in effect at `now`: granted, effective and not expired. */
export function consentInEffect(c: { decision: string; effectiveAt: Date; expiresAt: Date | null }, now: Date): boolean {
  return c.decision === "granted" && c.effectiveAt <= now && (!c.expiresAt || c.expiresAt > now);
}

/**
 * Consents the patient may give in MyHealth (migration 0078), each only against the organization's own wording (the
 * platform ships none) and only while the organization offers it online. The same four they may withdraw online:
 * consent to data processing and general treatment, and to MyHealth itself, are given at the clinic.
 */
export const PATIENT_GRANTABLE_CONSENTS: readonly ConsentType[] = ["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research"];

export function patientMayGrant(consentType: ConsentType): boolean {
  return PATIENT_GRANTABLE_CONSENTS.includes(consentType);
}
