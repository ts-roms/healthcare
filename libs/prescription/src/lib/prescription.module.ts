import { type DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';
import { PRESCRIBING_CONTEXT, type PrescribingContext } from './ports';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';

export interface PrescriptionModuleOptions {
  imports?: ModuleMetadata['imports'];
  prescribingContext: Type<PrescribingContext>;
}

@Module({})
export class PrescriptionModule {
  static forRoot(options: PrescriptionModuleOptions): DynamicModule {
    return {
      module: PrescriptionModule,
      imports: options.imports ?? [],
      controllers: [PrescriptionController],
      providers: [PrescriptionService, { provide: PRESCRIBING_CONTEXT, useClass: options.prescribingContext }],
      exports: [PrescriptionService],
    };
  }
}
