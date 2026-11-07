import { createTestApp, TEST_REDIS_URL, type TestContext } from "./harness";

/**
 * Health endpoints (docs/architecture/observability.md): `/live` says the process is up; `/ready` reports each
 * dependency — the database is required, Redis and object storage only degrade the answer, so one of them being down
 * does not take the API off routing. Both are public and unthrottled; neither is in the access log.
 */
describe("health", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix: "health-test:" } });
  });
  afterAll(() => ctx.close());

  it("is live, and ready with the database and Redis reachable and no object storage credentials", async () => {
    await ctx.http().get("/api/v1/health/live").expect(200, { status: "ok" });
    const { body, headers } = await ctx.http().get("/api/v1/health/ready").expect(200);
    expect(body).toEqual({
      status: "ok",
      checks: { database: "ok", redis: "ok", schema: "ok", objectStorage: "unconfigured", malwareScanner: "unconfigured" },
    });
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives the details only to monitoring when a details token is set: everyone else gets the status alone", async () => {
    const token = "monitoring-".padEnd(40, "x");
    const guarded = await createTestApp({ rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix: "health-test:" } }, { HEALTH_DETAILS_TOKEN: token });
    try {
      expect((await guarded.http().get("/api/v1/health/ready").expect(200)).body).toEqual({ status: "ok" });
      expect((await guarded.http().get("/api/v1/health/ready").set("x-health-token", "wrong").expect(200)).body).toEqual({ status: "ok" });
      const detailed = await guarded.http().get("/api/v1/health/ready").set("x-health-token", token).expect(200);
      expect(detailed.body).toMatchObject({ status: "ok", checks: { database: "ok", malwareScanner: "unconfigured" } });
    } finally {
      await guarded.close();
    }
  });

  it("is not ready while the database lacks a migration this build ships, and ready again once it is applied", async () => {
    const last = (await ctx.pool.query<{ name: string }>("SELECT name FROM schema_migration ORDER BY name DESC LIMIT 1")).rows[0]!.name;
    const row = (await ctx.pool.query("SELECT checksum, applied_at FROM schema_migration WHERE name = $1", [last])).rows[0];
    await ctx.pool.query("DELETE FROM schema_migration WHERE name = $1", [last]);
    try {
      const behind = await ctx.http().get("/api/v1/health/ready").expect(503);
      expect(behind.body).toMatchObject({ status: "unavailable", checks: { schema: "behind" } });
    } finally {
      await ctx.pool.query("INSERT INTO schema_migration (name, checksum, applied_at) VALUES ($1, $2, $3)", [last, row.checksum, row.applied_at]);
    }
    expect((await ctx.http().get("/api/v1/health/ready").expect(200)).body.checks.schema).toBe("ok");
  });

  it("answers 200 degraded, not 503, while Redis is unreachable", async () => {
    const offline = await createTestApp({ rateLimitStorage: { redisUrl: "redis://127.0.0.1:1", keyPrefix: "health-test:" } });
    try {
      const { body } = await offline.http().get("/api/v1/health/ready").expect(200);
      expect(body).toEqual({
        status: "degraded",
        checks: { database: "ok", redis: "unreachable", schema: "ok", objectStorage: "unconfigured", malwareScanner: "unconfigured" },
      });
    } finally {
      await offline.close();
    }
  });
});
