import { type DynamicModule, Module } from '@nestjs/common';
import { type AppConfig, CoreModule } from '@healthcare/core';
import { NotificationWorkerModule } from '@healthcare/notification';

/** Background delivery of notifications. Scales independently of the API. */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(config), NotificationWorkerModule.forRoot()],
    };
  }
}
