import { currentTotp } from "@healthcare/auth";
import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

describe("staff two-step verification policy", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let adminToken: string;
  let nurseId: string;
  let gatewayId: string;

  const enroll = async (token: string) => {
    const setup = await ctx.http().post("/api/v1/auth/mfa/setup").set(as(token)).expect(201);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/confirm")
      .set(as(token))
      .send({ code: currentTotp(setup.body.secret) })
      .expect(204);
    return setup.body.secret as string;
  };
  const policy = async () => (await ctx.http().get("/api/v1/security/mfa-policy").set(as(adminToken)).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "mfa-policy-org");
    await createStaff(ctx.pool, tenant, "admin@mfa.example.ph", ["org_admin"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@mfa.example.ph", ["nurse"]);
    gatewayId = await createStaff(ctx.pool, tenant, "gateway@mfa.example.ph", ["nurse"]);
    adminToken = (await login(ctx, "admin@mfa.example.ph")).accessToken;
  });

  afterAll(() => ctx.close());

  it("is not required by default and needs the administrator's own two-step verification before it can be", async () => {
    expect(await policy()).toMatchObject({ required: false, version: 0, members: { active: 3, withMfa: 0, exempt: 0, withoutMfa: 3 } });
    const refused = await ctx.http().put("/api/v1/security/mfa-policy").set(as(adminToken)).send({ required: true, version: 0 }).expect(422);
    expect(refused.body.error.code).toBe("own_mfa_required");

    await enroll(adminToken);
    const updated = await ctx
      .http()
      .put("/api/v1/security/mfa-policy")
      .set(as(adminToken))
      .send({ required: true, version: 0, reason: "Clinic security review" })
      .expect(200);
    expect(updated.body).toMatchObject({ required: true, version: 1, updatedBy: { displayName: "admin@mfa.example.ph" } });
    expect(updated.body.pending.map((p: { email: string }) => p.email).sort()).toEqual(["gateway@mfa.example.ph", "nurse@mfa.example.ph"]);

    const stale = await ctx.http().put("/api/v1/security/mfa-policy").set(as(adminToken)).send({ required: false, version: 0 }).expect(409);
    expect(stale.body.error.code).toBe("version_conflict");
    const [event] = await auditRows(ctx.pool, `action = 'auth.mfa-policy.update'`);
    expect(event).toMatchObject({ outcome: "success", reason: "Clinic security review" });
  });

  it("lets a member without it sign in only to set it up, then everything opens", async () => {
    const { accessToken } = await login(ctx, "nurse@mfa.example.ph");
    const me = await ctx.http().get("/api/v1/auth/me").set(as(accessToken)).expect(200);
    expect(me.body.mfaPolicy).toEqual({ required: true, exempt: false, enrollmentRequired: true });
    expect(me.body.permissions).toEqual([]);
    await ctx.http().get("/api/v1/auth/me/facilities").set(as(accessToken)).expect(200);
    const blocked = await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(403);
    expect(blocked.body.error.code).toBe("mfa_enrollment_required");

    const secret = await enroll(accessToken);
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(200);
    const after = await ctx.http().get("/api/v1/auth/me").set(as(accessToken)).expect(200);
    expect(after.body.mfaPolicy.enrollmentRequired).toBe(false);
    expect(after.body.permissions).toContain("patient.search");

    // While required, it cannot be turned off.
    const off = await ctx
      .http()
      .post("/api/v1/auth/mfa/disable")
      .set(as(accessToken))
      .send({ password: PASSWORD, code: currentTotp(secret) });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe("mfa_required_by_organization");
  });

  it("exempts an integration account with a reason, and only an administrator can", async () => {
    const nurse = await login(ctx, "gateway@mfa.example.ph");
    await ctx.http().get("/api/v1/patients?q=juan").set(as(nurse.accessToken)).expect(403);

    const self = await ctx.http().put(`/api/v1/users/${gatewayId}/mfa-exemption`).set(as(nurse.accessToken)).send({ reason: "Integration account" });
    expect(self.status).toBe(403);
    const ownExemption = await ctx
      .http()
      .put(`/api/v1/users/${(await ctx.pool.query(`SELECT id FROM app_user WHERE email = 'admin@mfa.example.ph'`)).rows[0].id}/mfa-exemption`)
      .set(as(adminToken))
      .send({ reason: "Just because" })
      .expect(422);
    expect(ownExemption.body.error.code).toBe("self_modification");

    const exempted = await ctx
      .http()
      .put(`/api/v1/users/${gatewayId}/mfa-exemption`)
      .set(as(adminToken))
      .send({ reason: "Instrument gateway integration account" })
      .expect(200);
    expect(exempted.body.exemptions).toEqual([
      expect.objectContaining({ userId: gatewayId, reason: "Instrument gateway integration account", exemptedBy: "admin@mfa.example.ph" }),
    ]);
    expect(exempted.body.members).toMatchObject({ active: 3, withMfa: 2, exempt: 1, withoutMfa: 0 });
    await ctx.http().get("/api/v1/patients?q=juan").set(as(nurse.accessToken)).expect(200);

    await ctx.http().delete(`/api/v1/users/${gatewayId}/mfa-exemption`).set(as(adminToken)).expect(200);
    await ctx.http().get("/api/v1/patients?q=juan").set(as(nurse.accessToken)).expect(403);
    expect((await auditRows(ctx.pool, `action LIKE 'auth.mfa-exemption.%'`)).map((e) => e.action)).toEqual([
      "auth.mfa-exemption.grant",
      "auth.mfa-exemption.revoke",
    ]);
  });

  it("resets a member's two-step verification, ending their sessions, so they set it up again", async () => {
    const nurseSession = await ctx.pool.query(`SELECT count(*)::int AS n FROM auth_session WHERE user_id = $1 AND revoked_at IS NULL`, [nurseId]);
    expect(nurseSession.rows[0].n).toBeGreaterThan(0);

    await ctx.http().post(`/api/v1/users/${nurseId}/mfa-reset`).set(as(adminToken)).send({ reason: "Lost phone" }).expect(204);
    const again = await ctx.http().post(`/api/v1/users/${nurseId}/mfa-reset`).set(as(adminToken)).send({ reason: "Lost phone" }).expect(422);
    expect(again.body.error.code).toBe("mfa_not_enabled");
    const open = await ctx.pool.query(`SELECT count(*)::int AS n FROM auth_session WHERE user_id = $1 AND revoked_at IS NULL`, [nurseId]);
    expect(open.rows[0].n).toBe(0);

    const { accessToken } = await login(ctx, "nurse@mfa.example.ph");
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(403);
    const [event] = await auditRows(ctx.pool, `action = 'auth.mfa.reset'`);
    expect(event).toMatchObject({ reason: "Lost phone", metadata: { sessionsRevoked: expect.any(Number) } });
  });

  it("refuses to reset an account that also belongs to another organization", async () => {
    const other = await createTenant(ctx.pool, "mfa-policy-other");
    const sharedId = await createStaff(ctx.pool, tenant, "shared@mfa.example.ph", ["nurse"]);
    await createStaff(ctx.pool, other, "shared@mfa.example.ph", ["nurse"]);
    const { accessToken } = await login(ctx, "shared@mfa.example.ph", tenant.organizationId);
    await enroll(accessToken);
    const refused = await ctx.http().post(`/api/v1/users/${sharedId}/mfa-reset`).set(as(adminToken)).send({ reason: "Lost phone" }).expect(403);
    expect(refused.body.error.code).toBe("member_of_other_organizations");
  });

  it("opens everything again when the requirement is lifted", async () => {
    const { accessToken } = await login(ctx, "nurse@mfa.example.ph");
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(403);
    await ctx.http().put("/api/v1/security/mfa-policy").set(as(adminToken)).send({ required: false, version: 1 }).expect(200);
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(200);
  });
});
