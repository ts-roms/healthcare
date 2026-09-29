import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { DentalCatalogService } from "./catalog/dental-catalog.service";
import { DentalChartService } from "./chart/dental-chart.service";
import { DentalPlanController, DentalRecordController, DentalSettingsController, DentalSuppliesController } from "./dental.controllers";
import { DentalRecordQueries } from "./dental-record.queries";
import { DentalReportingQueries } from "./dental-reporting.queries";
import { DentalRecordService } from "./dental-record.service";
import { DentalImagingService } from "./imaging/dental-imaging.service";
import { DentalPerioService } from "./periodontal/dental-perio.service";
import { DentalFeeEstimates } from "./plans/dental-fee-estimates";
import { DentalFeeLookup } from "./plans/dental-fee-lookup";
import { DentalPlanService } from "./plans/dental-plan.service";
import { DENTAL_CONTEXT, DENTAL_FEES, DENTAL_SUPPLIES, type DentalContext, type DentalFees, type DentalSupplies } from "./ports";
import { DentalPatientAccess } from "./portal/dental-patient-access";
import { DentalPortalSettings } from "./portal/dental-portal-settings.service";
import { DentalProcedureService } from "./procedures/dental-procedure.service";
import { DentalSuppliesService } from "./supplies/dental-supplies.service";

export interface DentalModuleOptions {
  imports?: ModuleMetadata["imports"];
  context: Type<DentalContext>;
  /** Stock of dental supplies (inventory), used inside dentistry's transactions. */
  supplies: Type<DentalSupplies>;
  /** Listed prices from billing, for fee estimates. */
  fees: Type<DentalFees>;
}

/**
 * Dentistry (Phase 6): chart, examinations, treatment plans, procedures (and the supplies they use), imaging; the
 * patient-facing read model for MyHealth (`DentalPatientAccess`). Documents come from the global DocumentsModule.
 */
@Module({})
export class DentalModule {
  static forRoot(options: DentalModuleOptions): DynamicModule {
    return {
      module: DentalModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [DentalRecordController, DentalPlanController, DentalSettingsController, DentalSuppliesController],
      providers: [
        DentalCatalogService,
        DentalChartService,
        DentalPlanService,
        DentalFeeLookup,
        DentalFeeEstimates,
        DentalProcedureService,
        DentalImagingService,
        DentalPerioService,
        DentalRecordService,
        DentalPortalSettings,
        DentalPatientAccess,
        DentalSuppliesService,
        DentalRecordQueries,
        DentalReportingQueries,
        { provide: DENTAL_CONTEXT, useClass: options.context },
        { provide: DENTAL_SUPPLIES, useClass: options.supplies },
        { provide: DENTAL_FEES, useClass: options.fees },
      ],
      exports: [DentalProcedureService, DentalPatientAccess, DentalRecordQueries, DentalReportingQueries],
    };
  }
}
