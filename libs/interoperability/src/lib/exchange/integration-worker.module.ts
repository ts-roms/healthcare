import { type DynamicModule, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown, type Provider, type Type } from "@nestjs/common";
import { AuditModule } from "@healthcare/audit";
import { APP_CONFIG, type AppConfig, asPlatform } from "@healthcare/core";
import { DohCaseReportHandler, dohGatewayProvider } from "../doh/gateway";
import { ReferenceLabSendOutHandler, referenceLabGatewayProvider } from "../reference-lab/gateway";
import { bullMqIntegrationQueue, IntegrationWorkerRunner } from "./bullmq";
import { IntegrationExchangeProcessor } from "./exchange-processor";
import { EXCHANGE_HANDLERS, type ExchangeHandler, INTEGRATION_QUEUE, type IntegrationQueue } from "./exchange-types";

/**
 * One adapter family's worker side, supplied by the composition root (e.g. `philhealthExchangeHandlers()` from
 * `@healthcare/philhealth`): the providers its handlers need (gateways) and its handlers, one per system + operation.
 */
export interface ExchangeHandlerSet {
  providers?: Provider[];
  handlers: Type<ExchangeHandler>[];
}

export interface IntegrationWorkerModuleOptions {
  /** Further adapter families' handlers. This library's own (DOH case reporting, reference laboratory send-outs) are always registered. */
  handlerSets?: ExchangeHandlerSet[];
  /** The DOH reporting adapter (defaults to the unconfigured one). */
  dohGateway?: Provider;
  /** The reference laboratory adapter (defaults to the unconfigured one). */
  referenceLabGateway?: Provider;
  queue?: Provider;
  /** Start consuming the queue on bootstrap (false in tests). */
  autoStart?: boolean;
}

class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("IntegrationWorker");

  constructor(
    private readonly runner: IntegrationWorkerRunner,
    private readonly processor: IntegrationExchangeProcessor,
    private readonly autoStart: boolean,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.autoStart) return;
    // A key removed from INTEGRATION_PAYLOAD_KEYS before its payloads were sent: say so before those exchanges fail.
    const missing = await asPlatform("payload key check at start-up", () => this.processor.unavailableKeyIds());
    if (missing.length) this.logger.error(`Queued payloads are sealed with key id(s) not configured here: ${missing.join(", ")} — they will fail unsent`);
    this.runner.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner.stop();
  }
}

/** Worker side of outbound integrations (apps/integration-worker): sends queued exchanges through their adapters. */
@Module({})
export class IntegrationWorkerModule {
  static forRoot(options: IntegrationWorkerModuleOptions = {}): DynamicModule {
    const sets = options.handlerSets ?? [];
    const handlers: Type<ExchangeHandler>[] = [...sets.flatMap((set) => set.handlers), DohCaseReportHandler, ReferenceLabSendOutHandler];
    return {
      module: IntegrationWorkerModule,
      imports: [AuditModule],
      providers: [
        IntegrationExchangeProcessor,
        ...sets.flatMap((set) => set.providers ?? []),
        options.dohGateway ?? dohGatewayProvider,
        options.referenceLabGateway ?? referenceLabGatewayProvider,
        ...handlers,
        // One handler per system + operation.
        { provide: EXCHANGE_HANDLERS, inject: handlers, useFactory: (...instances: ExchangeHandler[]) => instances },
        options.queue ?? bullMqIntegrationQueue,
        {
          provide: IntegrationWorkerRunner,
          inject: [APP_CONFIG, IntegrationExchangeProcessor, INTEGRATION_QUEUE],
          useFactory: (config: AppConfig, processor: IntegrationExchangeProcessor, queue: IntegrationQueue) =>
            new IntegrationWorkerRunner(config.REDIS_URL, processor, queue),
        },
        {
          provide: WorkerLifecycle,
          inject: [IntegrationWorkerRunner, IntegrationExchangeProcessor],
          useFactory: (runner: IntegrationWorkerRunner, processor: IntegrationExchangeProcessor) =>
            new WorkerLifecycle(runner, processor, options.autoStart ?? true),
        },
      ],
      exports: [IntegrationExchangeProcessor, IntegrationWorkerRunner],
    };
  }
}
