import type { ConsentType } from "../patient.schema";

/** One consent type in MyHealth: the current decision (if any), whether the patient may withdraw it here, and its history. */
export interface PatientConsentView {
  consentType: ConsentType;
  current: PatientConsentDecisionView | null;
  inEffect: boolean;
  canWithdraw: boolean;
  history: PatientConsentDecisionView[];
}

export interface PatientConsentDecisionView {
  id: string;
  decision: string;
  effectiveAt: string;
  expiresAt: string | null;
  recordedAt: string;
  /** Recorded at the clinic, or by the patient in MyHealth. Staff names and notes are not shown. */
  recordedVia: "clinic" | "myhealth";
}
