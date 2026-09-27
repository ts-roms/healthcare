import { Module } from "@nestjs/common";
import { PatientController } from "./patient.controller";
import { PatientRecordService } from "./patient-record.service";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";

@Module({
  controllers: [PatientController],
  providers: [PatientRecordService, PatientRegistrationService, PatientSearchService],
  exports: [PatientRecordService],
})
export class PatientModule {}
