import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

const TEMPORARY = "Temporary-Pass-2026-x";

/**
 * An administrator resets a staff member's password (a temporary one to replace at the next sign-in) (docs/security/access-control.md, "Credential resets by an administrator"; migration 0089).
 */
describe("staff credential resets by an administrator", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let admin: string;
  let nurseId: string;
  let sharedId: string;

  const signIn = (email: string, password: string) => ctx.http().post("/api/v1/auth/login").send({ email, password, organizationId: tenant.organizationId });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "reset-org");
    other = await createTenant(ctx.pool, "reset-other");
    const adminId = await createStaff(ctx.pool, tenant, "admin@reset.ph", ["org_admin"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@reset.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "desk@reset.ph", ["receptionist"]);
    sharedId = await createStaff(ctx.pool, tenant, "shared@reset.ph", ["nurse"]);
    await ctx.pool.query(`INSERT INTO organization_membership (organization_id, user_id) VALUES ($1, $2)`, [other.organizationId, sharedId]);
    admin = (await login(ctx, "admin@reset.ph")).accessToken;
    expect(adminId).toBeTruthy();
  });
  afterAll(() => ctx.close());

  it("gives a temporary password that ends sessions, clears a lockout and must be replaced before anything else", async () => {
    const before = await login(ctx, "nurse@reset.ph");
    await ctx.pool.query(`UPDATE app_user SET failed_login_count = 5, locked_until = now() + interval '10 minutes' WHERE id = $1`, [nurseId]);
    const desk = (await login(ctx, "desk@reset.ph")).accessToken;
    await ctx
      .http()
      .post(`/api/v1/users/${nurseId}/password-reset`)
      .set(as(desk))
      .send({ temporaryPassword: TEMPORARY, reason: "Forgot password" })
      .expect(403);
    await ctx.http().post(`/api/v1/users/${nurseId}/password-reset`).set(as(admin)).send({ temporaryPassword: "short", reason: "Forgot password" }).expect(400);

    const reset = await ctx
      .http()
      .post(`/api/v1/users/${nurseId}/password-reset`)
      .set(as(admin))
      .send({ temporaryPassword: TEMPORARY, reason: "Forgot password" })
      .expect(200);
    expect(reset.body).toMatchObject({ id: nurseId, passwordChangeRequired: true });
    await ctx.http().get("/api/v1/auth/me").set(as(before.accessToken)).expect(401);
    await signIn("nurse@reset.ph", PASSWORD).expect(401);

    const signedIn = await signIn("nurse@reset.ph", TEMPORARY).expect(200);
    const token = signedIn.body.accessToken as string;
    const me = await ctx.http().get("/api/v1/auth/me").set(as(token)).expect(200);
    expect(me.body.user.passwordChangeRequired).toBe(true);
    await ctx.http().get("/api/v1/auth/me/facilities").set(as(token)).expect(200);
    const refused = await ctx.http().get("/api/v1/patients?q=cruz").set(as(token, tenant.facilityId)).expect(403);
    expect(refused.body.error.code).toBe("password_change_required");

    await ctx.http().post("/api/v1/auth/password").set(as(token)).send({ currentPassword: TEMPORARY, newPassword: "Her-Own-New-Passphrase-5" }).expect(204);
    expect((await ctx.http().get("/api/v1/auth/me").set(as(token)).expect(200)).body.user.passwordChangeRequired).toBe(false);
    await ctx.http().get("/api/v1/patients?q=cruz").set(as(token, tenant.facilityId)).expect(200);

    const audit = await auditRows(ctx.pool, `action = 'user.password-reset' AND resource_id = $1`, [nurseId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: "Forgot password", metadata: expect.objectContaining({ sessionsRevoked: 1 }) });
  });

  it("leaves your own account, accounts shared with other organizations and other organizations' members alone", async () => {
    const adminId = (await ctx.http().get("/api/v1/auth/me").set(as(admin)).expect(200)).body.user.id as string;
    await ctx
      .http()
      .post(`/api/v1/users/${adminId}/password-reset`)
      .set(as(admin))
      .send({ temporaryPassword: TEMPORARY, reason: "Mine" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("self_modification"));
    await ctx
      .http()
      .post(`/api/v1/users/${sharedId}/password-reset`)
      .set(as(admin))
      .send({ temporaryPassword: TEMPORARY, reason: "Forgot" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("account_shared"));
    await createStaff(ctx.pool, other, "admin@reset-other.ph", ["org_admin"]);
    const outsider = (await login(ctx, "admin@reset-other.ph")).accessToken;
    await ctx.http().post(`/api/v1/users/${nurseId}/password-reset`).set(as(outsider)).send({ temporaryPassword: TEMPORARY, reason: "x y z" }).expect(404);
  });
});
