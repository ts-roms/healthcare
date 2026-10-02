import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { APP_CONFIG, type AppConfig, DATABASE, type Database } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationModule, OrganizationService } from "@healthcare/organization";
import { CrmCampaignRuns } from "./crm-campaign-runs";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CRM_PREFERENCES, CRM_SEGMENT_SOURCE, type CrmPreferenceWriter, type CrmSegmentSource } from "./ports";

export interface CrmModuleOptions {
  imports?: ModuleMetadata["imports"];
  /** Who matches a segment (patient, clinic and care-plan data, read by the composition root). */
  segmentSource: Type<CrmSegmentSource>;
  /** Records an opt-out in the patient's communication preferences. */
  preferenceWriter: Type<CrmPreferenceWriter>;
}

/** Outreach: segments, campaigns, deliveries and the opt-out link (docs/domains/crm.md). */
@Module({})
export class CrmModule {
  static forRoot(options: CrmModuleOptions): DynamicModule {
    return {
      module: CrmModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [CrmController],
      providers: [
        { provide: CRM_SEGMENT_SOURCE, useClass: options.segmentSource },
        { provide: CRM_PREFERENCES, useClass: options.preferenceWriter },
        {
          provide: CrmService,
          inject: [DATABASE, CRM_SEGMENT_SOURCE, CRM_PREFERENCES, NotificationService, OrganizationService, AuditService, APP_CONFIG],
          useFactory: (
            db: Database,
            source: CrmSegmentSource,
            preferences: CrmPreferenceWriter,
            notifications: NotificationService,
            organizations: OrganizationService,
            audit: AuditService,
            config: AppConfig,
          ) => new CrmService(db, source, preferences, notifications, organizations, audit, config.PORTAL_BASE_URL),
        },
        CrmCampaignRuns,
      ],
      exports: [CrmService, CrmCampaignRuns],
    };
  }
}
