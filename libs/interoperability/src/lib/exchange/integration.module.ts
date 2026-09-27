import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { bullMqIntegrationQueue } from "./bullmq";
import { ExchangeDispatch } from "./exchange-dispatch";
import { IntegrationExchanges } from "./integration-exchanges.service";

export interface IntegrationModuleOptions {
  /** The integration queue (tests). Defaults to BullMQ on REDIS_URL. */
  queue?: Provider;
}

/**
 * API side of outbound integrations: records exchanges, seals their payloads and hands them to the integration
 * worker's queue. Global, so each integration module (PhilHealth, DOH, …) uses the one queue connection.
 */
@Module({})
export class IntegrationModule {
  static forRoot(options: IntegrationModuleOptions = {}): DynamicModule {
    return {
      module: IntegrationModule,
      global: true,
      providers: [IntegrationExchanges, ExchangeDispatch, options.queue ?? bullMqIntegrationQueue],
      exports: [IntegrationExchanges],
    };
  }
}
