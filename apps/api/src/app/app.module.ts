import { DynamicModule, MiddlewareConsumer, Module, NestModule, type Provider } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "@healthcare/audit";
import { AuthModule } from "@healthcare/auth";
import { CarePlanModule } from "@healthcare/care-plan";
import { ClinicModule } from "@healthcare/clinic";
import { DentalModule } from "@healthcare/dental";
import { type AppConfig, CoreModule, HttpExceptionFilter, IdempotencyInterceptor, requestIdMiddleware } from "@healthcare/core";
import { DocumentsModule } from "@healthcare/documents";
import { InventoryModule } from "@healthcare/inventory";
import { LaboratoryModule } from "@healthcare/laboratory";
import { BillingModule } from "@healthcare/billing";
import { DohReportingModule, IntegrationModule, PhilHealthModule } from "@healthcare/interoperability";
import { NotificationModule } from "@healthcare/notification";
import { OrganizationModule } from "@healthcare/organization";
import { PatientModule } from "@healthcare/patient";
import { PrescriptionModule } from "@healthcare/prescription";
import { TelemedicineModule } from "@healthcare/telemedicine";
import { ZodValidationPipe } from "nestjs-zod";
import { AppPatientDirectory, AppPrescribingContext } from "./adapters/clinic-adapters";
import { AppBillingSources } from "./adapters/billing-adapters";
import { AppDentalContext } from "./adapters/dental-adapters";
import { AppDohCaseSources } from "./adapters/doh-adapters";
import { AppExchangePatients } from "./adapters/integration-adapters";
import { AppLaboratoryContext } from "./adapters/laboratory-adapters";
import { AppPhilHealthBillingSink, AppPhilHealthClaimSources } from "./adapters/philhealth-adapters";
import { AppTelemedicineClinic } from "./adapters/telemedicine-adapters";
import { FhirController } from "./fhir/fhir.controller";
import { FhirRecordComposer } from "./fhir/fhir-record";
import { HealthController } from "./health.controller";
import { LaboratoryNotifications } from "./laboratory-notifications";
import { PatientSummaryController } from "./patient-360/patient-summary.controller";
import { PatientResultNotices } from "./portal/patient-result-notices";
import { PortalBillingController } from "./portal/portal-billing.controller";
import { PortalBookingController } from "./portal/portal-booking.controller";
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
  /** Replaces the PhilHealth eligibility adapter (tests; the default transmits nothing). */
  philhealthEligibilityGateway?: Provider;
  /** Replaces the DOH reporting adapter (tests; the default transmits nothing). */
  dohGateway?: Provider;
  /** Replaces the BullMQ laboratory report archive queue (tests). */
  labReportArchiveQueue?: Provider;
  /** Replaces the BullMQ integration queue (tests). */
  integrationQueue?: Provider;
  /** Disables rate limiting (tests exercise many logins from one address). */
  disableRateLimit?: boolean;
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
      imports: [PatientModule, AuthModule],
      context: AppLaboratoryContext,
      archiveQueue: overrides.labReportArchiveQueue,
    });
    // Imported by the app and by billing (which charges performed dental procedures through an adapter).
    const dental = DentalModule.forRoot({ imports: [PatientModule, AuthModule], context: AppDentalContext });
    // Imported by the app and by the PhilHealth claims module (which reads invoices through an adapter).
    const billing = BillingModule.forRoot({ imports: [PatientModule, laboratory, dental], sources: AppBillingSources, patients: AppPatientDirectory });
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        // In-memory limits are per instance; move storage to Redis before scaling out.
        ThrottlerModule.forRoot({
          throttlers: [{ name: "default", ttl: 60_000, limit: 300 }],
          skipIf: () => overrides.disableRateLimit === true,
        }),
        AuditModule,
        OrganizationModule,
        // AuthModule registers the global AccessGuard: every route requires
        // authentication unless explicitly marked @Public().
        AuthModule,
        PatientModule,
        DocumentsModule.forRoot({ storage: overrides.objectStorage }),
        NotificationModule.forRoot({
          imports: [PatientModule, AuthModule],
          recipientDirectory: AppRecipientDirectory,
          queue: overrides.notificationQueue,
        }),
        // Phase 2 — clinic. Cross-domain needs are satisfied by adapters defined here.
        ClinicModule.forRoot({ imports: [PatientModule], patientDirectory: AppPatientDirectory }),
        PrescriptionModule.forRoot({ prescribingContext: AppPrescribingContext }),
        CarePlanModule.forRoot({ imports: [PatientModule], patientDirectory: AppPatientDirectory }),
        // Phase 3 — laboratory.
        laboratory,
        // Phase 5 — telemedicine.
        TelemedicineModule.forRoot({ imports: [PatientModule], clinic: AppTelemedicineClinic }),
        // Phase 6 — dental: chart, examinations, treatment plans, procedures, imaging.
        dental,
        // Phase 7 — billing: charges from clinical events, invoices, payments.
        billing,
        // Phase 8 — PhilHealth eClaims: claim preparation and the adapter port (unconfigured until the specification is obtained).
        PhilHealthModule.forRoot({
          imports: [PatientModule, billing],
          sources: AppPhilHealthClaimSources,
          billing: AppPhilHealthBillingSink,
          gateway: overrides.philhealthGateway,
          eligibilityGateway: overrides.philhealthEligibilityGateway,
        }),
        // Phase 8 — DOH disease case reporting (unconfigured until the specification is obtained).
        DohReportingModule.forRoot({ imports: [PatientModule], sources: AppDohCaseSources, gateway: overrides.dohGateway }),
        // Phase 9 — inventory: stock ledger, lots and expiry, reorder levels.
        InventoryModule,
        // Outbound exchanges are sealed here and sent by apps/integration-worker.
        IntegrationModule.forRoot({ imports: [PatientModule], patients: AppExchangePatients, queue: overrides.integrationQueue }),
      ],
      controllers: [
        FhirController,
        HealthController,
        PatientSummaryController,
        PortalBillingController,
        PortalBookingController,
        PortalMessagesController,
        PortalRecordsController,
        PortalTeleconsultController,
      ],
      providers: [
        FhirRecordComposer,
        RealtimeGateway,
        LaboratoryNotifications,
        PatientResultNotices,
        // Rate limiting applies to every route, including the public login endpoints.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes("*path");
  }
}
