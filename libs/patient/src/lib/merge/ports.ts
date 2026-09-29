import type { MergeWorkItem } from "./patient-merge.rules";

/**
 * What patient merge needs from other domains, implemented by the API's composition root (the patient library imports
 * no other domain): work in progress filed under a record, and staff names for the merge history.
 */
export interface PatientMergeContext {
  /** Open encounters, queue visits, upcoming appointments, open lab orders, draft invoices, … of this one record id. */
  workInProgress(organizationId: string, patientId: string): Promise<MergeWorkItem[]>;
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
}

export const PATIENT_MERGE_CONTEXT = Symbol("PATIENT_MERGE_CONTEXT");
