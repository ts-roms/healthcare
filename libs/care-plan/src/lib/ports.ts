/**
 * What care plans need from the patient domain, implemented by the app's
 * composition root (the care-plan library must not import the patient library).
 */
export interface CarePlanPatientDirectory {
  /** Minimal identification for the recall list; missing ids are omitted. */
  summaries(organizationId: string, patientIds: string[]): Promise<Map<string, CarePlanPatientBrief>>;
}

export interface CarePlanPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

export const CARE_PLAN_PATIENTS = Symbol("CARE_PLAN_PATIENTS");
