import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

describe("access control", () => {
  let ctx: TestContext;
  let tenant: Tenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "access-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "auditor@example.ph", ["auditor"]);
    // Receptionist only at the main facility.
    await createStaff(ctx.pool, tenant, "frontdesk@example.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
  });

  afterAll(() => ctx.close());

  it("denies a missing permission server-side and audits the denial", async () => {
    const { accessToken } = await login(ctx, "auditor@example.ph");
    const response = await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(403);
    expect(response.body.error.code).toBe("forbidden");
    const denials = await auditRows(ctx.pool, `action = 'access.deny'`);
    expect(denials.at(-1)).toMatchObject({ outcome: "denied", reason: "missing_permission", metadata: { missing: ["patient.search"] } });
  });

  it("applies facility-scoped roles only inside that facility", async () => {
    const { accessToken } = await login(ctx, "frontdesk@example.ph");
    // Organization-wide context: the facility-scoped grant does not apply.
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(403);
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken, tenant.facilityId)).expect(200);
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken, tenant.otherFacilityId)).expect(403);
  });

  it("rejects facilities of another organization", async () => {
    const other = await createTenant(ctx.pool, "other-org");
    const { accessToken } = await login(ctx, "admin@example.ph");
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken, other.facilityId)).expect(403);
    await ctx
      .http()
      .get("/api/v1/patients?q=juan")
      .set({ ...as(accessToken), "x-facility-id": "not-a-uuid" })
      .expect(400);
  });

  it("isolates patient records between organizations", async () => {
    const admin = await login(ctx, "admin@example.ph");
    const created = await ctx.http().post("/api/v1/patients").set(as(admin.accessToken, tenant.facilityId)).send(juan).expect(201);

    const other = await createTenant(ctx.pool, "isolated-org");
    await createStaff(ctx.pool, other, "outsider@example.ph", ["org_admin"]);
    const outsider = await login(ctx, "outsider@example.ph");
    await ctx.http().get(`/api/v1/patients/${created.body.id}`).set(as(outsider.accessToken)).expect(404);
    const search = await ctx.http().get("/api/v1/patients?q=dela%20cruz").set(as(outsider.accessToken)).expect(200);
    expect(search.body.items).toHaveLength(0);
  });

  it("prevents granting permissions the grantor does not hold", async () => {
    await createStaff(ctx.pool, tenant, "manager@example.ph", []);
    await ctx.pool.query(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'user_manager', 'User manager')`, [tenant.organizationId]);
    await ctx.pool.query(
      `INSERT INTO role_permission (role_id, permission_key)
       SELECT r.id, p FROM role r, unnest(ARRAY['user.read', 'user.manage']) AS p WHERE r.key = 'user_manager'`,
    );
    const managerId = (await ctx.pool.query(`SELECT id FROM app_user WHERE email = 'manager@example.ph'`)).rows[0].id;
    const roleId = (await ctx.pool.query(`SELECT id FROM role WHERE key = 'user_manager'`)).rows[0].id;
    await ctx.pool.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.organizationId, managerId, roleId]);

    const manager = await login(ctx, "manager@example.ph");
    const roles = await ctx.http().get("/api/v1/roles").set(as(manager.accessToken)).expect(200);
    const orgAdmin = roles.body.find((r: { key: string }) => r.key === "org_admin");
    await ctx.http().post(`/api/v1/users/${managerId}/role-assignments`).set(as(manager.accessToken)).send({ roleId: orgAdmin.id }).expect(403);
    const escalation = await auditRows(ctx.pool, `reason = 'privilege_escalation'`);
    expect(escalation).toHaveLength(1);
  });

  it("lets an administrator add staff, grant a scoped role and suspend them", async () => {
    const admin = await login(ctx, "admin@example.ph");
    const created = await ctx
      .http()
      .post("/api/v1/users")
      .set(as(admin.accessToken))
      .send({ email: "NewNurse@Example.ph", displayName: "New Nurse", initialPassword: "Initial-Passphrase-42" })
      .expect(201);
    expect(created.body.email).toBe("newnurse@example.ph");

    const roles = await ctx.http().get("/api/v1/roles").set(as(admin.accessToken)).expect(200);
    const nurse = roles.body.find((r: { key: string }) => r.key === "nurse");
    const granted = await ctx
      .http()
      .post(`/api/v1/users/${created.body.id}/role-assignments`)
      .set(as(admin.accessToken))
      .send({ roleId: nurse.id, facilityId: tenant.otherFacilityId })
      .expect(201);
    expect(granted.body.roleAssignments).toEqual([expect.objectContaining({ roleKey: "nurse", facilityId: tenant.otherFacilityId })]);

    const session = await ctx.http().post("/api/v1/auth/login").send({ email: "newnurse@example.ph", password: "Initial-Passphrase-42" }).expect(200);
    await ctx
      .http()
      .patch(`/api/v1/users/${created.body.id}/membership`)
      .set(as(admin.accessToken))
      .send({ status: "suspended", reason: "Left the clinic" })
      .expect(200);
    await ctx.http().get("/api/v1/auth/me").set(as(session.body.accessToken)).expect(401);
  });

  it("restricts organization creation to platform administrators", async () => {
    const admin = await login(ctx, "admin@example.ph");
    await ctx.http().post("/api/v1/organizations").set(as(admin.accessToken)).send({ code: "new-org", name: "New Org" }).expect(403);
    await createStaff(ctx.pool, tenant, "platform@example.ph", ["org_admin"], { platformAdmin: true });
    const platform = await login(ctx, "platform@example.ph");
    await ctx.http().post("/api/v1/organizations").set(as(platform.accessToken)).send({ code: "new-org", name: "New Org" }).expect(201);
  });
});
