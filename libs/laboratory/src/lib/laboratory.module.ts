import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { LabCatalogService } from "./catalog/lab-catalog.service";
import { LabReadModel } from "./lab-read-model";
import { LabCatalogController, LabOrderController, LabResultController } from "./laboratory.controllers";
import { LabOrderService } from "./orders/lab-order.service";
import { LabWorklistService } from "./orders/lab-worklist.service";
import { LabReportService } from "./results/lab-report";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "./ports";
import { LabPatientAccess } from "./results/lab-patient-access";
import { LabRecordQueries } from "./results/lab-record-queries";
import { LabResultService } from "./results/lab-result.service";

export interface LaboratoryModuleOptions {
  /** Modules providing what the context adapter depends on. */
  imports?: ModuleMetadata["imports"];
  /** Adapter to patients, practitioners, encounters and staff names. */
  context: Type<LaboratoryContext>;
}

/** Laboratory Information System: catalog, orders, specimens, results, critical values, worklists. */
@Module({})
export class LaboratoryModule {
  static forRoot(options: LaboratoryModuleOptions): DynamicModule {
    return {
      module: LaboratoryModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [LabCatalogController, LabOrderController, LabResultController],
      providers: [
        LabCatalogService,
        LabOrderService,
        LabPatientAccess,
        LabRecordQueries,
        LabReadModel,
        LabReportService,
        LabResultService,
        LabWorklistService,
        { provide: LABORATORY_CONTEXT, useClass: options.context },
      ],
      exports: [LabOrderService, LabPatientAccess, LabRecordQueries, LabReportService, LabResultService],
    };
  }
}
