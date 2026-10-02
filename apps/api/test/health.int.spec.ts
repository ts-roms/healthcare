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
    expect(body).toEqual({ status: "ok", checks: { database: "ok", redis: "ok", objectStorage: "unconfigured", malwareScanner: "unconfigured" } });
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers 200 degraded, not 503, while Redis is unreachable", async () => {
    const offline = await createTestApp({ rateLimitStorage: { redisUrl: "redis://127.0.0.1:1", keyPrefix: "health-test:" } });
    try {
      const { body } = await offline.http().get("/api/v1/health/ready").expect(200);
      expect(body).toEqual({
        status: "degraded",
        checks: { database: "ok", redis: "unreachable", objectStorage: "unconfigured", malwareScanner: "unconfigured" },
      });
    } finally {
      await offline.close();
    }
  });
});
