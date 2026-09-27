/**
 * What the laboratory needs from other domains, implemented by the app's
 * composition root (the laboratory library imports neither patient nor clinic).
 */
export interface LaboratoryContext {
  /** Minimal identification for worklists; missing ids are omitted. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, LabPatientBrief>>;
  /** Sex and birth date, to select age- and sex-specific reference ranges. */
  patientDemographics(organizationId: string, patientId: string): Promise<{ sex: string; birthDate: string } | undefined>;
  /** The active practitioner linked to a staff account (the ordering provider). */
  practitionerForUser(organizationId: string, userId: string): Promise<{ id: string; displayName: string } | undefined>;
  practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>>;
  /** Display names of staff users (who collected, entered, verified, approved). */
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  encounter(
    organizationId: string,
    encounterId: string,
  ): Promise<{ id: string; patientId: string; facilityId: string; status: "in_progress" | "completed" | "entered_in_error"; modality: string } | undefined>;
}

export interface LabPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

export const LABORATORY_CONTEXT = Symbol("LABORATORY_CONTEXT");
