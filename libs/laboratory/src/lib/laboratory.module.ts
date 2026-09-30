import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { OrganizationModule } from "@healthcare/organization";
import { LabCatalogService } from "./catalog/lab-catalog.service";
import { INSTRUMENT_MESSAGE_READER, type InstrumentMessageReader } from "./instruments/instrument-interface.ports";
import { LabInstrumentInterfaceController } from "./instruments/lab-instrument-interface.controller";
import { LabInstrumentInterfaceService } from "./instruments/lab-instrument-interface.service";
import { LabReadModel } from "./lab-read-model";
import { LabCatalogController, LabOrderController, LabResultController } from "./laboratory.controllers";
import { LabLabelService } from "./orders/lab-labels";
import { LabOrderService } from "./orders/lab-order.service";
import { LabWorklistService } from "./orders/lab-worklist.service";
import { LabReportService } from "./results/lab-report";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "./ports";
import { LabCompetencyService } from "./quality/lab-competency.service";
import { LabLicenceService } from "./quality/lab-licence.service";
import { LabQualitySummaryService } from "./quality/lab-quality-summary.service";
import { LabQualityDue } from "./quality/lab-quality-due";
import { LabEqaService } from "./quality/lab-eqa.service";
import { LabNonconformanceService } from "./quality/lab-nonconformance.service";
import { LabQualityController } from "./quality/lab-quality.controller";
import { LabQualityManagementController } from "./quality/lab-quality-management.controller";
import { LabTemperatureService } from "./quality/lab-temperature.service";
import { LabQualityService } from "./quality/lab-quality.service";
import { LabReagentService } from "./quality/lab-reagent.service";
import { LabPatientAccess } from "./results/lab-patient-access";
import { LabRecordQueries } from "./results/lab-record-queries";
import { LabReportingQueries } from "./results/lab-reporting.queries";
import { LabResultAttachments } from "./results/lab-result-attachments";
import { LAB_REPORT_ARCHIVE_QUEUE, LabReportArchive, type LabReportArchiveQueue } from "./results/lab-report-archive";
import { bullMqLabReportArchiveQueue, LabReportArchiveWorker } from "./results/lab-report-archive-queue";
import { LabResultService } from "./results/lab-result.service";
import { ReferenceLabService } from "./send-outs/reference-lab.service";
import { ReferenceLabController, SendOutController } from "./send-outs/send-out.controller";
import { SendOutManifestService } from "./send-outs/send-out-manifest";
import { SendOutService } from "./send-outs/send-out.service";

export interface LaboratoryModuleOptions {
  /** Modules providing what the context adapter depends on. */
  imports?: ModuleMetadata["imports"];
  /** Adapter to patients, practitioners, encounters and staff names. */
  context: Type<LaboratoryContext>;
  /** The report archive queue (tests). Defaults to BullMQ on REDIS_URL. */
  archiveQueue?: Provider;
  /** Reads analyzer messages (HL7 v2 / ASTM): an adapter over the interoperability layer. */
  instrumentReader: Type<InstrumentMessageReader>;
}

/** Laboratory Information System: catalog, orders, specimens, results, critical values, worklists, send-outs to reference laboratories. */
@Module({})
export class LaboratoryModule {
  static forRoot(options: LaboratoryModuleOptions): DynamicModule {
    return {
      module: LaboratoryModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [
        LabCatalogController,
        LabOrderController,
        LabResultController,
        ReferenceLabController,
        SendOutController,
        LabQualityController,
        LabQualityManagementController,
        LabInstrumentInterfaceController,
      ],
      providers: [
        LabCatalogService,
        LabLabelService,
        LabOrderService,
        LabPatientAccess,
        LabQualityService,
        LabReagentService,
        LabNonconformanceService,
        LabTemperatureService,
        LabEqaService,
        LabCompetencyService,
        LabQualitySummaryService,
        LabLicenceService,
        LabQualityDue,
        LabReagentService,
        LabRecordQueries,
        LabReportingQueries,
        LabReadModel,
        LabReportService,
        LabReportArchive,
        LabResultService,
        LabResultAttachments,
        LabWorklistService,
        ReferenceLabService,
        SendOutService,
        SendOutManifestService,
        { provide: LABORATORY_CONTEXT, useClass: options.context },
        { provide: INSTRUMENT_MESSAGE_READER, useClass: options.instrumentReader },
        LabInstrumentInterfaceService,
        options.archiveQueue ?? bullMqLabReportArchiveQueue,
        {
          provide: LabReportArchiveWorker,
          inject: [APP_CONFIG, LabReportArchive, LAB_REPORT_ARCHIVE_QUEUE],
          useFactory: (config: AppConfig, archive: LabReportArchive, queue: LabReportArchiveQueue) =>
            new LabReportArchiveWorker(config.REDIS_URL, archive, queue),
        },
      ],
      exports: [
        LabOrderService,
        LabQualityService,
        LabQualityDue,
        LabReagentService,
        LabPatientAccess,
        LabRecordQueries,
        LabReportingQueries,
        LabReportService,
        LabReportArchive,
        LabReportArchiveWorker,
        LabResultService,
        SendOutService,
      ],
    };
  }
}
