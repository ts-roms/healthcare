import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { asPlatform, DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";

const HOUR_MS = 3_600_000;
/** Expired records are kept this long after they expire (a retry just after expiry still finds its row), then removed. */
const GRACE_HOURS = 24;
const BATCH = 5_000;

/**
 * Removes expired idempotency records (docs/security-audit, VR-15). A record keeps the response of an unsafe request,
 * which can hold patient data, so it must not outlive its window. Hourly, in batches; safe on several API instances
 * (advisory lock).
 */
@Injectable()
export class IdempotencyPurge implements OnApplicationShutdown {
  private readonly logger = new Logger(IdempotencyPurge.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("idempotency record purge", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      const removed = await this.run();
      if (removed > 0) this.logger.log({ event: "idempotency.purged", removed });
    } catch (error) {
      this.logger.error(`Idempotency purge failed: ${String(error)}`);
    }
  }

  /** Deletes records expired more than the grace period ago; returns how many. */
  async run(now = new Date()): Promise<number> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('idempotency-purge')) AS locked`);
      if (!lock.rows[0]?.locked) return 0;
      let total = 0;
      for (;;) {
        const result = await tx.execute(sql`
          DELETE FROM idempotency_record
          WHERE ctid IN (
            SELECT ctid FROM idempotency_record
            WHERE expires_at < ${now}::timestamptz - make_interval(hours => ${GRACE_HOURS})
            LIMIT ${BATCH}
          )`);
        total += result.rowCount ?? 0;
        if ((result.rowCount ?? 0) < BATCH) return total;
      }
    });
  }
}
