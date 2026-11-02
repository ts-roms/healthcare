import { IdempotencyPurge } from "../src/app/idempotency-purge";
import { createTestApp, type TestContext, underPlatform } from "./harness";

/** Expired idempotency records (they hold stored responses) are removed after a grace period (docs/security-audit, VR-15). */
describe("idempotency record purge", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const insert = (key: string, expiresInHours: number) =>
    ctx.pool.query(
      `INSERT INTO idempotency_record (user_id, idempotency_key, method, path, request_hash, state, response_status, response_body, expires_at)
       VALUES (gen_random_uuid(), $1, 'POST', '/api/v1/x', 'hash', 'completed', 201, '{"name":"synthetic"}', now() + make_interval(hours => $2::int))`,
      [key, expiresInHours],
    );

  it("removes records expired for more than a day and keeps the rest", async () => {
    await insert("purge-long-expired", -48);
    await insert("purge-just-expired", -2);
    await insert("purge-still-valid", 12);
    const purge = underPlatform(ctx.app.get(IdempotencyPurge));
    expect(await purge.run()).toBe(1);
    const left = await ctx.pool.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM idempotency_record WHERE idempotency_key LIKE 'purge-%' ORDER BY 1`,
    );
    expect(left.rows.map((r) => r.idempotency_key)).toEqual(["purge-just-expired", "purge-still-valid"]);
  });
});
