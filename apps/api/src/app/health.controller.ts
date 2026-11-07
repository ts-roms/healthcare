import { resolve } from "node:path";
import { Controller, Get, Inject, Logger, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import {
  APP_CONFIG,
  type AppConfig,
  asPlatform,
  DATABASE,
  DATABASE_POOL,
  type Database,
  cachedHealthReport,
  type DependencyState,
  healthAnswer,
  healthDetailsVisible,
  type HealthReport,
  healthStatusCode,
  pendingMigrations,
  Public,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { sql } from "drizzle-orm";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

/** Object storage is probed at most once a minute (DocumentsService.probeStorage). */
const STORAGE_PROBE_INTERVAL_MS = 60_000;

@ApiTags("health")
@Controller({ path: "health", version: "1" })
@SkipThrottle()
export class HealthController {
  private storageProbe: { at: number; state: DependencyState } | undefined;
  private readonly logger = new Logger("Health");
  private readonly report: () => Promise<HealthReport>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly documents: DocumentsService,
    private readonly redis: RedisThrottlerStorage,
  ) {
    this.report = cachedHealthReport(
      [
        { name: "database", required: true, probe: () => asPlatform("readiness check", async () => this.db.execute(sql`SELECT 1`)).then(() => "ok" as const) },
        { name: "redis", required: false, probe: async () => ((await this.redis.ping()) ? "ok" : "unreachable") },
        { name: "objectStorage", required: false, probe: () => this.probeStorage() },
        // A migration this build ships is not applied yet (the migrate service has not finished, ADR-0016): not ready.
        { name: "schema", required: true, probe: () => this.probeSchema() },
        // Unconfigured: uploads are accepted as "not scanned" (docs/domains/documents.md); unreachable: uploads are refused.
        { name: "malwareScanner", required: false, probe: () => this.documents.probeScanner() },
      ],
      this.config.HEALTH_CACHE_MS,
    );
  }

  /** Liveness: the process is up. */
  @Get("live")
  @Public()
  live() {
    return { status: "ok" };
  }

  /**
   * Readiness (docs/architecture/observability.md): the database is required (503 without it); Redis and object storage
   * are reported — without them the API serves degraded (rate limits let through, uploads and archives fail) but stays
   * on routing, so one of them being down does not take the whole API offline.
   */
  @Get("ready")
  @Public()
  async ready(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Checked at most every few seconds (cachedHealthReport): public and unthrottled, so probes cannot be multiplied
    // into database, Redis and scanner connections. The details go only to monitoring (healthDetailsVisible).
    const report = await this.report();
    res.status(healthStatusCode(report));
    return healthAnswer(report, healthDetailsVisible(this.config, req.headers["x-health-token"]));
  }

  private async probeSchema(): Promise<DependencyState> {
    const pending = await asPlatform("readiness check of the schema", () => pendingMigrations(this.pool, resolve(this.config.MIGRATIONS_DIR)));
    if (pending === null) return "unconfigured";
    if (pending.length === 0) return "ok";
    this.logger.warn({ event: "db.schema_behind", pending: pending.length, first: pending[0] });
    return "behind";
  }

  private async probeStorage(): Promise<DependencyState> {
    // "Without credentials, uploads and archived reports fail" (railway.md): no access key means storage is not set up.
    if (!this.config.S3_ACCESS_KEY_ID) return "unconfigured";
    const now = Date.now();
    if (this.storageProbe && now - this.storageProbe.at < STORAGE_PROBE_INTERVAL_MS) return this.storageProbe.state;
    const state: DependencyState = await this.documents.probeStorage();
    this.storageProbe = { at: now, state };
    return state;
  }
}
