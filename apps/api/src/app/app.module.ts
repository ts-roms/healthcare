import { DynamicModule, MiddlewareConsumer, Module, NestModule, type Provider, Logger } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "@healthcare/audit";
import { AuthModule, PasswordScreeningModule } from "@healthcare/auth";
import { CarePlanModule } from "@healthcare/care-plan";
import { ClinicModule } from "@healthcare/clinic";
import { DentalModule } from "@healthcare/dental";
import { accessLogMiddleware, type AppConfig, CoreModule, HttpExceptionFilter, IdempotencyInterceptor, requestIdMiddleware } from "@healthcare/core";
import { DocumentsModule } from "@healthcare/documents";
import { InventoryModule } from "@healthcare/inventory";
import { LaboratoryModule } from "@healthcare/laboratory";
import { BillingModule, BillingPricesModule } from "@healthcare/billing";
import { DohReportingModule, FhirImportModule, IntegrationModule, ReferenceLabIntegrationModule } from "@healthcare/interoperability";
import { NotificationModule } from "@healthcare/notification";
import { OrganizationModule } from "@healthcare/organization";
import { PatientMergeModule, PatientModule } from "@healthcare/patient";
import { PhilHealthModule } from "@healthcare/philhealth";
import { PrescriptionModule } from "@healthcare/prescription";
import { TelemedicineModule } from "@healthcare/telemedicine";
import { ZodValidationPipe } from "nestjs-zod";
import { AppPatientDirectory, AppPrescribingContext } from "./adapters/clinic-adapters";
import { AppInstrumentMessageReader } from "./adapters/instrument-adapters";
import { paymongoGatewayProvider } from "./adapters/payment-adapters";
import { AppDispensingStock } from "./adapters/inventory-adapters";
import { AppImmunizationContext, AppProcedureSupplies } from "./adapters/immunization-adapters";
import { RedisThrottlerStorage } from "./redis-throttler-storage";
import { RateLimitGuard } from "./rate-limit.guard";
import { RateLimitsController } from "./rate-limits.controller";
import { AppBillingSources } from "./adapters/billing-adapters";
import { AppDentalContext, AppDentalFees, AppDentalSupplies } from "./adapters/dental-adapters";
import { AppDohCaseSources } from "./adapters/doh-adapters";
import { AppFhirImportTargets } from "./adapters/fhir-import-adapters";
import { AppExchangePatients } from "./adapters/integration-adapters";
import { AppLaboratoryContext } from "./adapters/laboratory-adapters";
import { AppPhilHealthBillingSink, AppPhilHealthClaimSources, AppPhilHealthYakapSources } from "./adapters/philhealth-adapters";
import { AppReferenceLabSink, AppReferenceLabSources } from "./adapters/reference-lab-adapters";
import { AppPatientMergeContext } from "./adapters/patient-merge-adapters";
import { AppTelemedicineClinic } from "./adapters/telemedicine-adapters";
import { FhirController } from "./fhir/fhir.controller";
import { FhirImportReceiveController } from "./fhir/fhir-import.controller";
import { FhirRecordComposer } from "./fhir/fhir-record";
import { HealthController } from "./health.controller";
import { LaboratoryNotifications } from "./laboratory-notifications";
import { LaboratoryQualityNotifications } from "./laboratory-quality-notifications";
import { LaboratoryQualityReminders } from "./laboratory-quality-reminders";
import { PatientSummaryController } from "./patient-360/patient-summary.controller";
import { ManagementDashboardController } from "./management-dashboard/management-dashboard.controller";
import { ManagementDashboardService } from "./management-dashboard/management-dashboard.service";
import { PatientTimelineController } from "./patient-timeline/patient-timeline.controller";
import { PatientTimelineService } from "./patient-timeline/patient-timeline.service";
import { PatientWorkspaceController } from "./patient-360/patient-workspace.controller";
import { PatientWorkspaceService } from "./patient-360/patient-workspace.service";
import { CommunicationsController } from "./communications/communications.controller";
import { ControlledRegisterController } from "./controlled-register/controlled-register.controller";
import { RecordCopyController } from "./record-copy/record-copy.controller";
import { ReferralNotices } from "./referral-notices";
import { RecordCopyService } from "./record-copy/record-copy.service";
import { PatientDentalNotices } from "./portal/patient-dental-notices";
import { PatientRecordsNotices } from "./portal/patient-records-notices";
import { PortalSecurityNotices } from "./portal/portal-security-notices";
import { StaffSecurityNotices } from "./staff-security-notices";
import { PatientMessageNoticeSource } from "./portal/patient-message-notice-source";
import { PatientMessageNotices } from "./portal/patient-message-notices";
import { PatientResultNotices } from "./portal/patient-result-notices";
import { PortalBillingController } from "./portal/portal-billing.controller";
import { PortalBookingController } from "./portal/portal-booking.controller";
import { PatientPush } from "./portal/patient-push";
import { PortalPushController, PortalPushDevices } from "./portal/portal-push.controller";
import { PortalDentalController } from "./portal/portal-dental.controller";
import { PortalDocumentsController } from "./portal/portal-documents.controller";
import { PortalImmunizationsController } from "./portal/portal-immunizations.controller";
import { PortalHistoryController } from "./portal/portal-history.controller";
import { PortalMessagesController } from "./portal/portal-messages.controller";
import { PortalRecordsController } from "./portal/portal-records.controller";
import { PortalTeleconsultController } from "./portal/portal-teleconsult.controller";
import { RealtimeGateway } from "./realtime/realtime.gateway";
import { AppRecipientDirectory } from "./recipient-directory";

