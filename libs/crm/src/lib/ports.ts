import type { SegmentCriteria } from "./crm.rules";
import type { OutreachChannel } from "./crm.schema";

/** Minimal identification for a segment preview: a work list, not a record. */
export interface SegmentMember {
  patientId: string;
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/**
 * Who matches a segment: implemented by the composition root over the patient, clinic and care-plan data this library
 * must not read itself. Only active (never merged, deceased or inactive) records are returned.
 */
export interface CrmSegmentSource {
  evaluate(organizationId: string, criteria: SegmentCriteria, today: string): Promise<SegmentMember[]>;
}
export const CRM_SEGMENT_SOURCE = Symbol("CRM_SEGMENT_SOURCE");

/** Records a patient's opt-out from outreach on a channel (the patient domain owns communication preferences). */
export interface CrmPreferenceWriter {
  optOut(organizationId: string, patientId: string, channel: OutreachChannel, campaignId: string): Promise<void>;
}
export const CRM_PREFERENCES = Symbol("CRM_PREFERENCES");
