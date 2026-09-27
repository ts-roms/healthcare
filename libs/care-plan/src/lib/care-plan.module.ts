import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { CarePlanController } from "./care-plan.controller";
import { OrganizationModule } from "@healthcare/organization";
import { CarePlanService } from "./care-plan.service";
import { CarePlanRecallReminders } from "./recall-reminders";
import { CARE_PLAN_PATIENTS, type CarePlanPatientDirectory } from "./ports";

export interface CarePlanModuleOptions {
  imports?: ModuleMetadata["imports"];
  /** Adapter giving patient numbers and names for the recall list. */
  patientDirectory: Type<CarePlanPatientDirectory>;
}

/** Care plans, goals, activities and the recall list. */
@Module({})
export class CarePlanModule {
  static forRoot(options: CarePlanModuleOptions): DynamicModule {
    return {
      module: CarePlanModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [CarePlanController],
      providers: [CarePlanService, CarePlanRecallReminders, { provide: CARE_PLAN_PATIENTS, useClass: options.patientDirectory }],
      exports: [CarePlanService, CarePlanRecallReminders],
    };
  }
}