export interface AppModuleOverrides {
  /** Replaces S3 object storage (tests). */
  objectStorage?: Provider;
  /** Replaces the BullMQ notification queue (tests). */
  notificationQueue?: Provider;
  /** Replaces the PhilHealth eClaims adapter (tests; the default transmits nothing). */
  philhealthGateway?: Provider;
  /** Replaces the payment provider adapter (tests; the default takes no payment). */
  paymentGateway?: Provider;
  /** Replaces the PhilHealth eligibility adapter (tests; the default transmits nothing). */
  philhealthEligibilityGateway?: Provider;
  /** Replaces the PhilHealth YAKAP adapter (tests; the default transmits nothing). */
  philhealthYakapGateway?: Provider;
  /** Replaces the DOH reporting adapter (tests; the default transmits nothing). */
  dohGateway?: Provider;
  /** Replaces the reference laboratory adapter (tests; the default transmits nothing). */
  referenceLabGateway?: Provider;
  /** Replaces the BullMQ laboratory report archive queue (tests). */
  labReportArchiveQueue?: Provider;
  /** Replaces the BullMQ integration queue (tests). */
  integrationQueue?: Provider;
  /** Replaces the breached-password checker (tests; the default follows PASSWORD_BREACH_CHECK). */
  breachedPasswordChecker?: Provider;
  /** Disables rate limiting (tests exercise many logins from one address). */
  disableRateLimit?: boolean;
  /** Where the shared rate-limit counters live (tests: their own Redis address and a key prefix of their own). */
  rateLimitStorage?: { redisUrl: string; keyPrefix?: string };
}

/**
 * The API is a modular monolith (CLAUDE.md §2): one deployable, with each
 * domain contributed by its own library module.
 */
