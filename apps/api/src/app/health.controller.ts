import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  type DependencyState,
  type HealthCheck,
  healthReport,
  healthStatusCode,
  Public,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { sql } from "drizzle-orm";
import type { Response } from "express";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

/** Object storage is probed at most once a minute (DocumentsService.probeStorage). */
const STORAGE_PROBE_INTERVAL_MS = 60_000;

@ApiTags("health")
@Controller({ path: "health", version: "1" })
@SkipThrottle()
export class HealthController {
  private storageProbe: { at: number; state: DependencyState } | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly documents: DocumentsService,
    private readonly redis: RedisThrottlerStorage,
  ) {}

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
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: HealthCheck[] = [
      { name: "database", required: true, probe: () => this.db.execute(sql`SELECT 1`).then(() => "ok" as const) },
      { name: "redis", required: false, probe: async () => ((await this.redis.ping()) ? "ok" : "unreachable") },
      { name: "objectStorage", required: false, probe: () => this.probeStorage() },
    ];
    const report = await healthReport(checks);
    res.status(healthStatusCode(report));
    return report;
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
