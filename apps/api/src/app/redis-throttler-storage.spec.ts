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

  disconnect(): void {
    /* nothing to close */
  }

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
