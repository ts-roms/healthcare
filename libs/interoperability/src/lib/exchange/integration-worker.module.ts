import { type DynamicModule, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { AuditModule } from "@healthcare/audit";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { DohCaseReportHandler, dohGatewayProvider } from "../doh/gateway";
import { PhilHealthEligibilityHandler, philhealthEligibilityGatewayProvider } from "../philhealth/eligibility";
import { PhilHealthClaimHandler } from "../philhealth/philhealth-claim-handler";
import { philhealthGatewayProvider } from "../philhealth/gateway";
import { ReferenceLabSendOutHandler, referenceLabGatewayProvider } from "../reference-lab/gateway";
import { bullMqIntegrationQueue, IntegrationWorkerRunner } from "./bullmq";
import { IntegrationExchangeProcessor } from "./exchange-processor";
import { EXCHANGE_HANDLERS, INTEGRATION_QUEUE, type IntegrationQueue } from "./exchange-types";

export interface IntegrationWorkerModuleOptions {
  /** The PhilHealth eClaims adapter (defaults to the unconfigured one). */
  philhealthGateway?: Provider;
  /** The PhilHealth eligibility adapter (defaults to the unconfigured one). */
  philhealthEligibilityGateway?: Provider;
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
    const missing = await this.processor.unavailableKeyIds();
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
    return {
      module: IntegrationWorkerModule,
      imports: [AuditModule],
      providers: [
        IntegrationExchangeProcessor,
        options.philhealthGateway ?? philhealthGatewayProvider,
        PhilHealthClaimHandler,
        options.philhealthEligibilityGateway ?? philhealthEligibilityGatewayProvider,
        PhilHealthEligibilityHandler,
        options.dohGateway ?? dohGatewayProvider,
        DohCaseReportHandler,
        options.referenceLabGateway ?? referenceLabGatewayProvider,
        ReferenceLabSendOutHandler,
        // One handler per system + operation.
        {
          provide: EXCHANGE_HANDLERS,
          inject: [PhilHealthClaimHandler, PhilHealthEligibilityHandler, DohCaseReportHandler, ReferenceLabSendOutHandler],
          useFactory: (
            claims: PhilHealthClaimHandler,
            eligibility: PhilHealthEligibilityHandler,
            doh: DohCaseReportHandler,
            referenceLab: ReferenceLabSendOutHandler,
          ) => [claims, eligibility, doh, referenceLab],
        },
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
