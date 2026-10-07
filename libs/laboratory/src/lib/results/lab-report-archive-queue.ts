import { Logger, type OnApplicationShutdown, type OnModuleDestroy, type Provider } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, asPlatform } from "@healthcare/core";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { LAB_REPORT_ARCHIVE_QUEUE, LabReportArchive, type LabReportArchiveQueue } from "./lab-report-archive";
import { observeQueueDepth, type QueueDepth, recordJobFailure, recordReconcileFailure } from "@healthcare/core";

export const LAB_REPORT_ARCHIVE_QUEUE_NAME = "lab-report-archive";
const JOB_ATTEMPTS = 5;
const RECONCILE_INTERVAL_MS = 5 * 60_000;

function connect(redisUrl: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export class BullMqLabReportArchiveQueue implements LabReportArchiveQueue, OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.connection = connect(redisUrl);
    this.queue = new Queue(LAB_REPORT_ARCHIVE_QUEUE_NAME, { connection: this.connection });
    observeQueueDepth(LAB_REPORT_ARCHIVE_QUEUE_NAME, () => this.queue.getJobCounts("waiting", "delayed", "failed") as Promise<QueueDepth>);
  }

  async enqueue(archiveId: string): Promise<void> {
    await this.queue.add(
      "archive",
      { archiveId },
      {
        // jobId dedupes while a job exists; finished jobs are removed so a stranded archive can be queued again.
        jobId: archiveId,
        attempts: JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
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

/** BullMQ on REDIS_URL (the default queue). */
export const bullMqLabReportArchiveQueue: Provider = {
  provide: LAB_REPORT_ARCHIVE_QUEUE,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new BullMqLabReportArchiveQueue(config.REDIS_URL),
};

/**
 * Consumes the archive queue (rendering and storing reports, one or two at a time so request handling is not
 * starved) and periodically re-queues pending archives whose job was lost. Started explicitly by the process that
 * hosts it (apps/api main.ts), not in tests.
 */
export class LabReportArchiveWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(LabReportArchiveWorker.name);
  private worker?: Worker;
  private connection?: IORedis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redisUrl: string,
    private readonly archive: LabReportArchive,
    private readonly queue: LabReportArchiveQueue,
  ) {}

  start(concurrency = 2): void {
    if (this.worker) return;
    this.connection = connect(this.redisUrl);
    this.worker = new Worker(
      LAB_REPORT_ARCHIVE_QUEUE_NAME,
      // Throwing hands the retry and backoff schedule to BullMQ; an archive still pending after the job's attempts is
      // re-queued by reconcile until LabReportArchive parks it as failed.
      (job) => asPlatform("laboratory report archive", () => this.archive.process(String(job.data.archiveId))),
      { connection: this.connection, concurrency },
    );
    this.worker.on("failed", (job, error) =>
      this.logger.warn({ event: "queue.job_failed", queue: LAB_REPORT_ARCHIVE_QUEUE_NAME, jobId: job?.id, attempt: job?.attemptsMade, message: error.message }),
    );
    this.worker.on("failed", () => recordJobFailure(LAB_REPORT_ARCHIVE_QUEUE_NAME));
    this.timer = setInterval(() => asPlatform("laboratory report archive reconciliation", () => void this.reconcile()), RECONCILE_INTERVAL_MS);
    this.logger.log(`Laboratory report archive worker started (concurrency ${concurrency})`);
  }

  async reconcile(): Promise<void> {
    try {
      const ids = await this.archive.findStranded();
      for (const id of ids) await this.queue.enqueue(id);
      if (ids.length) this.logger.log(`Re-enqueued ${ids.length} pending report archive(s)`);
    } catch (error) {
      this.logger.error({ event: "queue.reconcile_failed", queue: LAB_REPORT_ARCHIVE_QUEUE_NAME, message: String(error) });
      recordReconcileFailure(LAB_REPORT_ARCHIVE_QUEUE_NAME);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