@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig, overrides: AppModuleOverrides = {}): DynamicModule {
    // One instance, imported by the app and by billing (which reads laboratory orders through an adapter).
    const laboratory = LaboratoryModule.forRoot({
      imports: [PatientModule, AuthModule, InventoryModule],
      context: AppLaboratoryContext,
      archiveQueue: overrides.labReportArchiveQueue,
      instrumentReader: AppInstrumentMessageReader,
    });
    // Imported by the app and by billing (which charges performed dental procedures through an adapter).
    // Dental supplies are issued from inventory through an adapter, inside dentistry's transaction; fee estimates read
    // billing's listed prices through another (only the price read: billing imports dentistry).
    const dental = DentalModule.forRoot({
      imports: [PatientModule, AuthModule, InventoryModule, BillingPricesModule],
      context: AppDentalContext,
      supplies: AppDentalSupplies,
      fees: AppDentalFees,
    });
    // Imported by the app and by the PhilHealth claims module (which reads invoices through an adapter).
    const billing = BillingModule.forRoot({
      imports: [PatientModule, laboratory, dental],
      sources: AppBillingSources,
      patients: AppPatientDirectory,
      paymentGateway: overrides.paymentGateway ?? paymongoGatewayProvider(config),
    });
    // Imported by the app and by the PhilHealth module (YAKAP reads a consultation's prescriptions through an adapter).
    const prescriptions = PrescriptionModule.forRoot({
      imports: [PatientModule, InventoryModule],
      prescribingContext: AppPrescribingContext,
      dispensingStock: AppDispensingStock,
    });
    const carePlans = CarePlanModule.forRoot({ imports: [PatientModule], patientDirectory: AppPatientDirectory });
    const rateLimitStorage = overrides.rateLimitStorage ?? { redisUrl: config.REDIS_URL };
    const rateLimits = new RedisThrottlerStorage(rateLimitStorage.redisUrl, rateLimitStorage.keyPrefix);
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        // Counters are shared by every instance through Redis; while Redis is unreachable requests are let through.
        ThrottlerModule.forRoot({
          throttlers: [{ name: "default", ttl: 60_000, limit: 300 }],
          skipIf: () => overrides.disableRateLimit === true,
          storage: rateLimits,
        }),
        AuditModule,
        OrganizationModule,
        // AuthModule registers the global AccessGuard: every route requires
        // authentication unless explicitly marked @Public().
        PasswordScreeningModule.forRoot(overrides.breachedPasswordChecker),
        AuthModule,
        PatientModule,
        DocumentsModule.forRoot({ storage: overrides.objectStorage }),
        NotificationModule.forRoot({
          imports: [PatientModule, AuthModule],
          recipientDirectory: AppRecipientDirectory,
          queue: overrides.notificationQueue,
        }),
        // Phase 2 — clinic. Cross-domain needs are satisfied by adapters defined here.
        // Immunizations read staff names (auth) and take vaccine stock (inventory) through an adapter.
        ClinicModule.forRoot({
          imports: [PatientModule, AuthModule, InventoryModule],
          patientDirectory: AppPatientDirectory,
          immunizationContext: AppImmunizationContext,
          procedureSupplies: AppProcedureSupplies,
        }),
        prescriptions,
        carePlans,
        // Phase 3 — laboratory.
        laboratory,
        // Phase 5 — telemedicine.
        TelemedicineModule.forRoot({ imports: [PatientModule], clinic: AppTelemedicineClinic }),
        // Phase 6 — dental: chart, examinations, treatment plans, procedures, imaging.
        dental,
        // Phase 7 — billing: charges from clinical events, invoices, payments.
        billing,
        // Phase 8 — PhilHealth eClaims, eligibility and YAKAP: preparation, recorded answers and adapter ports (unconfigured until the specifications are obtained).
        PhilHealthModule.forRoot({
          imports: [PatientModule, OrganizationModule, billing, laboratory, prescriptions],
          sources: AppPhilHealthClaimSources,
          billing: AppPhilHealthBillingSink,
          gateway: overrides.philhealthGateway,
          eligibilityGateway: overrides.philhealthEligibilityGateway,
          yakapSources: AppPhilHealthYakapSources,
          yakapGateway: overrides.philhealthYakapGateway,
        }),
        // Phase 8 — DOH disease case reporting (unconfigured until the specification is obtained).
        DohReportingModule.forRoot({ imports: [PatientModule, OrganizationModule], sources: AppDohCaseSources, gateway: overrides.dohGateway }),
        // Phase 8 — send-outs to reference laboratories: electronic submission (unconfigured until a laboratory's interface is obtained).
        ReferenceLabIntegrationModule.forRoot({
          imports: [PatientModule, laboratory],
          sources: AppReferenceLabSources,
          sink: AppReferenceLabSink,
          gateway: overrides.referenceLabGateway,
        }),
        // Phase 8 — FHIR R4 inbound: imports into a review queue; accepted entries go through the clinic domain.
        FhirImportModule.forRoot({ imports: [PatientModule], targets: AppFhirImportTargets }),
        // Phase 9 — inventory: stock ledger, lots and expiry, reorder levels.
        InventoryModule,
        // Patient merge (link, don't move): work in progress under the record to retire comes from the domains.
        PatientMergeModule.forRoot({
          imports: [PatientModule, AuthModule, OrganizationModule, laboratory, billing, carePlans],
          context: AppPatientMergeContext,
        }),
        // Outbound exchanges are sealed here and sent by apps/integration-worker.
        IntegrationModule.forRoot({ imports: [PatientModule], patients: AppExchangePatients, queue: overrides.integrationQueue }),
      ],
      controllers: [
        RateLimitsController,
        FhirController,
        FhirImportReceiveController,
        HealthController,
        PatientSummaryController,
        PatientTimelineController,
        PatientWorkspaceController,
        ManagementDashboardController,
        PortalBillingController,
        PortalBookingController,
        PortalPushController,
        PortalDentalController,
        PortalDocumentsController,
        PortalImmunizationsController,
        PortalHistoryController,
        PortalMessagesController,
        PortalRecordsController,
        PortalTeleconsultController,
        RecordCopyController,
        CommunicationsController,
        ControlledRegisterController,
      ],
      providers: [
        FhirRecordComposer,
        PatientTimelineService,
        PatientWorkspaceService,
        ManagementDashboardService,
        RecordCopyService,
        RealtimeGateway,
        LaboratoryNotifications,
        LaboratoryQualityNotifications,
        LaboratoryQualityReminders,
        PatientResultNotices,
        PatientDentalNotices,
        PatientPush,
        PortalPushDevices,
        PatientRecordsNotices,
        ReferralNotices,
        PortalSecurityNotices,
        StaffSecurityNotices,
        PatientMessageNoticeSource,
        PatientMessageNotices,
        // Rate limiting applies to every route, including the public login endpoints. The storage is a provider so
        // its Redis connection closes with the application.
        { provide: RedisThrottlerStorage, useValue: rateLimits },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // The request id first, so the access log line (one per finished request, health probes excluded) carries it.
    consumer.apply(requestIdMiddleware, accessLogMiddleware(new Logger("Http"))).forRoutes("*path");
  }
}
