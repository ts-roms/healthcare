import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { asPlatform, DATABASE, type Database, DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { CrmService } from "@healthcare/crm";
import { NotificationService } from "@healthcare/notification";
import { sql } from "drizzle-orm";

const APPROVE_PERMISSION = "crm.campaign.approve";
const HOUR_MS = 3_600_000;

/**
 * Outreach approval nudges (docs/domains/crm.md): the people who may approve campaigns are told in the app when one is
 * submitted (never the author or the one who submitted it) and the author when it is approved. The notices name the campaign
 * and point to it; nothing about a patient. One message per event and person (idempotency keys).
 */
@Injectable()
export class CrmApprovalNotices implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly crm: CrmService,
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("CrmCampaignSubmitted", "crm.notice-awaiting-approval", (event) => this.awaitingApproval(event));
    this.handlers.on("CrmCampaignApproved", "crm.notice-approved", (event) => this.approved(event));
  }

  /** The approvers of the organization, except the people who wrote and submitted the campaign. */
  async approversFor(organizationId: string, exclude: Array<string | null>): Promise<string[]> {
    const holders = await this.users.holdersOf(organizationId, APPROVE_PERMISSION, null);
    return holders.map((h) => h.id).filter((id) => !exclude.includes(id));
  }

  async tell(
    organizationId: string,
    userIds: string[],
    kind: "awaiting-approval" | "reminder" | "approved",
    campaignId: string,
    name: string,
    key: string,
  ): Promise<void> {
    const actor = systemActor(organizationId, null, "outreach-approval-notice");
    for (const userId of userIds) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId },
        channel: "in_app",
        templateKey: "outreach.campaign-notice",
        variables: { kind, campaignId, name: name.slice(0, 80) },
        idempotencyKey: `${key}:${userId}`,
      });
    }
  }

  private async awaitingApproval(event: DomainEventRecord): Promise<void> {
    const campaign = await this.crm.campaignForNotice(event.organizationId, event.aggregateId);
    if (!campaign) return;
    const approvers = await this.approversFor(campaign.organizationId, [campaign.createdBy, campaign.submittedBy]);
    await this.tell(campaign.organizationId, approvers, "awaiting-approval", campaign.id, campaign.name, `crm-awaiting:${event.id}`);
  }

  private async approved(event: DomainEventRecord): Promise<void> {
    const campaign = await this.crm.campaignForNotice(event.organizationId, event.aggregateId);
    if (!campaign) return;
    const people = [...new Set([campaign.createdBy, campaign.submittedBy].filter((id): id is string => Boolean(id)))];
    await this.tell(campaign.organizationId, people, "approved", campaign.id, campaign.name, `crm-approved:${event.id}`);
  }
}

/**
 * Hourly: a campaign still waiting for approval two days after it was submitted reminds its approvers once (in the app).
 * Safe on several API instances (advisory lock; the reminder is recorded on the campaign and the message is once-only).
 */
@Injectable()
export class CrmApprovalReminders implements OnApplicationShutdown {
  private readonly logger = new Logger(CrmApprovalReminders.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crm: CrmService,
    private readonly notices: CrmApprovalNotices,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("outreach approval reminders", () => void this.tick()), intervalMs);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Outreach approval reminders failed: ${String(error)}`);
    }
  }

  /** Reminds what is due now; returns how many campaigns were reminded about. */
  async run(now = new Date()): Promise<number> {
    const due = await this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('crm-approval-reminders')) AS locked`);
      if (!lock.rows[0]?.locked) return null;
      return this.crm.approvalRemindersDue(now);
    });
    if (!due) return 0;
    for (const campaign of due) {
      const approvers = await this.notices.approversFor(campaign.organizationId, [campaign.createdBy, campaign.submittedBy]);
      await this.notices.tell(campaign.organizationId, approvers, "reminder", campaign.id, campaign.name, `crm-reminder:${campaign.id}`);
      await this.crm.markApprovalReminded(campaign.id, now);
    }
    return due.length;
  }
}
