import type { ConsentType } from "../patient.schema";

/** One consent type in MyHealth: the current decision (if any), whether the patient may withdraw it here, and its history. */
export interface PatientConsentView {
  consentType: ConsentType;
  current: PatientConsentDecisionView | null;
  inEffect: boolean;
  canWithdraw: boolean;
  /** The patient may give this consent now, in MyHealth: not in effect, and the organization offers it online with its own wording. */
  canGive: boolean;
  history: PatientConsentDecisionView[];
}

/** The organization's wording a patient reads before giving a consent online (migration 0076). */
export interface ConsentWordingView {
  id: string;
  consentType: ConsentType;
  version: number;
  title: string;
  body: string;
  /** The statement the patient confirms, in the organization's words. */
  acknowledgement: string;
}

export interface PatientConsentDecisionView {
  id: string;
  decision: string;
  effectiveAt: string;
  expiresAt: string | null;
  recordedAt: string;
  /** Recorded at the clinic, or by the patient in MyHealth. Staff names and notes are not shown. */
  recordedVia: "clinic" | "myhealth";
  /** The version of the organization's wording the patient read, for a consent given online. */
  wordingVersion: number | null;
}
