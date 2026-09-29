import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PatientController } from "./patient.controller";
import { PatientRecordService } from "./patient-record.service";
import { PatientReportingQueries } from "./patient-reporting.queries";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";
import { PatientAccessGuard } from "./portal/patient-access.guard";
import { PatientPortalAccountController, PortalController } from "./portal/portal.controller";
import { PortalAccountService } from "./portal/portal-account.service";
import { PortalTokenService } from "./portal/portal-tokens";
import { RecordsRequestController } from "./records-requests/records-request.controller";
import { RecordsRequestService } from "./records-requests/records-request.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [PatientController, PortalController, PatientPortalAccountController, RecordsRequestController],
  providers: [
    PatientRecordService,
    PatientReportingQueries,
    PatientRegistrationService,
    PatientSearchService,
    PortalAccountService,
    PortalTokenService,
    PatientAccessGuard,
    RecordsRequestService,
  ],
  exports: [PatientRecordService, PatientReportingQueries, PatientRegistrationService, PortalAccountService, PatientAccessGuard, RecordsRequestService],
})
export class PatientModule {}
