import { randomBytes } from "node:crypto";
import { as, createStaff, createTenant, createTestApp, login, type Tenant, TEST_REDIS_URL, type TestContext } from "./harness";

/**
 * Kiosk routes are rate-limited per signed-in device account, not per network address (docs/security/kiosk-audit-phase-6.md,
 * KA-07): kiosks in one clinic share an address, and one busy kiosk must not use up the others' allowance. Needs Redis.
 */
describe("kiosk rate limits", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let one: string;
  let two: string;

  const open = (token: string) => ctx.http().post("/api/v1/kiosk/sessions").set(as(token, tenant.facilityId)).send({});

  beforeAll(async () => {
    ctx = await createTestApp({
      disableRateLimit: false,
      rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix: `kiosk-throttle-${randomBytes(4).toString("hex")}:` },
    });
    tenant = await createTenant(ctx.pool, "kiosk-limits-org");
    await createStaff(ctx.pool, tenant, "admin@kl.ph", ["org_admin"]);
    for (const name of ["one", "two"]) await createStaff(ctx.pool, tenant, `${name}@kl.ph`, [{ role: "kiosk_device", facilityId: tenant.facilityId }]);
    const admin = (await login(ctx, "admin@kl.ph")).accessToken;
    one = (await login(ctx, "one@kl.ph")).accessToken;
    two = (await login(ctx, "two@kl.ph")).accessToken;
    for (const name of ["one", "two"]) {
      const id = (await ctx.pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [`${name}@kl.ph`])).rows[0]!.id;
      await ctx
        .http()
        .post("/api/v1/kiosk/admin/devices")
        .set(as(admin, tenant.facilityId))
        .send({ code: `limit-${name}`, name: `Limit ${name}`, userId: id })
        .expect(201);
    }
  });
  afterAll(() => ctx.close());

  it("counts a kiosk's own requests: one kiosk using up its allowance does not stop another on the same address", async () => {
    // Sixty sessions a minute per kiosk; every request here comes from the same address.
    for (let i = 0; i < 60; i += 1) await open(one).expect(201);
    const refused = await open(one).expect(429);
    expect(refused.body.error.code).toBe("rate_limited");
    await open(two).expect(201);
  });
});
