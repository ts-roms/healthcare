import { currentTotp } from "@healthcare/auth";
import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

describe("authentication", () => {
  let ctx: TestContext;
  let tenant: Tenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "auth-org");
    await createStaff(ctx.pool, tenant, "nurse@example.ph", ["nurse"]);
  });

  afterAll(() => ctx.close());

  it("signs in, exposes the effective permissions and audits the login", async () => {
    const { accessToken } = await login(ctx, "nurse@example.ph");
    const me = await ctx.http().get("/api/v1/auth/me").set(as(accessToken)).expect(200);
    expect(me.body.organization.id).toBe(tenant.organizationId);
    expect(me.body.permissions).toContain("patient.register");
    expect(me.body.permissions).not.toContain("user.manage");
    const [event] = await auditRows(ctx.pool, `action = 'auth.login' AND outcome = 'success'`);
    expect(event).toMatchObject({ actor_type: "user" });
  });

  it("rejects unauthenticated requests with the standard error envelope", async () => {
    const response = await ctx.http().get("/api/v1/patients?q=juan").expect(401);
    expect(response.body.error).toMatchObject({ code: "unauthenticated" });
    expect(response.body.error.requestId).toBeDefined();
    expect(response.headers["x-request-id"]).toBe(response.body.error.requestId);
  });

  it("does not reveal whether an email is registered", async () => {
    const unknown = await ctx.http().post("/api/v1/auth/login").send({ email: "nobody@example.ph", password: PASSWORD }).expect(401);
    const wrong = await ctx.http().post("/api/v1/auth/login").send({ email: "nurse@example.ph", password: "wrong-password-123" }).expect(401);
    expect(unknown.body.error.code).toBe("invalid_credentials");
    expect(wrong.body.error.code).toBe("invalid_credentials");
  });

  it("locks the account after repeated failures, even with the right password", async () => {
    await createStaff(ctx.pool, tenant, "locked@example.ph", ["nurse"]);
    for (let i = 0; i < 5; i++) {
      await ctx.http().post("/api/v1/auth/login").send({ email: "locked@example.ph", password: "wrong-password-123" }).expect(401);
    }
    const response = await ctx.http().post("/api/v1/auth/login").send({ email: "locked@example.ph", password: PASSWORD }).expect(401);
    expect(response.body.error.code).toBe("account_locked");
  });

  it("rotates refresh tokens and revokes the session when an old token is replayed", async () => {
    const first = await login(ctx, "nurse@example.ph");
    const rotated = await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

    // Replaying the rotated-out token signals theft: the whole session ends.
    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(401);
    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await ctx.http().get("/api/v1/auth/me").set(as(rotated.body.accessToken)).expect(401);
    const reuse = await auditRows(ctx.pool, `reason = 'refresh_token_reuse'`);
    expect(reuse).toHaveLength(1);
  });

  it("ends access immediately on logout", async () => {
    const { accessToken } = await login(ctx, "nurse@example.ph");
    await ctx.http().post("/api/v1/auth/logout").set(as(accessToken)).expect(204);
    const response = await ctx.http().get("/api/v1/auth/me").set(as(accessToken)).expect(401);
    expect(response.body.error.code).toBe("session_ended");
  });

  describe("two-step verification", () => {
    let secret: string;
    let recoveryCodes: string[];
    let doctorToken: string;
    const signIn = async () =>
      (await ctx.http().post("/api/v1/auth/login").send({ email: "doctor@example.ph", password: PASSWORD }).expect(200)).body.challengeToken as string;
    const verify = (challengeToken: string, code: string) => ctx.http().post("/api/v1/auth/mfa/verify").send({ challengeToken, code });
    /** Codes work once: forget the last accepted step so the current code is usable again (the clock cannot be moved). */
    const freshCode = async () => {
      await ctx.pool.query(`UPDATE app_user SET mfa_last_used_step = 0, failed_login_count = 0 WHERE email = 'doctor@example.ph'`);
      return currentTotp(secret);
    };

    it("enrolls TOTP MFA with recovery codes and then requires it at sign-in", async () => {
      await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
      doctorToken = (await login(ctx, "doctor@example.ph")).accessToken;
      const setup = await ctx.http().post("/api/v1/auth/mfa/setup").set(as(doctorToken)).expect(201);
      expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      secret = setup.body.secret;
      await ctx.http().post("/api/v1/auth/mfa/confirm").set(as(doctorToken)).send({ code: "000000" }).expect(422);
      const confirmed = await ctx
        .http()
        .post("/api/v1/auth/mfa/confirm")
        .set(as(doctorToken))
        .send({ code: currentTotp(secret) })
        .expect(200);
      recoveryCodes = confirmed.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      expect(recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

      const stored = await ctx.pool.query(`SELECT mfa_secret_encrypted FROM app_user WHERE email = 'doctor@example.ph'`);
      expect(stored.rows[0].mfa_secret_encrypted).not.toContain(secret);
      const hashes = await ctx.pool.query(
        `SELECT code_hash FROM staff_recovery_code r JOIN app_user u ON u.id = r.user_id WHERE u.email = 'doctor@example.ph'`,
      );
      expect(hashes.rows).toHaveLength(10);
      expect(hashes.rows.map((r) => r.code_hash)).not.toContain(recoveryCodes[0]);

      const challenge = await ctx.http().post("/api/v1/auth/login").send({ email: "doctor@example.ph", password: PASSWORD }).expect(200);
      expect(challenge.body).toEqual({ status: "mfa_required", challengeToken: expect.any(String) });
      await verify(challenge.body.challengeToken, "000000").expect(401);
      // The code used to confirm the set-up cannot sign in: each code works once.
      await verify(challenge.body.challengeToken, currentTotp(secret)).expect(401);
      const next = currentTotp(secret, 1);
      const verified = await verify(challenge.body.challengeToken, next).expect(200);
      expect(verified.body.status).toBe("authenticated");
      // Replaying it with a new challenge fails too.
      await verify(await signIn(), next).expect(401);
      // A challenge token is not an access token.
      await ctx.http().get("/api/v1/auth/me").set(as(challenge.body.challengeToken)).expect(401);
      const me = await ctx.http().get("/api/v1/auth/me").set(as(verified.body.accessToken)).expect(200);
      expect(me.body.user).toMatchObject({ mfaEnabled: true, recoveryCodesRemaining: 10 });
    });

    it("signs in with a recovery code, once", async () => {
      await ctx.pool.query(`UPDATE app_user SET failed_login_count = 0 WHERE email = 'doctor@example.ph'`);
      const typed = recoveryCodes[0]!.toLowerCase().replace("-", " ");
      const done = await verify(await signIn(), typed).expect(200);
      await verify(await signIn(), recoveryCodes[0]!).expect(401);
      const me = await ctx.http().get("/api/v1/auth/me").set(as(done.body.accessToken)).expect(200);
      expect(me.body.user.recoveryCodesRemaining).toBe(9);
      const [event] = await auditRows(ctx.pool, `action = 'auth.login' AND metadata->>'method' = 'password+recovery_code'`);
      expect(event?.metadata).toMatchObject({ recoveryCodesLeft: 9 });
    });

    it("renews the recovery codes with the password and an app code; the old ones stop working", async () => {
      await ctx
        .http()
        .post("/api/v1/auth/mfa/recovery-codes")
        .set(as(doctorToken))
        .send({ password: "wrong-password-123", code: await freshCode() })
        .expect(422);
      const renewed = await ctx
        .http()
        .post("/api/v1/auth/mfa/recovery-codes")
        .set(as(doctorToken))
        .send({ password: PASSWORD, code: await freshCode() })
        .expect(200);
      expect(renewed.body.recoveryCodes).toHaveLength(10);
      await verify(await signIn(), recoveryCodes[1]!).expect(401);
      recoveryCodes = renewed.body.recoveryCodes;
      await ctx.pool.query(`UPDATE app_user SET failed_login_count = 0 WHERE email = 'doctor@example.ph'`);
    });

    it("turns off with the password and a recovery code, removing the codes", async () => {
      await ctx.http().post("/api/v1/auth/mfa/disable").set(as(doctorToken)).send({ password: PASSWORD, code: recoveryCodes[2]! }).expect(204);
      const left = await ctx.pool.query(
        `SELECT count(*)::int AS n FROM staff_recovery_code r JOIN app_user u ON u.id = r.user_id WHERE u.email = 'doctor@example.ph'`,
      );
      expect(left.rows[0].n).toBe(0);
      await login(ctx, "doctor@example.ph");
    });
  });

  it("signs out other sessions when the password changes", async () => {
    await createStaff(ctx.pool, tenant, "clerk@example.ph", ["receptionist"]);
    const other = await login(ctx, "clerk@example.ph");
    const current = await login(ctx, "clerk@example.ph");
    await ctx
      .http()
      .post("/api/v1/auth/password")
      .set(as(current.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: "A-Brand-New-Passphrase-7" })
      .expect(204);
    await ctx.http().get("/api/v1/auth/me").set(as(other.accessToken)).expect(401);
    await ctx.http().get("/api/v1/auth/me").set(as(current.accessToken)).expect(200);
  });

  it("asks users with several organizations to choose one", async () => {
    const second = await createTenant(ctx.pool, "second-org");
    await createStaff(ctx.pool, second, "nurse@example.ph", ["nurse"]);
    const response = await ctx.http().post("/api/v1/auth/login").send({ email: "nurse@example.ph", password: PASSWORD }).expect(409);
    expect(response.body.error.code).toBe("organization_selection_required");
    expect(response.body.error.details.organizations).toHaveLength(2);
    const chosen = await login(ctx, "nurse@example.ph", second.organizationId);
    const me = await ctx.http().get("/api/v1/auth/me").set(as(chosen.accessToken)).expect(200);
    expect(me.body.organization.id).toBe(second.organizationId);
  });
});
