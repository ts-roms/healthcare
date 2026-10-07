import { Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import type { NotificationDispatcher } from "./notification.dispatcher";
import type { NotificationQueue } from "./ports";
import { asPlatform, observeQueueDepth, type QueueDepth, recordJobFailure, recordReconcileFailure } from "@healthcare/core";

export const NOTIFICATION_QUEUE_NAME = "notifications";
const RECONCILE_INTERVAL_MS = 60_000;

function connect(redisUrl: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export class BullMqNotificationQueue implements NotificationQueue, OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.connection = connect(redisUrl);
    this.queue = new Queue(NOTIFICATION_QUEUE_NAME, { connection: this.connection });
    observeQueueDepth(NOTIFICATION_QUEUE_NAME, () => this.queue.getJobCounts("waiting", "delayed", "failed") as Promise<QueueDepth>);
  }

  async enqueue(notificationId: string, delayMs = 0): Promise<void> {
    await this.queue.add(
      "deliver",
      { notificationId },
      {
        // jobId dedupes: a notification is never queued twice at the same time.
        jobId: notificationId,
        delay: delayMs,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

/** Consumes the notification queue and periodically recovers stranded notifications. */
export class NotificationWorkerRunner {
  private readonly logger = new Logger(NotificationWorkerRunner.name);
  private worker?: Worker;
  private connection?: IORedis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redisUrl: string,
    private readonly dispatcher: NotificationDispatcher,
    private readonly queue: NotificationQueue,
  ) {}

  start(concurrency = 5): void {
    this.connection = connect(this.redisUrl);
    this.worker = new Worker(
      NOTIFICATION_QUEUE_NAME,
      async (job) => {
        // Jobs of every organization: the platform scope (row-level security, migration 0111).
        const outcome = await asPlatform("notification delivery", () => this.dispatcher.dispatch(String(job.data.notificationId)));
        // Throwing hands the retry and backoff schedule to BullMQ.
        if (outcome === "retry") throw new Error("Delivery failed; will retry");
        return outcome;
      },
      { connection: this.connection, concurrency },
    );
    this.worker.on("failed", (job, error) =>
      this.logger.warn({ event: "queue.job_failed", queue: NOTIFICATION_QUEUE_NAME, jobId: job?.id, message: error.message }),
    );
    this.worker.on("failed", () => recordJobFailure(NOTIFICATION_QUEUE_NAME));
    this.timer = setInterval(() => asPlatform("notification queue reconciliation", () => void this.reconcile()), RECONCILE_INTERVAL_MS);
    this.logger.log(`Notification worker started (concurrency ${concurrency})`);
  }

  async reconcile(): Promise<void> {
    try {
      const ids = await this.dispatcher.findStranded();
      for (const id of ids) await this.queue.enqueue(id);
      if (ids.length) this.logger.log(`Re-enqueued ${ids.length} stranded notification(s)`);
    } catch (error) {
      this.logger.error({ event: "queue.reconcile_failed", queue: NOTIFICATION_QUEUE_NAME, message: String(error) });
      recordReconcileFailure(NOTIFICATION_QUEUE_NAME);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
