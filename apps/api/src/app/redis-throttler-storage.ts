import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import IORedis from "ioredis";

/**
 * Rate-limit counters shared by every API instance (docs/security/access-control.md): one Redis script per check counts
 * the hit in a fixed window of `ttl` and, once over the limit, blocks the key for `blockDuration`. Keys live under
 * `<prefix><key>` and always expire. When Redis cannot be reached the request is let through (account lockout, kept in
 * PostgreSQL, still applies) and a warning is logged at most once a minute.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) redis.call('PEXPIRE', KEYS[1], ttl) end
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then return {hits, ttl, 1, blockTtl} end
if hits > limit then
  if block > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', block)
    return {hits, ttl, 1, block}
  end
  return {hits, ttl, 1, ttl}
end
return {hits, ttl, 0, 0}
`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

const COMMAND_TIMEOUT_MS = 250;
const WARNING_INTERVAL_MS = 60_000;

/** The two calls made on the connection (so tests can pass a fake). */
interface RedisLike {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  disconnect(): void;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarningAt = 0;
  private readonly redis: RedisLike;

  constructor(
    redisUrlOrClient: string | RedisLike,
    private readonly prefix = "throttle:",
  ) {
    this.redis =
      typeof redisUrlOrClient === "string"
        ? new IORedis(redisUrlOrClient, {
            // A check must never hold a request: no queueing while disconnected, no retries, a short command timeout.
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
            commandTimeout: COMMAND_TIMEOUT_MS,
            lazyConnect: true,
          })
        : redisUrlOrClient;
    if (typeof redisUrlOrClient === "string") {
      // ioredis reports connection problems as events; without a listener they would be unhandled errors.
      (this.redis as IORedis).on("error", (error: Error) => this.warn(error));
      (this.redis as IORedis).connect().catch((error: Error) => this.warn(error));
    }
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [totalHits, ttlLeft, blocked, blockLeft] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        hitKey,
        `${hitKey}:blocked`,
        String(Math.max(1, Math.round(ttl))),
        String(limit),
        String(Math.max(0, Math.round(blockDuration))),
      )) as [number, number, number, number];
      return {
        totalHits,
        timeToExpire: Math.ceil(ttlLeft / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: blocked === 1 ? Math.ceil(blockLeft / 1000) : 0,
      };
    } catch (error) {
      this.warn(error as Error);
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }

  private warn(error: Error): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_INTERVAL_MS) return;
    this.lastWarningAt = now;
    this.logger.warn(`Rate limiting is off while Redis is unreachable: ${error.message}`);
  }
}
