import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { ClinicQueries } from "@healthcare/clinic";
import type { DentalContext, DentalPatientBrief, DentalVisit } from "@healthcare/dental";
import { PatientRecordService } from "@healthcare/patient";

/** Dental → clinic, patient and staff directory: the dental visit is a clinic encounter with a dentist. */
@Injectable()
export class AppDentalContext implements DentalContext {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly patients: PatientRecordService,
    private readonly users: UsersService,
  ) {}

  async encounter(organizationId: string, encounterId: string) {
    const row = await this.clinic.encounter(organizationId, encounterId);
    return row ? { id: row.id, patientId: row.patientId, facilityId: row.facilityId, practitionerId: row.practitionerId, status: row.status } : undefined;
  }

  async practitionerForUser(organizationId: string, userId: string) {
    const row = await this.clinic.practitionerForUser(organizationId, userId);
    return row ? { id: row.id, displayName: row.displayName, profession: row.profession } : undefined;
  }

  practitionerNames(organizationId: string, practitionerIds: string[]) {
    return this.clinic.practitionerNames(organizationId, practitionerIds);
  }

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }

  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, DentalPatientBrief>> {
    return this.patients.briefs(organizationId, patientIds);
  }

  dentalVisits(organizationId: string, facilityId: string, date: string): Promise<DentalVisit[]> {
    return this.clinic.encountersOfProfession(organizationId, facilityId, date, "dentist");
  }
}
