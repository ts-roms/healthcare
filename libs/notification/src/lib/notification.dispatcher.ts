import { Inject, Injectable, Logger } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { notification, notificationAttempt } from "./notification.schema";
import { CHANNEL_SENDERS, type ChannelSender } from "./ports";
import { findTemplate, withoutSecrets } from "./templates";

export type DispatchOutcome = "sent" | "retry" | "failed" | "skipped";

const STALE_SENDING_MINUTES = 15;
const RECONCILE_AFTER_MINUTES = 2;

/**
 * Delivers one notification: atomically claims it, records the attempt,
 * renders the template and calls the channel adapter. Delivery is
 * at-least-once; a crash mid-send can cause a duplicate after reconciliation.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CHANNEL_SENDERS) private readonly senders: ChannelSender[],
  ) {}

  async dispatch(notificationId: string): Promise<DispatchOutcome> {
    const [claimed] = await this.db
      .update(notification)
      .set({ status: "sending", attemptCount: sql`${notification.attemptCount} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(notification.id, notificationId),
          eq(notification.status, "queued"),
          or(isNull(notification.scheduledFor), lte(notification.scheduledFor, new Date())),
          sql`${notification.attemptCount} < ${notification.maxAttempts}`,
        ),
      )
      .returning();
    if (!claimed) return "skipped";

    const [attempt] = await this.db
      .insert(notificationAttempt)
      .values({ notificationId, attemptNumber: claimed.attemptCount })
      .returning({ id: notificationAttempt.id });

    try {
      const template = findTemplate(claimed.templateKey);
      if (!template || template.version !== claimed.templateVersion)
        throw new PermanentDeliveryError(`Template ${claimed.templateKey}@v${claimed.templateVersion} is not available`);
      if (claimed.channel === "in_app") throw new PermanentDeliveryError("In-app notifications are not dispatched");
      const sender = this.senders.find((s) => s.channel === claimed.channel);
      if (!sender) throw new PermanentDeliveryError(`No sender configured for ${claimed.channel}`);
      if (!claimed.destination) throw new PermanentDeliveryError("No destination");

      const result = await sender.send(claimed.destination, template.render(claimed.variables), { notificationId });
      await this.db.transaction(async (tx) => {
        await tx
          .update(notification)
          .set({
            status: "sent",
            variables: withoutSecrets(template, claimed.variables),
            sentAt: new Date(),
            provider: result.provider,
            providerMessageId: result.providerMessageId ?? null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(notification.id, notificationId));
        if (attempt)
          await tx
            .update(notificationAttempt)
            .set({ finishedAt: new Date(), outcome: "sent", provider: result.provider })
            .where(eq(notificationAttempt.id, attempt.id));
      });
      return "sent";
    } catch (error) {
      const failedTemplate = findTemplate(claimed.templateKey);
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof PermanentDeliveryError || claimed.attemptCount >= claimed.maxAttempts;
      await this.db.transaction(async (tx) => {
        await tx
          .update(notification)
          .set(
            permanent
              ? {
                  status: "failed",
                  failedAt: new Date(),
                  lastError: message,
                  updatedAt: new Date(),
                  ...(failedTemplate ? { variables: withoutSecrets(failedTemplate, claimed.variables) } : {}),
                }
              : { status: "queued", lastError: message, updatedAt: new Date() },
          )
          .where(eq(notification.id, notificationId));
        if (attempt)
          await tx
            .update(notificationAttempt)
            .set({ finishedAt: new Date(), outcome: "failed", error: message.slice(0, 1000) })
            .where(eq(notificationAttempt.id, attempt.id));
      });
      this.logger.warn(`Notification ${notificationId} attempt ${claimed.attemptCount} failed${permanent ? " permanently" : ""}: ${message}`);
      return permanent ? "failed" : "retry";
    }
  }

  /**
   * Finds notifications that should be in the queue but may not be (enqueue
   * failed, worker crashed mid-send) and returns their ids for re-enqueueing.
   */
  async findStranded(): Promise<string[]> {
    await this.db
      .update(notification)
      .set({ status: "queued", updatedAt: new Date(), lastError: "Recovered from interrupted delivery" })
      .where(and(eq(notification.status, "sending"), lte(notification.updatedAt, minutesAgo(STALE_SENDING_MINUTES))));
    const rows = await this.db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.status, "queued"),
          lte(notification.updatedAt, minutesAgo(RECONCILE_AFTER_MINUTES)),
          or(isNull(notification.scheduledFor), lte(notification.scheduledFor, new Date())),
        ),
      )
      .limit(500);
    return rows.map((r) => r.id);
  }
}

export class PermanentDeliveryError extends Error {}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}
