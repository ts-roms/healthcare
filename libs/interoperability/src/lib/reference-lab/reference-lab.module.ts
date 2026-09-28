import { type DynamicModule, Injectable, Module, type ModuleMetadata, type OnModuleInit, type Provider, type Type } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { type ExchangeCompletedPayload, INTEGRATION_EXCHANGE_COMPLETED } from "../exchange/exchange-types";
import { referenceLabGatewayProvider } from "./gateway";
import { REFERENCE_LAB_SINK, REFERENCE_LAB_SOURCES, type ReferenceLabSink, type ReferenceLabSources } from "./ports";
import { ReferenceLabIntegrationController } from "./reference-lab.controller";
import { ReferenceLabSubmissions } from "./reference-lab-submissions.service";

/** Outbox subscription (at-least-once; the handler is idempotent). */
@Injectable()
export class ReferenceLabEvents implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly submissions: ReferenceLabSubmissions,
  ) {}

  onModuleInit(): void {
    this.handlers.on(INTEGRATION_EXCHANGE_COMPLETED, "reference-lab.submission-outcome", (event) =>
      this.submissions.exchangeCompleted(event.organizationId, event.payload as unknown as ExchangeCompletedPayload),
    );
  }
}

export interface ReferenceLabModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<ReferenceLabSources>;
  sink: Type<ReferenceLabSink>;
  /** The reference laboratory adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  gateway?: Provider;
}

/** Reference laboratory interface (API side): readiness, electronic submission requests for the integration worker, outcomes. */
@Module({})
export class ReferenceLabIntegrationModule {
  static forRoot(options: ReferenceLabModuleOptions): DynamicModule {
    return {
      module: ReferenceLabIntegrationModule,
      imports: options.imports ?? [],
      controllers: [ReferenceLabIntegrationController],
      providers: [
        ReferenceLabSubmissions,
        ReferenceLabEvents,
        options.gateway ?? referenceLabGatewayProvider,
        { provide: REFERENCE_LAB_SOURCES, useClass: options.sources },
        { provide: REFERENCE_LAB_SINK, useClass: options.sink },
      ],
    };
  }
}
