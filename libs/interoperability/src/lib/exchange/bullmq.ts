import { Logger, type OnModuleDestroy, type Provider } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import type { IntegrationExchangeProcessor } from "./exchange-processor";
import { INTEGRATION_QUEUE, type IntegrationQueue } from "./exchange-types";

export const INTEGRATION_QUEUE_NAME = "integrations";
const RECONCILE_INTERVAL_MS = 5 * 60_000;
export const INTEGRATION_JOB_ATTEMPTS = 5;

function connect(redisUrl: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export class BullMqIntegrationQueue implements IntegrationQueue, OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.connection = connect(redisUrl);
    this.queue = new Queue(INTEGRATION_QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(exchangeId: string): Promise<void> {
    await this.queue.add(
      "send",
      { exchangeId },
      {
        // jobId dedupes while a job exists; finished jobs are removed so a stranded exchange can be queued again.
        jobId: exchangeId,
        attempts: INTEGRATION_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

/** The API's and the worker's queue: BullMQ on REDIS_URL. */
export const bullMqIntegrationQueue: Provider = {
  provide: INTEGRATION_QUEUE,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new BullMqIntegrationQueue(config.REDIS_URL),
};

/** Consumes the integration queue (retry with backoff; the last attempt records the failure) and recovers stranded exchanges. */
export class IntegrationWorkerRunner {
  private readonly logger = new Logger(IntegrationWorkerRunner.name);
  private worker?: Worker;
  private connection?: IORedis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redisUrl: string,
    private readonly processor: IntegrationExchangeProcessor,
    private readonly queue: IntegrationQueue,
  ) {}

  start(concurrency = 2): void {
    this.connection = connect(this.redisUrl);
    this.worker = new Worker(
      INTEGRATION_QUEUE_NAME,
      // A RetryableExchangeError thrown by the processor hands the retry to BullMQ.
      (job) => this.processor.process(String(job.data.exchangeId), { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) }),
      { connection: this.connection, concurrency },
    );
    this.worker.on("failed", (job, error) => this.logger.warn(`Job ${job?.id} attempt ${job?.attemptsMade} failed: ${error.message}`));
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.logger.log(`Integration worker started (concurrency ${concurrency})`);
  }

  async reconcile(): Promise<void> {
    try {
      const ids = await this.processor.findStranded();
      for (const id of ids) await this.queue.enqueue(id);
      if (ids.length) this.logger.log(`Re-enqueued ${ids.length} stranded exchange(s)`);
    } catch (error) {
      this.logger.error(`Reconciliation failed: ${String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
