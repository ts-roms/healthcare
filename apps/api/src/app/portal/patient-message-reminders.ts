import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { asPlatform, DATABASE, type Database, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { PatientMessageService } from "@healthcare/patient";
import { sql } from "drizzle-orm";
import { PatientMessageNotices } from "./patient-message-notices";

const HOUR_MS = 3_600_000;

/**
 * Hourly: MyHealth conversations that wait for the clinic past the response target of their topic
 * (docs/domains/patient-messaging.md) get one in-app `portal.message-overdue` per breach to the people a new message
 * would be routed to. A later reply clears the target; the next patient message starts a new one and may be reminded
 * again. Safe on several API instances (advisory lock; idempotency keys make every message once-only).
 */
@Injectable()
export class PatientMessageReminders implements OnApplicationShutdown {
  private readonly logger = new Logger(PatientMessageReminders.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly messages: PatientMessageService,
    private readonly notices: PatientMessageNotices,
    private readonly notifications: NotificationService,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("MyHealth message reminders", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Patient message reminders failed: ${String(error)}`);
    }
  }

  /** Sends what is due now. Returns how many conversations were reminded of. */
  async run(now = new Date()): Promise<number> {
    const locked = await this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('patient-message-reminders')) AS locked`);
      if (!lock.rows[0]?.locked) return null;
      return this.messages.overdueToRemind(now);
    });
    if (!locked) return 0;
    for (const thread of locked) {
      const recipients = await this.notices.recipientsOf(thread.organizationId, thread.id, thread.facilityId);
      const actor = systemActor(thread.organizationId, thread.facilityId, "patient-message-reminder");
      for (const person of recipients) {
        await this.notifications.send(actor, {
          recipient: { type: "user", userId: person.id },
          channel: "in_app",
          templateKey: "portal.message-overdue",
          variables: { threadId: thread.id },
          // Once per breach and recipient: the target instant changes only when the patient writes again after a reply.
          idempotencyKey: `message-overdue:${thread.id}:${thread.responseDueAt.toISOString()}:${person.id}`,
        });
      }
      await this.messages.markOverdueNotified(thread.id, now);
    }
    return locked.length;
  }
}
