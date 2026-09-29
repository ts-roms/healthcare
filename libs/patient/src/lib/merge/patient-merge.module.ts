import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { PatientMergeController } from "./patient-merge.controller";
import { PatientMergeService } from "./patient-merge.service";
import { PATIENT_MERGE_CONTEXT, type PatientMergeContext } from "./ports";

export interface PatientMergeModuleOptions {
  /** Modules providing what the context adapter depends on. */
  imports?: ModuleMetadata["imports"];
  context: Type<PatientMergeContext>;
}

/** Patient merge and unmerge (ADR-0009). Separate from PatientModule, which every domain imports, because it needs a port. */
@Module({})
export class PatientMergeModule {
  static forRoot(options: PatientMergeModuleOptions): DynamicModule {
    return {
      module: PatientMergeModule,
      global: true,
      imports: [...(options.imports ?? [])],
      controllers: [PatientMergeController],
      providers: [PatientMergeService, { provide: PATIENT_MERGE_CONTEXT, useClass: options.context }],
      exports: [PatientMergeService],
    };
  }
}
