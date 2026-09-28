/**
 * What dentistry needs from other domains, implemented by the app's composition root
 * (apps/api/src/app/adapters/dental-adapters.ts). The dental library never reads clinic or patient tables: a dental
 * visit is a clinic encounter with a dentist, reached through this port.
 */

export interface DentalEncounter {
  id: string;
  patientId: string;
  facilityId: string;
  practitionerId: string;
  status: "in_progress" | "completed" | "entered_in_error";
}

export interface DentalPractitioner {
  id: string;
  displayName: string;
  profession: string;
}

export interface DentalPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/** A dentist's encounter on a day at a facility (the dental worklist). */
export interface DentalVisit {
  encounterId: string;
  patientId: string;
  practitionerId: string;
  practitionerName: string;
  status: DentalEncounter["status"];
  startedAt: Date;
  chiefComplaint: string | null;
}

export interface DentalContext {
  encounter(organizationId: string, encounterId: string): Promise<DentalEncounter | undefined>;
  /** The active practitioner linked to a staff account. */
  practitionerForUser(organizationId: string, userId: string): Promise<DentalPractitioner | undefined>;
  practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>>;
  /** Display names of staff users (who recorded, who corrected). */
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  /** Minimal identification; missing ids are omitted. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, DentalPatientBrief>>;
  /** Encounters of dentists at a facility on a local date. */
  dentalVisits(organizationId: string, facilityId: string, date: string): Promise<DentalVisit[]>;
}

export const DENTAL_CONTEXT = Symbol("DENTAL_CONTEXT");
