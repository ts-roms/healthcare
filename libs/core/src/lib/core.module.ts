import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { DatabaseModule } from './database/database.module';

/** Global configuration and database access. Import once, in the app root module. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      imports: [DatabaseModule],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG, DatabaseModule],
    };
  }
}
