import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { asPlatform, DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";
import { CrmService } from "./crm.service";

const MINUTE_MS = 60_000;

/**
 * Sends approved outreach campaigns whose time has come, once a minute (docs/domains/crm.md). Safe on several API
 * instances: one runner holds an advisory lock, and every patient and channel is recorded once per campaign.
 */
@Injectable()
export class CrmCampaignRuns implements OnApplicationShutdown {
  private readonly logger = new Logger(CrmCampaignRuns.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crm: CrmService,
  ) {}

  start(intervalMs = MINUTE_MS): void {
    this.timer ??= setInterval(() => asPlatform("outreach campaign runs", () => void this.tick()), intervalMs);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass, for tests and the timer; null when another instance holds the lock. */
  async tick(now = new Date()): Promise<{ campaigns: number; deliveries: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.db.transaction(async (tx) => {
        const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('crm-campaign-runs')) AS locked`);
        if (!lock.rows[0]?.locked) return null;
        return this.crm.sendDue(now);
      });
    } catch (error) {
      this.logger.error({ event: "crm.campaign_run_failed", message: String(error) });
      return null;
    } finally {
      this.running = false;
    }
  }
}
