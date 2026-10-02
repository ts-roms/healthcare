import { type INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import IORedis from "ioredis";
import type { Server, ServerOptions } from "socket.io";

/** Where instances share their rooms (docs/deployment/railway.md, "Running more than one API instance"). */
export interface RealtimeRedisOptions {
  redisUrl: string;
  /** Channel prefix, so tests do not hear each other. */
  keyPrefix?: string;
}

const WARNING_INTERVAL_MS = 60_000;

/**
 * The adapter publishes and subscribes without handling the promises; while Redis is down those would surface as
 * unhandled rejections. Each failure is swallowed here (the adapter's error listener still warns once a minute).
 */
class QuietRedis extends IORedis {}
for (const name of ["publish", "subscribe", "psubscribe", "unsubscribe", "punsubscribe"] as const) {
  const original = (IORedis.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
  (QuietRedis.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = function (this: IORedis, ...args: unknown[]) {
    const result = original.apply(this, args);
    return result instanceof Promise ? result.catch(() => 0) : result;
  };
}

/**
 * Socket.IO with the same CORS origins as the REST API and, with Redis, rooms shared by every API instance: an event
 * processed by one instance's outbox relay reaches the browsers connected to the others. Clients connect websocket-only,
 * so no sticky sessions are needed. While Redis is unreachable each instance delivers to its own sockets and the staff
 * app's 15-second poll covers the rest (`realtime.redis_unreachable`, at most once a minute).
 */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly logger = new Logger(ConfiguredIoAdapter.name);
  private lastWarningAt = 0;
  private clients: IORedis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
    private readonly redis?: RealtimeRedisOptions,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, { ...options, cors: { origin: this.corsOrigins, credentials: true } } as ServerOptions) as Server;
    if (this.redis) {
      const [pub, sub] = [this.connect(), this.connect()];
      this.clients = [pub, sub];
      server.adapter(createAdapter(pub, sub, { key: this.redis.keyPrefix ?? "realtime" }));
    }
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    for (const client of this.clients) client.disconnect();
    this.clients = [];
  }

  private connect(): IORedis {
    // Connects at once; the adapter subscribes immediately and the offline queue holds that until the connection is up.
    // A command never waits more than a second and is not retried, so a dead Redis cannot hold a request; reconnection
    // is ioredis's own.
    const client = new QuietRedis(this.redis!.redisUrl, { maxRetriesPerRequest: 0, commandTimeout: 1_000 });
    client.on("error", (error: Error) => this.warn(error));
    return client;
  }

  private warn(error: Error): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_INTERVAL_MS) return;
    this.lastWarningAt = now;
    this.logger.warn({ event: "realtime.redis_unreachable", message: `Live updates reach only this instance while Redis is unreachable: ${error.message}` });
  }
}
