import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { DatabaseModule } from './database/database.module';
import { DomainEventHandlers, DomainEventPublisher, OutboxRelay } from './events/domain-events';

/** Global configuration and database access. Import once, in the app root module. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      imports: [DatabaseModule],
      providers: [{ provide: APP_CONFIG, useValue: config }, DomainEventPublisher, DomainEventHandlers, OutboxRelay],
      exports: [APP_CONFIG, DatabaseModule, DomainEventPublisher, DomainEventHandlers, OutboxRelay],
    };
  }
}
