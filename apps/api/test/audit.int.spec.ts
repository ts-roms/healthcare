import { as, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

describe("audit trail", () => {
  let ctx: TestContext;
  let tenant: Tenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "audit-org");
    await createStaff(ctx.pool, tenant, "auditor@example.ph", ["auditor"]);
    await createStaff(ctx.pool, tenant, "nurse@example.ph", ["nurse"]);
  });

  afterAll(() => ctx.close());

  it("cannot be modified, deleted or truncated", async () => {
    await login(ctx, "nurse@example.ph");
    await expect(ctx.pool.query(`UPDATE audit_event SET action = 'tampered.action'`)).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query(`DELETE FROM audit_event`)).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query(`TRUNCATE audit_event`)).rejects.toThrow(/append-only/);
  });

  it("is searchable by authorized users, and searching is itself audited", async () => {
    const { accessToken } = await login(ctx, "auditor@example.ph");
    const page = await ctx.http().get("/api/v1/audit-events?action=auth.login").set(as(accessToken)).expect(200);
    expect(page.body.items.length).toBeGreaterThanOrEqual(2);
    expect(page.body.items.every((e: { action: string }) => e.action === "auth.login")).toBe(true);
    const search = await ctx.pool.query(`SELECT count(*)::int AS n FROM audit_event WHERE action = 'audit.search'`);
    expect(search.rows[0].n).toBe(1);

    const nurse = await login(ctx, "nurse@example.ph");
    await ctx.http().get("/api/v1/audit-events").set(as(nurse.accessToken)).expect(403);
  });

  it("only returns events of the caller organization", async () => {
    const other = await createTenant(ctx.pool, "audit-other");
    await createStaff(ctx.pool, other, "other-auditor@example.ph", ["auditor"]);
    const { accessToken } = await login(ctx, "other-auditor@example.ph");
    const page = await ctx.http().get("/api/v1/audit-events").set(as(accessToken)).expect(200);
    const orgs = await ctx.pool.query(`SELECT DISTINCT organization_id FROM audit_event WHERE id = ANY($1::uuid[])`, [
      page.body.items.map((e: { id: string }) => e.id),
    ]);
    expect(orgs.rows.map((r) => r.organization_id)).toEqual([other.organizationId]);
  });
});
