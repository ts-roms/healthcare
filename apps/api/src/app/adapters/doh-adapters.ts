import { Injectable } from "@nestjs/common";
import { PH_TIMEZONE } from "@healthcare/core";
import { ClinicQueries } from "@healthcare/clinic";
import type { DohCaseSource, DohCaseSources, DohDiagnosisBrief } from "@healthcare/interoperability";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";

/** DOH reporting → clinic and patient: the diagnosis, its encounter and facility, the patient's identity and address. */
@Injectable()
export class AppDohCaseSources implements DohCaseSources {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly patients: PatientRecordService,
    private readonly organizations: OrganizationService,
  ) {}

  async forDiagnosis(organizationId: string, diagnosisId: string): Promise<DohCaseSource | undefined> {
    const row = await this.clinic.diagnosisWithEncounter(organizationId, diagnosisId);
    if (!row) return undefined;
    const { diagnosis: d, encounter: e } = row;
    const [identity, reach] = await Promise.all([
      this.patients.identity(organizationId, d.patientId, "philhealth_pin"),
      this.patients.primaryAddressAndPhone(organizationId, d.patientId),
    ]);
    if (!identity) return undefined;
    const { identifier: _pin, ...patient } = identity;
    return {
      diagnosis: {
        id: d.id,
        encounterId: d.encounterId,
        codeSystemKey: d.codeSystemKey,
        code: d.code,
        display: d.display,
        certainty: d.certainty,
        status: d.status,
        recordedAt: d.recordedAt.toISOString(),
      },
      encounter: {
        id: e.id,
        facilityId: e.facilityId,
        facilityName: row.facilityName,
        startedAt: e.startedAt.toISOString(),
        modality: e.modality,
        practitionerName: row.practitionerName,
      },
      patient: { ...patient, ...reach },
    };
  }

  async timeZone(organizationId: string, facilityId: string | null): Promise<string> {
    if (!facilityId) return PH_TIMEZONE;
    return (await this.organizations.getFacility(organizationId, facilityId)).timezone;
  }

  codedDiagnosesRecorded(
    organizationId: string,
    range: { start: Date; end: Date },
    after: { recordedAt: string; diagnosisId: string } | null,
    limit: number,
  ): Promise<DohDiagnosisBrief[]> {
    return this.clinic.codedDiagnosesRecorded(organizationId, range, after, limit);
  }

  async patientBriefs(organizationId: string, patientIds: string[]) {
    const briefs = await this.patients.briefs(organizationId, patientIds);
    return new Map([...briefs].map(([id, b]) => [id, { patientNumber: b.patientNumber, displayName: b.displayName }]));
  }
}
