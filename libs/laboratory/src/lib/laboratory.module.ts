import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { OrganizationModule } from "@healthcare/organization";
import { LabCatalogService } from "./catalog/lab-catalog.service";
import { LabReadModel } from "./lab-read-model";
import { LabCatalogController, LabOrderController, LabResultController } from "./laboratory.controllers";
import { LabLabelService } from "./orders/lab-labels";
import { LabOrderService } from "./orders/lab-order.service";
import { LabWorklistService } from "./orders/lab-worklist.service";
import { LabReportService } from "./results/lab-report";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "./ports";
import { LabPatientAccess } from "./results/lab-patient-access";
import { LabRecordQueries } from "./results/lab-record-queries";
import { LAB_REPORT_ARCHIVE_QUEUE, LabReportArchive, type LabReportArchiveQueue } from "./results/lab-report-archive";
import { bullMqLabReportArchiveQueue, LabReportArchiveWorker } from "./results/lab-report-archive-queue";
import { LabResultService } from "./results/lab-result.service";

export interface LaboratoryModuleOptions {
  /** Modules providing what the context adapter depends on. */
  imports?: ModuleMetadata["imports"];
  /** Adapter to patients, practitioners, encounters and staff names. */
  context: Type<LaboratoryContext>;
  /** The report archive queue (tests). Defaults to BullMQ on REDIS_URL. */
  archiveQueue?: Provider;
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
        LabLabelService,
        LabOrderService,
        LabPatientAccess,
        LabRecordQueries,
        LabReadModel,
        LabReportService,
        LabReportArchive,
        LabResultService,
        LabWorklistService,
        { provide: LABORATORY_CONTEXT, useClass: options.context },
        options.archiveQueue ?? bullMqLabReportArchiveQueue,
        {
          provide: LabReportArchiveWorker,
          inject: [APP_CONFIG, LabReportArchive, LAB_REPORT_ARCHIVE_QUEUE],
          useFactory: (config: AppConfig, archive: LabReportArchive, queue: LabReportArchiveQueue) =>
            new LabReportArchiveWorker(config.REDIS_URL, archive, queue),
        },
      ],
      exports: [LabOrderService, LabPatientAccess, LabRecordQueries, LabReportService, LabReportArchive, LabReportArchiveWorker, LabResultService],
    };
  }
}
