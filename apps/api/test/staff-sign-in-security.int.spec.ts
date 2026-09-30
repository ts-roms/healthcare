import { currentTotp } from "@healthcare/auth";
import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

const NEW_PASSWORD = "Bagong-Password-Ko-2026";

/**
 * Staff sign-in security (docs/security/access-control.md; migration 0089): a password reset by email — the same answer
 * whether or not the account exists, a single-use short-lived link, a current code when two-step verification is on,
 * every session ended — and an organization rule requiring two-step verification of staff.
 */
describe("staff password reset by email and required two-step verification", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let clerkId: string;

  const post = (path: string, body: object) => ctx.http().post(`/api/v1/auth${path}`).send(body);
  const latestToken = async (userId: string) => {
    const { rows } = await ctx.pool.query<{ variables: { link?: string } }>(
      "SELECT variables FROM notification WHERE recipient_user_id = $1 AND template_key = 'staff.password-reset' ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    const link = rows[0]?.variables.link ?? "";
    expect(link).toMatch(/^https:\/\/staff\.test\.invalid\/reset-password#token=[\w-]{20,}$/);
    return link.split("#token=")[1]!;
  };
  const signIn = (email: string, password: string) => post("/login", { email, password });

  beforeAll(async () => {
    ctx = await createTestApp({}, { STAFF_BASE_URL: "https://staff.test.invalid/" });
    tenant = await createTenant(ctx.pool, "signin-org");
    await createStaff(ctx.pool, tenant, "admin@signin.ph", ["org_admin"]);
    clerkId = await createStaff(ctx.pool, tenant, "clerk@signin.ph", ["receptionist"]);
  });
  afterAll(() => ctx.close());

  it("emails a single-use link that resets the password and ends every session", async () => {
    const before = (await login(ctx, "clerk@signin.ph")).accessToken;
    await post("/password-reset/request", { email: "nobody@signin.ph" }).expect(204);
    await post("/password-reset/request", { email: "clerk@signin.ph" }).expect(204);
    const token = await latestToken(clerkId);
    const stored = await ctx.pool.query<{ token_hash: string }>("SELECT token_hash FROM staff_password_reset WHERE user_id = $1", [clerkId]);
    expect(stored.rows[0]!.token_hash).not.toContain(token);

    await post("/password-reset", { token: "x".repeat(43), password: NEW_PASSWORD }).expect(401);
    await post("/password-reset", { token, password: NEW_PASSWORD }).expect(204);
    await ctx.http().get("/api/v1/auth/me").set(as(before)).expect(401);
    await signIn("clerk@signin.ph", PASSWORD).expect(401);
    await signIn("clerk@signin.ph", NEW_PASSWORD).expect(200);
    await post("/password-reset", { token, password: "Another-Passphrase-99" }).expect(401);
    expect(await auditRows(ctx.pool, `action = 'auth.password-reset' AND outcome = 'success' AND resource_id = $1`, [clerkId])).toHaveLength(1);
    const changed = await ctx.pool.query("SELECT 1 FROM notification WHERE recipient_user_id = $1 AND template_key = 'staff.password-changed'", [clerkId]);
    expect(changed.rowCount).toBe(1);
  });

  it("asks for a current code when two-step verification is on", async () => {
    const session = (await signIn("clerk@signin.ph", NEW_PASSWORD).expect(200)).body.accessToken as string;
    const setup = await ctx.http().post("/api/v1/auth/mfa/setup").set(as(session)).expect(201);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/confirm")
      .set(as(session))
      .send({ code: currentTotp(setup.body.secret) })
      .expect(204);
    await ctx.pool.query("UPDATE staff_password_reset SET created_at = created_at - interval '2 hours'");
    await post("/password-reset/request", { email: "clerk@signin.ph" }).expect(204);
    const token = await latestToken(clerkId);
    const missing = await post("/password-reset", { token, password: "Third-Passphrase-2026" }).expect(401);
    expect(missing.body.error.code).toBe("mfa_code_required");
    await post("/password-reset", { token, password: "Third-Passphrase-2026", code: "000000" }).expect(401);
    await post("/password-reset", { token, password: "Third-Passphrase-2026", code: currentTotp(setup.body.secret) }).expect(204);
  });

  it("requires two-step verification of staff when the organization says so", async () => {
    const admin = (await login(ctx, "admin@signin.ph")).accessToken;
    const org = (await ctx.http().get("/api/v1/organization").set(as(admin)).expect(200)).body;
    await ctx.http().patch("/api/v1/organization").set(as(admin)).send({ name: org.name, staffMfaRequired: true, version: org.version }).expect(200);

    // The admin has no two-step verification either: only account routes answer until it is set up.
    const me = await ctx.http().get("/api/v1/auth/me").set(as(admin)).expect(200);
    expect(me.body).toMatchObject({ staffMfaRequired: true, user: { mfaEnrollmentRequired: true } });
    const refused = await ctx.http().get("/api/v1/users").set(as(admin)).expect(403);
    expect(refused.body.error.code).toBe("mfa_enrollment_required");
    const setup = await ctx.http().post("/api/v1/auth/mfa/setup").set(as(admin)).expect(201);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/confirm")
      .set(as(admin))
      .send({ code: currentTotp(setup.body.secret) })
      .expect(204);
    await ctx.http().get("/api/v1/users").set(as(admin)).expect(200);
    // It cannot be turned off while the organization requires it.
    const off = await ctx
      .http()
      .post("/api/v1/auth/mfa/disable")
      .set(as(admin))
      .send({ password: PASSWORD, code: currentTotp(setup.body.secret) })
      .expect(422);
    expect(off.body.error.code).toBe("mfa_required_by_organization");
    const audit = await auditRows(ctx.pool, `action = 'organization.update'`);
    expect(audit.length).toBeGreaterThan(0);
  });
});
