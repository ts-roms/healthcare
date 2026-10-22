import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { TELEMEDICINE_CLINIC, TELEMEDICINE_PAYMENTS, type TelemedicineClinic, type TelemedicinePayments } from "./ports";
import { TelemedicineController, TelemedicineSettingController } from "./telemedicine.controller";
import { TelemedicineChatService } from "./telemedicine-chat.service";
import { TelemedicineSettingService } from "./telemedicine-setting.service";
import { TelemedicineReportingQueries } from "./telemedicine-reporting.queries";
import { TelemedicineService } from "./telemedicine.service";
import { LiveKitVideoProvider, VIDEO_PROVIDER } from "./video";

export interface TelemedicineModuleOptions {
  imports?: ModuleMetadata["imports"];
  clinic: Type<TelemedicineClinic>;
  /** Billing, for organizations that require payment before the waiting room. */
  payments: Type<TelemedicinePayments>;
  /** Replaces the LiveKit provider (tests). */
  video?: Provider;
}

/** Online consultations: questionnaire, waiting room, video, escalation. */
@Module({})
export class TelemedicineModule {
  static forRoot(options: TelemedicineModuleOptions): DynamicModule {
    return {
      module: TelemedicineModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [TelemedicineController, TelemedicineSettingController],
      providers: [
        TelemedicineService,
        TelemedicineSettingService,
        TelemedicineChatService,
        TelemedicineReportingQueries,
        { provide: TELEMEDICINE_CLINIC, useClass: options.clinic },
        { provide: TELEMEDICINE_PAYMENTS, useClass: options.payments },
        options.video ?? { provide: VIDEO_PROVIDER, useClass: LiveKitVideoProvider },
      ],
      exports: [TelemedicineService, TelemedicineChatService, TelemedicineReportingQueries],
    };
  }
}
