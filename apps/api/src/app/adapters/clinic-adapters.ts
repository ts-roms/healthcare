import { Injectable } from "@nestjs/common";
import type { CarePlanPatientDirectory } from "@healthcare/care-plan";
import { ClinicQueries, type PatientBrief, type PatientDirectory } from "@healthcare/clinic";
import { PatientRecordService } from "@healthcare/patient";
import type { AllergyContext, PrescribingContext } from "@healthcare/prescription";

/** Clinic and care plans → patient: names and numbers for queue boards, schedules and the recall list. */
@Injectable()
export class AppPatientDirectory implements PatientDirectory, CarePlanPatientDirectory {
  constructor(private readonly patients: PatientRecordService) {}

  summaries(organizationId: string, patientIds: string[]): Promise<Map<string, PatientBrief>> {
    return this.patients.briefs(organizationId, patientIds);
  }
}

/** Prescription → clinic: prescriber identity, encounter state and allergies. */
@Injectable()
export class AppPrescribingContext implements PrescribingContext {
  constructor(private readonly clinic: ClinicQueries) {}

  async prescriber(organizationId: string, userId: string) {
    const practitioner = await this.clinic.practitionerForUser(organizationId, userId);
    return practitioner ? { id: practitioner.id, profession: practitioner.profession, displayName: practitioner.displayName } : undefined;
  }

  async encounter(organizationId: string, encounterId: string) {
    const row = await this.clinic.encounter(organizationId, encounterId);
    return row ? { id: row.id, patientId: row.patientId, facilityId: row.facilityId, status: row.status, practitionerId: row.practitionerId } : undefined;
  }

  async allergies(organizationId: string, patientId: string): Promise<AllergyContext> {
    const summary = await this.clinic.allergySummary(organizationId, patientId);
    return {
      status: summary.status,
      allergies: summary.allergies.map((a) => ({ id: a.id, substance: a.substance, category: a.category, criticality: a.criticality, reaction: a.reaction })),
    };
  }
}
