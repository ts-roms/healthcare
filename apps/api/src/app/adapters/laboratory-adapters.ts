import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { ClinicQueries } from "@healthcare/clinic";
import type { LaboratoryContext, LabPatientBrief } from "@healthcare/laboratory";
import { PatientRecordService } from "@healthcare/patient";

/** Laboratory → patient, clinic and staff directory: identification, demographics, ordering provider and encounter state. */
@Injectable()
export class AppLaboratoryContext implements LaboratoryContext {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
    private readonly users: UsersService,
  ) {}

  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, LabPatientBrief>> {
    return this.patients.briefs(organizationId, patientIds);
  }

  patientDemographics(organizationId: string, patientId: string) {
    return this.patients.demographics(organizationId, patientId);
  }

  async practitionerForUser(organizationId: string, userId: string) {
    const practitioner = await this.clinic.practitionerForUser(organizationId, userId);
    return practitioner ? { id: practitioner.id, displayName: practitioner.displayName } : undefined;
  }

  practitionerNames(organizationId: string, practitionerIds: string[]) {
    return this.clinic.practitionerNames(organizationId, practitionerIds);
  }

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }

  async encounter(organizationId: string, encounterId: string) {
    const row = await this.clinic.encounter(organizationId, encounterId);
    return row ? { id: row.id, patientId: row.patientId, facilityId: row.facilityId, status: row.status, modality: row.modality } : undefined;
  }
}
