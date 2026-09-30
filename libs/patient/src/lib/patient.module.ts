import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PortalPreferencesController } from "./preferences/portal-preferences.controller";
import { PortalPreferencesService } from "./preferences/portal-preferences.service";
import { PortalConsentsController } from "./consents/portal-consents.controller";
import { PortalConsentService } from "./consents/portal-consents.service";
import { PatientController } from "./patient.controller";
import { PatientRecordService } from "./patient-record.service";
import { PatientReportingQueries } from "./patient-reporting.queries";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";
import { PatientAccessGuard } from "./portal/patient-access.guard";
import { PatientPortalAccountController, PortalController } from "./portal/portal.controller";
import { PortalAccountService } from "./portal/portal-account.service";
import { PortalPasswordResetService, PortalSecurityMailers } from "./portal/portal-password-reset.service";
import { PortalTokenService } from "./portal/portal-tokens";
import { RecordsRequestController } from "./records-requests/records-request.controller";
import { RecordsRequestService } from "./records-requests/records-request.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    PatientController,
    PortalController,
    PatientPortalAccountController,
    RecordsRequestController,
    PortalConsentsController,
    PortalPreferencesController,
  ],
  providers: [
    PatientRecordService,
    PatientReportingQueries,
    PatientRegistrationService,
    PatientSearchService,
    PortalAccountService,
    PortalTokenService,
    PatientAccessGuard,
    RecordsRequestService,
    PortalConsentService,
    PortalPreferencesService,
    PortalPasswordResetService,
    PortalSecurityMailers,
  ],
  exports: [
    PatientRecordService,
    PatientReportingQueries,
    PatientRegistrationService,
    PortalAccountService,
    PatientAccessGuard,
    RecordsRequestService,
    PortalSecurityMailers,
  ],
})
export class PatientModule {}
