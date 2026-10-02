import type { INestApplicationContext } from "@nestjs/common";
import { type AppConfig, DATABASE, type Database, type HealthCheck, startHealthServer } from "@healthcare/core";
import { sql } from "drizzle-orm";
import IORedis from "ioredis";

/**
 * `GET /live` and `/ready` on `HEALTH_PORT` (docs/architecture/observability.md): the database is required, Redis is
 * reported (the queue consumer cannot work without it, but BullMQ reconnects on its own). Nothing else is served.
 */
export function startWorkerHealth(app: INestApplicationContext, config: AppConfig): void {
  if (!config.HEALTH_PORT) return;
  const db = app.get<Database>(DATABASE);
  const redis = new IORedis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 250 });
  redis.on("error", () => undefined);
  redis.connect().catch(() => undefined);
  const checks: HealthCheck[] = [
    { name: "database", required: true, probe: () => db.execute(sql`SELECT 1`).then(() => "ok" as const) },
    { name: "redis", required: false, probe: () => redis.ping().then((answer) => (answer === "PONG" ? "ok" : "unreachable")) },
  ];
  const server = startHealthServer(config.HEALTH_PORT, checks);
  const stop = () => {
    server.close();
    redis.disconnect();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
