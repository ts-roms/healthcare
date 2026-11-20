import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { PrescriptionAssistantQueries } from "./assistant/prescription-assistant.queries";
import { DispensingController } from "./dispensing/dispensing.controller";
import { PrescriptionDispenseService } from "./dispensing/prescription-dispense.service";
import { PrescribingMedicineController } from "./medicines/prescribing-medicine.controller";
import { PrescribingMedicineService } from "./medicines/prescribing-medicine.service";
import { DISPENSING_STOCK, type DispensingStock, PRESCRIBING_CONTEXT, type PrescribingContext } from "./ports";
import { PrescriptionController } from "./prescription.controller";
import { PrescriptionListService } from "./prescription-list.service";
import { PrescriptionReportingQueries } from "./prescription-reporting.queries";
import { PrescriptionService } from "./prescription.service";

export interface PrescriptionModuleOptions {
  imports?: ModuleMetadata["imports"];
  prescribingContext: Type<PrescribingContext>;
  /** Inventory, for dispensing (stock taken in the dispensing transaction). */
  dispensingStock: Type<DispensingStock>;
}

@Module({})
export class PrescriptionModule {
  static forRoot(options: PrescriptionModuleOptions): DynamicModule {
    return {
      module: PrescriptionModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [PrescriptionController, DispensingController, PrescribingMedicineController],
      providers: [
        PrescriptionService,
        PrescriptionDispenseService,
        PrescriptionListService,
        PrescriptionReportingQueries,
        PrescribingMedicineService,
        PrescriptionAssistantQueries,
        { provide: PRESCRIBING_CONTEXT, useClass: options.prescribingContext },
        { provide: DISPENSING_STOCK, useClass: options.dispensingStock },
      ],
      exports: [PrescriptionService, PrescriptionReportingQueries, PrescribingMedicineService, PrescriptionAssistantQueries],
    };
  }
}
