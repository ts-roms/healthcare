import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { FhirImportController } from "./fhir-import.controller";
import { FhirImportRetention } from "./fhir-import-retention";
import { FhirImportService } from "./fhir-import.service";
import { FHIR_IMPORT_TARGETS, type FhirImportTargets } from "./ports";

export interface FhirImportModuleOptions {
  imports?: ModuleMetadata["imports"];
  /** The patient and clinic domains, through the app's adapters. */
  targets: Type<FhirImportTargets>;
}

/** FHIR R4 inbound: imports into a review queue (the receiving controller is in apps/api, under the FHIR base). */
@Module({})
export class FhirImportModule {
  static forRoot(options: FhirImportModuleOptions): DynamicModule {
    return {
      module: FhirImportModule,
      imports: options.imports ?? [],
      controllers: [FhirImportController],
      providers: [FhirImportService, FhirImportRetention, { provide: FHIR_IMPORT_TARGETS, useClass: options.targets }],
      exports: [FhirImportService, FhirImportRetention],
    };
  }
}
