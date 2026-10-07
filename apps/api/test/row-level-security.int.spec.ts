import { asOrganization, asPlatform, ContextPool } from "@healthcare/core";
import { as, createStaff, createTenant, createTestApp, juan, login, TEST_APP_DATABASE_URL, type Tenant, type TestContext } from "./harness";

/**
 * Row-level security per organization (migration 0111, docs/runbooks/database-roles.md): the application role sees
 * and writes only the rows of the organization its connection is stamped with, everything under the platform scope,
 * and — in enforce mode — nothing without a context. The stamp comes from the request or from asOrganization /
 * asPlatform (libs/core database-context.ts).
 */
describe("row-level security", () => {
  let ctx: TestContext;
  let a: Tenant;
  let b: Tenant;
  let patientA: string;
  let patientB: string;
  let enforce: ContextPool;
  let observe: ContextPool;

  const ids = async (pool: ContextPool) =>
    (await pool.query<{ organization_id: string }>("SELECT DISTINCT organization_id::text FROM patient ORDER BY 1")).rows.map((r) => r.organization_id);

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await createTenant(ctx.pool, "rls-a");
    b = await createTenant(ctx.pool, "rls-b");
    await createStaff(ctx.pool, a, "admin@rls-a.ph", ["org_admin"]);
    await createStaff(ctx.pool, b, "admin@rls-b.ph", ["org_admin"]);
    const tokenA = (await login(ctx, "admin@rls-a.ph")).accessToken;
    const tokenB = (await login(ctx, "admin@rls-b.ph")).accessToken;
    patientA = (await ctx.http().post("/api/v1/patients").set(as(tokenA, a.facilityId)).send(juan).expect(201)).body.id;
    patientB = (await ctx.http().post("/api/v1/patients").set(as(tokenB, b.facilityId)).send(juan).expect(201)).body.id;
    enforce = new ContextPool({ connectionString: TEST_APP_DATABASE_URL, max: 2 }, "enforce");
    observe = new ContextPool({ connectionString: TEST_APP_DATABASE_URL, max: 2 }, "observe");
  });
  afterAll(async () => {
    await enforce.end();
    await observe.end();
    await ctx.close();
  });

  it("covers every table with an organization_id", async () => {
    const { rows } = await ctx.pool.query<{ relname: string; rls: boolean; policy: boolean }>(`
      SELECT c.relname, c.relrowsecurity AS rls,
             EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'organization_isolation') AS policy
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'organization_id' AND NOT att.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`);
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.filter((r) => !r.rls || !r.policy).map((r) => r.relname)).toEqual([]);
  });

  it("shows one organization's rows to its context, every row to the platform scope, and none without a context", async () => {
    expect(await asOrganization(a.organizationId, () => ids(enforce))).toEqual([a.organizationId]);
    expect(await asOrganization(b.organizationId, () => ids(enforce))).toEqual([b.organizationId]);
    expect((await asPlatform("test", () => ids(enforce))).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(await ids(enforce)).toEqual([]);
    // Even asking for the other organization's row by id finds nothing.
    const { rows } = await asOrganization(a.organizationId, () => enforce.query("SELECT id FROM patient WHERE id = $1", [patientB]));
    expect(rows).toEqual([]);
  });

  it("lets a query without a context through in observe mode (and only there)", async () => {
    expect((await ids(observe)).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(await asOrganization(a.organizationId, () => ids(observe))).toEqual([a.organizationId]);
  });

  it("refuses writes into another organization and leaves its rows untouched", async () => {
    await expect(
      asOrganization(a.organizationId, () =>
        enforce.query("INSERT INTO facility (organization_id, code, name, facility_type) VALUES ($1, 'rls-x', 'Somewhere else', 'clinic')", [b.organizationId]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asOrganization(a.organizationId, () => enforce.query("UPDATE patient SET updated_at = updated_at WHERE id = $1", [patientB]));
    expect(updated.rowCount).toBe(0);
    const own = await asOrganization(a.organizationId, () => enforce.query("UPDATE patient SET updated_at = updated_at WHERE id = $1", [patientA]));
    expect(own.rowCount).toBe(1);
  });

  it("transactions keep the context of the code that opened them", async () => {
    const client = await asOrganization(b.organizationId, () => enforce.connect());
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ organization_id: string }>("SELECT DISTINCT organization_id::text FROM patient");
      await client.query("COMMIT");
      expect(rows.map((r) => r.organization_id)).toEqual([b.organizationId]);
    } finally {
      client.release();
    }
  });

  it("accepts audit events without an organization from any context, and shows them only to the platform scope", async () => {
    await asOrganization(a.organizationId, () =>
      enforce.query("INSERT INTO audit_event (actor_type, action, resource_type, outcome) VALUES ('anonymous', 'test.unknown-org', 'test', 'denied')"),
    );
    const seen = (pool: ContextPool) => pool.query("SELECT 1 FROM audit_event WHERE action = 'test.unknown-org'");
    expect((await asOrganization(a.organizationId, () => seen(enforce))).rows).toHaveLength(0);
    expect((await asPlatform("test", () => seen(enforce))).rows).toHaveLength(1);
  });

  it("keeps the API working for each organization through the request context", async () => {
    const tokenA = (await login(ctx, "admin@rls-a.ph")).accessToken;
    await ctx.http().get(`/api/v1/patients/${patientA}`).set(as(tokenA, a.facilityId)).expect(200);
    await ctx.http().get(`/api/v1/patients/${patientB}`).set(as(tokenA, a.facilityId)).expect(404);
  });
});
