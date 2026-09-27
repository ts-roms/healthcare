/**
 * What the clinic needs from the patient domain, implemented by the app's
 * composition root (clinic must not import the patient library).
 */
export interface PatientDirectory {
  /** Minimal identification for queue boards and lists; missing ids are omitted. */
  summaries(organizationId: string, patientIds: string[]): Promise<Map<string, PatientBrief>>;
}

export interface PatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

export const PATIENT_DIRECTORY = Symbol("PATIENT_DIRECTORY");
