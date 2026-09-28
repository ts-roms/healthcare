import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { bullMqIntegrationQueue } from "./bullmq";
import { ExchangeDispatch } from "./exchange-dispatch";
import { ExchangeReviewController } from "./exchange-review.controller";
import { ExchangeReviewService } from "./exchange-review.service";
import { EXCHANGE_PATIENTS, type ExchangePatientDirectory } from "./exchange-types";
import { IntegrationExchanges } from "./integration-exchanges.service";
import { PayloadKeysController } from "./payload-keys.controller";
import { PayloadKeyUsageService } from "./payload-keys.service";

export interface IntegrationModuleOptions {
  imports?: ModuleMetadata["imports"];
  /** Patient numbers and names for the review screen. */
  patients: Type<ExchangePatientDirectory>;
  /** The integration queue (tests). Defaults to BullMQ on REDIS_URL. */
  queue?: Provider;
}

/**
 * API side of outbound integrations: records exchanges, seals their payloads and hands them to the integration
 * worker's queue. Global, so each integration module (PhilHealth, DOH, …) uses the one queue connection.
 */
@Module({})
export class IntegrationModule {
  static forRoot(options: IntegrationModuleOptions): DynamicModule {
    return {
      module: IntegrationModule,
      global: true,
      imports: options.imports ?? [],
      controllers: [ExchangeReviewController, PayloadKeysController],
      providers: [
        IntegrationExchanges,
        ExchangeDispatch,
        ExchangeReviewService,
        PayloadKeyUsageService,
        options.queue ?? bullMqIntegrationQueue,
        { provide: EXCHANGE_PATIENTS, useClass: options.patients },
      ],
      exports: [IntegrationExchanges],
    };
  }
}
