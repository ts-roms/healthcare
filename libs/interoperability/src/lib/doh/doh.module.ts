import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { DohController } from "./doh.controller";
import { DohEvents } from "./doh-events";
import { DohReportsService } from "./doh-reports.service";
import { DohRescans } from "./doh-rescans.service";
import { DohSettingsService } from "./doh-settings.service";
import { dohGatewayProvider } from "./gateway";
import { DOH_CASE_SOURCES, type DohCaseSources } from "./ports";

export interface DohModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<DohCaseSources>;
  /** The DOH reporting adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  gateway?: Provider;
}

/** DOH disease case reporting (API side): detection from configured rules (and checks of earlier diagnoses), review, submission requests. */
@Module({})
export class DohReportingModule {
  static forRoot(options: DohModuleOptions): DynamicModule {
    return {
      module: DohReportingModule,
      imports: options.imports ?? [],
      controllers: [DohController],
      providers: [
        DohReportsService,
        DohRescans,
        DohSettingsService,
        DohEvents,
        options.gateway ?? dohGatewayProvider,
        { provide: DOH_CASE_SOURCES, useClass: options.sources },
      ],
      exports: [DohRescans],
    };
  }
}
