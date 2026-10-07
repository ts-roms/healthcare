import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

/**
 * Editing an organization's own roles (docs/security/access-control.md, "Roles"; migration 0102): the whole permission
 * set replaced together, built-in roles read-only, no handing out or taking away what the editor does not hold, a
 * stale version refused, and holders seeing the change at their next request.
 */
describe("role editing", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let managerId: string;
  let roleId = "";

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const roleView = async (token: string, key: string) => (await api(token).get("/roles").expect(200)).body.find((r: { key: string }) => r.key === key);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "role-editing-org");
    await createStaff(ctx.pool, tenant, "admin@roles.ph", ["org_admin"]);
    managerId = await createStaff(ctx.pool, tenant, "manager@roles.ph", []);
    await createStaff(ctx.pool, tenant, "desk@roles.ph", []);
    admin = (await login(ctx, "admin@roles.ph")).accessToken;
    // A role manager who holds user and role management but nothing clinical.
    await ctx.pool.query(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'role_manager', 'Role manager')`, [tenant.organizationId]);
    await ctx.pool.query(
      `INSERT INTO role_permission (role_id, permission_key)
       SELECT r.id, p FROM role r, unnest(ARRAY['user.read', 'user.manage', 'role.manage']) AS p WHERE r.key = 'role_manager' AND r.organization_id = $1`,
      [tenant.organizationId],
    );
    const managerRole = (await ctx.pool.query(`SELECT id FROM role WHERE key = 'role_manager' AND organization_id = $1`, [tenant.organizationId])).rows[0].id;
    await ctx.pool.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      tenant.organizationId,
      managerId,
      managerRole,
    ]);
  });
  afterAll(() => ctx.close());

  it("creates a role, then edits its name, description and permissions together, versioned and audited", async () => {
    const created = await api(admin)
      .post("/roles", { key: "front_desk_lead", name: "Front desk lead", permissions: ["patient.read", "patient.search"] })
      .expect(201);
    roleId = created.body.id;
    expect(created.body).toMatchObject({ version: 1, isSystem: false });

    const edited = await api(admin)
      .put(`/roles/${roleId}`, {
        name: "Front desk lead (all branches)",
        description: "Leads the front desk",
        permissions: ["patient.read", "patient.search", "appointment.read"],
        version: 1,
        reason: "New responsibilities",
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      key: "front_desk_lead",
      name: "Front desk lead (all branches)",
      description: "Leads the front desk",
      permissions: ["appointment.read", "patient.read", "patient.search"],
      version: 2,
    });
    const stale = await api(admin)
      .put(`/roles/${roleId}`, { name: "x", permissions: ["patient.read"], version: 1 })
      .expect(409);
    expect(stale.body.error.code).toBe("version_conflict");
    const [event] = await auditRows(ctx.pool, "action = 'role.update'");
    expect(event).toMatchObject({ outcome: "success", reason: "New responsibilities", metadata: { added: ["appointment.read"], removed: [] } });
  });

  it("keeps built-in roles read-only and the key unchanged", async () => {
    const nurse = await roleView(admin, "nurse");
    const refused = await api(admin).put(`/roles/${nurse.id}`, { name: "Nurse", permissions: nurse.permissions, version: nurse.version }).expect(422);
    expect(refused.body.error.code).toBe("system_role");
    // A key in the body is ignored: the key is the role's identity.
    const sent = await api(admin)
      .put(`/roles/${roleId}`, {
        key: "renamed",
        name: "Front desk lead (all branches)",
        permissions: ["patient.read", "patient.search", "appointment.read"],
        version: 2,
      })
      .expect(200);
    expect(sent.body).toMatchObject({ key: "front_desk_lead", version: 3 });
  });

  it("refuses adding or removing a permission the editor does not hold, and lets them change what they do hold", async () => {
    const manager = (await login(ctx, "manager@roles.ph")).accessToken;
    const current = await roleView(manager, "front_desk_lead");
    // Adding a clinical permission the manager lacks.
    await api(manager)
      .put(`/roles/${roleId}`, { name: current.name, permissions: [...current.permissions, "encounter.read"], version: current.version })
      .expect(403);
    // Taking away a permission the manager lacks.
    await api(manager)
      .put(`/roles/${roleId}`, { name: current.name, permissions: ["user.read"], version: current.version })
      .expect(403);
    expect((await auditRows(ctx.pool, "reason = 'privilege_escalation'")).length).toBe(2);
    // Changing only what they hold (and the name) is allowed; untouched permissions they lack stay.
    const renamed = await api(manager)
      .put(`/roles/${roleId}`, { name: "Front desk lead", permissions: [...current.permissions, "user.read"], version: current.version })
      .expect(200);
    expect(renamed.body.permissions).toEqual(["appointment.read", "patient.read", "patient.search", "user.read"]);
    expect(renamed.body.version).toBe(4);
  });

  it("changes what a holder may do at their next request, without a new sign-in", async () => {
    const deskId = (await ctx.pool.query(`SELECT id FROM app_user WHERE email = 'desk@roles.ph'`)).rows[0].id;
    await api(admin).post(`/users/${deskId}/role-assignments`, { roleId }).expect(201);
    const desk = (await login(ctx, "desk@roles.ph")).accessToken;
    await api(desk).get("/patients?q=juan").expect(200);
    const current = await roleView(admin, "front_desk_lead");
    await api(admin)
      .put(`/roles/${roleId}`, { name: current.name, permissions: ["appointment.read"], version: current.version })
      .expect(200);
    await api(desk).get("/patients?q=juan").expect(403);
    const me = await ctx.http().get("/api/v1/auth/me").set(as(desk, tenant.facilityId)).expect(200);
    expect(me.body.permissions).toEqual(["appointment.read"]);
    // Another organization's role is not reachable.
    const other = await createTenant(ctx.pool, "role-editing-other");
    await createStaff(ctx.pool, other, "admin@other-roles.ph", ["org_admin"]);
    const otherAdmin = (await login(ctx, "admin@other-roles.ph", other.organizationId)).accessToken;
    await ctx
      .http()
      .put(`/api/v1/roles/${roleId}`)
      .set(as(otherAdmin, other.facilityId))
      .send({ name: "x", permissions: ["patient.read"], version: 5 })
      .expect(404);
    expect(PASSWORD).toBeDefined();
  });
});
