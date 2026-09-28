import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { DispensingController } from "./dispensing/dispensing.controller";
import { PrescriptionDispenseService } from "./dispensing/prescription-dispense.service";
import { DISPENSING_STOCK, type DispensingStock, PRESCRIBING_CONTEXT, type PrescribingContext } from "./ports";
import { PrescriptionController } from "./prescription.controller";
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
      controllers: [PrescriptionController, DispensingController],
      providers: [
        PrescriptionService,
        PrescriptionDispenseService,
        { provide: PRESCRIBING_CONTEXT, useClass: options.prescribingContext },
        { provide: DISPENSING_STOCK, useClass: options.dispensingStock },
      ],
      exports: [PrescriptionService],
    };
  }
}
