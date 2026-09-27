import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { ExchangeDispatch } from "../exchange/exchange-dispatch";
import { IntegrationExchanges } from "../exchange/integration-exchanges.service";
import { bullMqIntegrationQueue } from "../exchange/bullmq";
import { philhealthGatewayProvider } from "./gateway";
import { PhilHealthController } from "./philhealth.controller";
import { PhilHealthClaimsService } from "./philhealth-claims.service";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PhilHealthOutcomes } from "./philhealth-outcomes";
import { PHILHEALTH_BILLING_SINK, PHILHEALTH_CLAIM_SOURCES, type PhilHealthBillingSink, type PhilHealthClaimSources } from "./ports";

export interface PhilHealthModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<PhilHealthClaimSources>;
  billing: Type<PhilHealthBillingSink>;
  /** The eClaims adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  gateway?: Provider;
  /** The integration queue (tests). Defaults to BullMQ on REDIS_URL. */
  queue?: Provider;
}

/** PhilHealth claims (API side): claim preparation from issued invoices, readiness checks, submission requests for the integration worker. */
@Module({})
export class PhilHealthModule {
  static forRoot(options: PhilHealthModuleOptions): DynamicModule {
    return {
      module: PhilHealthModule,
      imports: options.imports ?? [],
      controllers: [PhilHealthController],
      providers: [
        PhilHealthClaimsService,
        PhilHealthSettingsService,
        PhilHealthOutcomes,
        IntegrationExchanges,
        ExchangeDispatch,
        options.gateway ?? philhealthGatewayProvider,
        options.queue ?? bullMqIntegrationQueue,
        { provide: PHILHEALTH_CLAIM_SOURCES, useClass: options.sources },
        { provide: PHILHEALTH_BILLING_SINK, useClass: options.billing },
      ],
      exports: [PhilHealthClaimsService],
    };
  }
}
