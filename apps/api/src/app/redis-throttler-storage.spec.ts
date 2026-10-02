import { RedisThrottlerStorage } from "./redis-throttler-storage";

/** A fake Redis that runs the same counting rules as the script, with a clock the test moves. */
class FakeRedis {
  now = 0;
  down = false;
  evals = 0;
  private readonly keys = new Map<string, { value: number; expiresAt: number }>();

  async eval(_script: string, _numKeys: number, hitKey: string, blockKey: string, ttl: string, limit: string, block: string): Promise<number[]> {
    this.evals += 1;
    if (this.down) throw new Error("connect ECONNREFUSED");
    const hits = this.incr(hitKey, Number(ttl));
    const ttlLeft = this.keys.get(hitKey)!.expiresAt - this.now;
    const blocked = this.keys.get(blockKey);
    if (blocked && blocked.expiresAt > this.now) return [hits, ttlLeft, 1, blocked.expiresAt - this.now];
    if (hits > Number(limit)) {
      if (Number(block) > 0) {
        this.keys.set(blockKey, { value: 1, expiresAt: this.now + Number(block) });
        return [hits, ttlLeft, 1, Number(block)];
      }
      return [hits, ttlLeft, 1, ttlLeft];
    }
    return [hits, ttlLeft, 0, 0];
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (this.down) throw new Error("connect ECONNREFUSED");
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    hash.set(field, (hash.get(field) ?? 0) + increment);
    this.hashes.set(key, hash);
    return hash.get(field)!;
  }

  async pexpire(key: string, milliseconds: number): Promise<number> {
    this.expiries.set(key, this.now + milliseconds);
    return 1;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (this.down) throw new Error("connect ECONNREFUSED");
    return Object.fromEntries([...(this.hashes.get(key) ?? new Map())].map(([field, value]) => [field, String(value)]));
  }

  disconnect(): void {
    /* nothing to close */
  }

  readonly hashes = new Map<string, Map<string, number>>();
  readonly expiries = new Map<string, number>();

  private incr(key: string, ttl: number): number {
    const entry = this.keys.get(key);
    if (!entry || entry.expiresAt <= this.now) {
      this.keys.set(key, { value: 1, expiresAt: this.now + ttl });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }
}

describe("RedisThrottlerStorage", () => {
  let redis: FakeRedis;
  let storage: RedisThrottlerStorage;
  const hit = (key = "client-a") => storage.increment(key, 60_000, 3, 0, "default");

  beforeEach(() => {
    redis = new FakeRedis();
    storage = new RedisThrottlerStorage(redis, "test:");
  });

  it("counts hits within the window and blocks once over the limit", async () => {
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0, timeToExpire: 60 });
    await hit();
    expect(await hit()).toMatchObject({ totalHits: 3, isBlocked: false });
    expect(await hit()).toMatchObject({ totalHits: 4, isBlocked: true, timeToBlockExpire: 60 });
    expect(await hit("client-b")).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("starts a new window once the old one expires", async () => {
    for (let i = 0; i < 4; i += 1) await hit();
    redis.now = 60_000;
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("blocks for the block duration when one is given", async () => {
    const strict = () => storage.increment("client-c", 1_000, 1, 5_000, "login");
    await strict();
    expect(await strict()).toMatchObject({ isBlocked: true, timeToBlockExpire: 5 });
    redis.now = 2_000; // the hit window ended, the block has not
    expect(await strict()).toMatchObject({ isBlocked: true, timeToBlockExpire: 3 });
    redis.now = 5_000;
    expect(await strict()).toMatchObject({ isBlocked: false });
  });

  it("keeps throttlers and keys apart", async () => {
    await storage.increment("same", 60_000, 1, 0, "default");
    expect(await storage.increment("same", 60_000, 1, 0, "login")).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("counts refusals by route template and Asia/Manila day, kept 100 days", async () => {
    const lateEvening = new Date("2026-10-02T15:30:00Z"); // 23:30 in Manila
    await storage.recordRefusal("POST /api/v1/portal/auth/login", lateEvening);
    await storage.recordRefusal("POST /api/v1/portal/auth/login", lateEvening);
    await storage.recordRefusal("POST /api/v1/auth/login", new Date("2026-10-02T16:30:00Z")); // 00:30 the next Manila day
    expect(redis.expiries.get("test:refusals:2026-10-02")).toBe(100 * 24 * 60 * 60 * 1000);
    await expect(storage.refusals(2, new Date("2026-10-03T02:00:00Z"))).resolves.toEqual([
      { day: "2026-10-03", route: "POST /api/v1/auth/login", refusals: 1 },
      { day: "2026-10-02", route: "POST /api/v1/portal/auth/login", refusals: 2 },
    ]);
    await expect(storage.refusals(1, new Date("2026-10-03T02:00:00Z"))).resolves.toHaveLength(1);
  });

  it("only warns when a refusal cannot be counted", async () => {
    const warn = jest.spyOn(storage["logger"], "warn").mockImplementation(() => undefined);
    redis.down = true;
    await expect(storage.recordRefusal("POST /api/v1/auth/login")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("lets requests through while Redis is unreachable, warning at most once a minute", async () => {
    const warn = jest.spyOn(storage["logger"], "warn").mockImplementation(() => undefined);
    redis.down = true;
    for (let i = 0; i < 5; i += 1) expect(await hit()).toMatchObject({ totalHits: 0, isBlocked: false, timeToExpire: 60 });
    expect(redis.evals).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Rate limiting is off while Redis is unreachable");
    redis.down = false;
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
