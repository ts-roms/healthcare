import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";
import { ManagementReportService } from "./management-report.service";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Produces scheduled management reports once an hour (docs/architecture/management-dashboard.md): every active
 * schedule whose week or month has ended gets its period produced once; interrupted and failed runs are tried again.
 * Safe on several API instances: the tick runs under an advisory lock, and each period is claimed through the run
 * table's unique key.
 */
@Injectable()
export class ManagementReportRuns implements OnApplicationShutdown {
  private readonly logger = new Logger(ManagementReportRuns.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reports: ManagementReportService,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass, for tests and the timer. Returns what was produced; nothing when another instance holds the lock. */
  async tick(now = new Date()): Promise<{ produced: number; resumed: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.db.transaction(async (tx) => {
        const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('management-report-runs')) AS locked`);
        if (!lock.rows[0]?.locked) return null;
        return this.reports.produceDue(now);
      });
    } catch (error) {
      this.logger.error({ event: "management_report.tick_failed", message: String(error) });
      return null;
    } finally {
      this.running = false;
    }
  }
}
