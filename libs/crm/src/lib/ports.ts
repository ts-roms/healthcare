import type { SegmentCriteria } from "./crm.rules";
import type { OutreachChannel } from "./crm.schema";

/** Minimal identification for a segment preview: a work list, not a record. */
export interface SegmentMember {
  patientId: string;
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
  /** Given name, for the first name a message may carry; left out of every preview. */
  givenName?: string;
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

/**
 * Whether each patient can be messaged on each channel, by the same consent and contact checks the notification service
 * makes when a message is sent (so the figures shown before a send agree with what the send does). Implemented by the
 * composition root, which knows the patient and MyHealth domains.
 */
export interface CrmReachSource {
  reach(
    organizationId: string,
    patientIds: string[],
    channels: OutreachChannel[],
  ): Promise<Array<{ patientId: string; channels: Partial<Record<OutreachChannel, { allowed: true } | { allowed: false; reason: string }>> }>>;
}
export const CRM_REACH_SOURCE = Symbol("CRM_REACH_SOURCE");
