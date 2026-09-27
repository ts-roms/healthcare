import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { TELEMEDICINE_CLINIC, type TelemedicineClinic } from "./ports";
import { TelemedicineController } from "./telemedicine.controller";
import { TelemedicineService } from "./telemedicine.service";
import { LiveKitVideoProvider, VIDEO_PROVIDER } from "./video";

export interface TelemedicineModuleOptions {
  imports?: ModuleMetadata["imports"];
  clinic: Type<TelemedicineClinic>;
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
      controllers: [TelemedicineController],
      providers: [
        TelemedicineService,
        { provide: TELEMEDICINE_CLINIC, useClass: options.clinic },
        options.video ?? { provide: VIDEO_PROVIDER, useClass: LiveKitVideoProvider },
      ],
      exports: [TelemedicineService],
    };
  }
}
