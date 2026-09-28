import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { DentalCatalogService } from "./catalog/dental-catalog.service";
import { DentalChartService } from "./chart/dental-chart.service";
import { DentalPlanController, DentalRecordController, DentalSettingsController } from "./dental.controllers";
import { DentalRecordService } from "./dental-record.service";
import { DentalImagingService } from "./imaging/dental-imaging.service";
import { DentalPerioService } from "./periodontal/dental-perio.service";
import { DentalPlanService } from "./plans/dental-plan.service";
import { DENTAL_CONTEXT, type DentalContext } from "./ports";
import { DentalProcedureService } from "./procedures/dental-procedure.service";

export interface DentalModuleOptions {
  imports?: ModuleMetadata["imports"];
  context: Type<DentalContext>;
}

/** Dentistry (Phase 6): chart, examinations, treatment plans, procedures, imaging. Documents come from the global DocumentsModule. */
@Module({})
export class DentalModule {
  static forRoot(options: DentalModuleOptions): DynamicModule {
    return {
      module: DentalModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [DentalRecordController, DentalPlanController, DentalSettingsController],
      providers: [
        DentalCatalogService,
        DentalChartService,
        DentalPlanService,
        DentalProcedureService,
        DentalImagingService,
        DentalPerioService,
        DentalRecordService,
        { provide: DENTAL_CONTEXT, useClass: options.context },
      ],
      exports: [DentalProcedureService],
    };
  }
}
