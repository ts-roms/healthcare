import { randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { as, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, TEST_REDIS_URL, type TestContext } from "./harness";

/**
 * Shared rate limits (docs/security/access-control.md): every API instance counts the same client's requests in Redis,
 * so a client cannot multiply its allowance across replicas; while Redis is unreachable, requests are let through.
 * Needs a Redis at TEST_REDIS_URL (`pnpm dev:deps`; the CI job provides one).
 */
describe("shared rate limits", () => {
  const keyPrefix = `throttle-test-${randomBytes(4).toString("hex")}:`;
  let first: TestContext;
  let second: TestContext;
  let tenant: Tenant;
  let platformAdmin: string;
  let orgAdmin: string;

  const signIn = (ctx: TestContext) => ctx.http().post("/api/v1/auth/login").send({ email: "clerk@limits.ph", password: PASSWORD });

  beforeAll(async () => {
    const redis = new IORedis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
      await redis.ping();
    } catch (error) {
      throw new Error(`Redis is needed at ${TEST_REDIS_URL} (set TEST_REDIS_URL or run \`pnpm dev:deps\`): ${(error as Error).message}`);
    } finally {
      redis.disconnect();
    }
    // Two instances of the API over one database and one Redis, as two replicas would be. Each createTestApp resets
    // the schema, so the data is set up once both exist.
    first = await createTestApp({ disableRateLimit: false, rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix } });
    second = await createTestApp({ disableRateLimit: false, rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix } });
    tenant = await createTenant(first.pool, "limits-org");
    await createStaff(first.pool, tenant, "clerk@limits.ph", ["receptionist"]);
    // Signed in before the sign-in allowance is used up below; the tokens stay valid.
    await createStaff(first.pool, tenant, "platform@limits.ph", ["org_admin"], { platformAdmin: true });
    await createStaff(first.pool, tenant, "orgadmin@limits.ph", ["org_admin"]);
    platformAdmin = (await login(first, "platform@limits.ph")).accessToken;
    orgAdmin = (await login(first, "orgadmin@limits.ph")).accessToken;
  });
  afterAll(async () => {
    await first?.close();
    await second?.close();
  });

  it("counts one client's sign-in attempts across instances and refuses the eleventh", async () => {
    // Credential routes allow 10 a minute per client; every supertest request comes from the same address, and the two
    // administrator sign-ins in beforeAll already count.
    for (let i = 0; i < 4; i += 1) await signIn(first).expect(200);
    for (let i = 0; i < 4; i += 1) await signIn(second).expect(200);
    const refused = await signIn(first).expect(429);
    expect(refused.body.error.code).toBe("rate_limited");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    await signIn(second).expect(429);
  });

  it("counts each refusal by route and day for platform administrators only", async () => {
    await first.http().get("/api/v1/rate-limits/refusals").set(as(orgAdmin)).expect(403);
    await first.http().get("/api/v1/rate-limits/refusals?days=0").set(as(platformAdmin)).expect(400);
    const { body } = await first.http().get("/api/v1/rate-limits/refusals?days=7").set(as(platformAdmin)).expect(200);
    expect(body).toMatchObject({ days: 7, timeZone: "Asia/Manila" });
    const login = body.rows.filter((r: { route: string }) => r.route.endsWith("/auth/login"));
    expect(login).toHaveLength(1);
    expect(login[0]).toMatchObject({ route: "POST /api/v1/auth/login", refusals: 2 });
    expect(login[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
  });

  it("keeps the health check unlimited", async () => {
    for (let i = 0; i < 3; i += 1) await first.http().get("/api/v1/health/live").expect(200);
  });

  it("lets requests through while Redis is unreachable", async () => {
    const offline = await createTestApp({ disableRateLimit: false, rateLimitStorage: { redisUrl: "redis://127.0.0.1:1", keyPrefix } });
    try {
      const again = await createTenant(offline.pool, "limits-org");
      await createStaff(offline.pool, again, "clerk@limits.ph", ["receptionist"]);
      for (let i = 0; i < 12; i += 1) await signIn(offline).expect(200);
    } finally {
      await offline.close();
    }
  });
});
