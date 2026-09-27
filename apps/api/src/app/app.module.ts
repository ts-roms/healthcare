import { DynamicModule, MiddlewareConsumer, Module, NestModule, type Provider } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "@healthcare/audit";
import { AuthModule } from "@healthcare/auth";
import { CarePlanModule } from "@healthcare/care-plan";
import { ClinicModule } from "@healthcare/clinic";
import { type AppConfig, CoreModule, HttpExceptionFilter, IdempotencyInterceptor, requestIdMiddleware } from "@healthcare/core";
import { DocumentsModule } from "@healthcare/documents";
import { LaboratoryModule } from "@healthcare/laboratory";
import { NotificationModule } from "@healthcare/notification";
import { OrganizationModule } from "@healthcare/organization";
import { PatientModule } from "@healthcare/patient";
import { PrescriptionModule } from "@healthcare/prescription";
import { TelemedicineModule } from "@healthcare/telemedicine";
import { ZodValidationPipe } from "nestjs-zod";
import { AppPatientDirectory, AppPrescribingContext } from "./adapters/clinic-adapters";
import { AppLaboratoryContext } from "./adapters/laboratory-adapters";
import { AppTelemedicineClinic } from "./adapters/telemedicine-adapters";
import { HealthController } from "./health.controller";
import { LaboratoryNotifications } from "./laboratory-notifications";
import { PatientSummaryController } from "./patient-360/patient-summary.controller";
import { PatientResultNotices } from "./portal/patient-result-notices";
import { PortalRecordsController } from "./portal/portal-records.controller";
import { PortalTeleconsultController } from "./portal/portal-teleconsult.controller";
import { RealtimeGateway } from "./realtime/realtime.gateway";
import { AppRecipientDirectory } from "./recipient-directory";

export interface AppModuleOverrides {
  /** Replaces S3 object storage (tests). */
  objectStorage?: Provider;
  /** Replaces the BullMQ notification queue (tests). */
  notificationQueue?: Provider;
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
        LaboratoryModule.forRoot({ imports: [PatientModule, AuthModule], context: AppLaboratoryContext }),
        // Phase 5 — telemedicine.
        TelemedicineModule.forRoot({ imports: [PatientModule], clinic: AppTelemedicineClinic }),
      ],
      controllers: [HealthController, PatientSummaryController, PortalRecordsController, PortalTeleconsultController],
      providers: [
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
