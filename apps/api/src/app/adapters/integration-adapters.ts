import { Injectable } from "@nestjs/common";
import type { ExchangePatientDirectory } from "@healthcare/interoperability";
import { PatientRecordService } from "@healthcare/patient";

/** Integration exchange review → patient: number and name for the list. */
@Injectable()
export class AppExchangePatients implements ExchangePatientDirectory {
  constructor(private readonly patients: PatientRecordService) {}

  async briefs(organizationId: string, patientIds: string[]) {
    const briefs = await this.patients.briefs(organizationId, patientIds);
    return new Map([...briefs].map(([id, b]) => [id, { patientNumber: b.patientNumber, displayName: b.displayName }]));
  }
}
