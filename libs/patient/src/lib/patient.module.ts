import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { OrganizationModule } from "@healthcare/organization";
import { PatientMessagesController, PortalMessageThreadsController } from "./messaging/patient-message.controller";
import { PatientMessageService } from "./messaging/patient-message.service";
import { PortalEmailService } from "./security/portal-email.service";
import { PortalMfaService } from "./security/portal-mfa.service";
import { PortalMfaLoginController, PortalSecurityController } from "./security/portal-security.controller";
import { PushDeviceCounts } from "./preferences/push-device-counts";
import { PortalPreferencesController } from "./preferences/portal-preferences.controller";
import { PortalPreferencesService } from "./preferences/portal-preferences.service";
import { ConsentTextController } from "./consents/consent-text.controller";
import { ConsentTextService } from "./consents/consent-text.service";
import { PortalConsentsController } from "./consents/portal-consents.controller";
import { PortalConsentService } from "./consents/portal-consents.service";
import { PatientPortalProxyController, PortalProxyController } from "./proxy/proxy.controller";
import { PortalProxyService } from "./proxy/proxy.service";
import { PatientController } from "./patient.controller";
import { PatientRecordService } from "./patient-record.service";
import { PatientReportingQueries } from "./patient-reporting.queries";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";
import { PatientAccessGuard } from "./portal/patient-access.guard";
import { PatientPortalAccountController, PortalController } from "./portal/portal.controller";
import { PortalAccountService } from "./portal/portal-account.service";
import { PortalPasswordResetService } from "./portal/portal-password-reset.service";
import { PortalSecurityMailers } from "./portal/portal-security-mailer";
import { PortalTokenService } from "./portal/portal-tokens";
import { RecordsRequestController } from "./records-requests/records-request.controller";
import { RecordsRequestService } from "./records-requests/records-request.service";
import { PatientTimelineQueries } from "./patient-timeline.queries";

@Module({
  // Organization: facility checks for message routing settings (migration 0097).
  imports: [JwtModule.register({}), OrganizationModule],
  controllers: [
    PatientController,
    PortalController,
    PatientPortalAccountController,
    RecordsRequestController,
    PortalConsentsController,
    PortalPreferencesController,
    PortalSecurityController,
    PortalMessageThreadsController,
    PatientMessagesController,
    ConsentTextController,
    PortalMfaLoginController,
    PortalProxyController,
    PatientPortalProxyController,
  ],
  providers: [
    PatientRecordService,
    PatientTimelineQueries,
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
    PortalEmailService,
    PortalMfaService,
    PatientMessageService,
    PortalSecurityMailers,
    ConsentTextService,
    PushDeviceCounts,
    PortalProxyService,
  ],
  exports: [
    PatientRecordService,
    PatientTimelineQueries,
    PatientReportingQueries,
    PatientRegistrationService,
    PortalAccountService,
    PatientAccessGuard,
    RecordsRequestService,
    PortalSecurityMailers,
    PatientMessageService,
    PushDeviceCounts,
    PortalProxyService,
  ],
})
export class PatientModule {}
