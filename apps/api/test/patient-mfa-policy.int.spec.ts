import { authenticator } from "otplib";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-mfa-policy";
const EMAIL = "juan@mfa-policy.ph";

/** Local (Asia/Manila) calendar day `days` from now as YYYY-MM-DD. */
const manilaDate = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

/**
 * MyHealth sign-in security, D6 phase 1 (docs/architecture/portal-app.md, "Two-step verification"; migration 0100):
 * an organization requiring two-step verification of patients from a date with notice, the enrollment gate, and
 * browsers remembered after the second step.
 */
describe("patient two-step verification policy and trusted devices", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let patientId: string;
  let session: string;
  let secret = "";

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portalPost = (path: string, body: object = {}, token?: string) => {
    const req = ctx.http().post(`/api/v1/portal${path}`);
    return (token ? req.set("Authorization", `Bearer ${token}`) : req).send(body);
  };
  const portalGet = (path: string, token: string, headers: Record<string, string> = {}) =>
    ctx.http().get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${token}`).set(headers);
  const signIn = (extra: object = {}) => portalPost("/auth/login", { organizationCode: ORG, email: EMAIL, password: PASSWORD, ...extra });
  /** A code the account has not used yet. */
  const freshCode = async () => {
    await ctx.pool.query("UPDATE patient_portal_account SET mfa_last_used_step = 0 WHERE patient_id = $1 AND mfa_enabled", [patientId]);
    return authenticator.generate(secret);
  };
  const devices = async () =>
    (await ctx.pool.query<{ revoked_reason: string | null }>("SELECT revoked_reason FROM patient_trusted_device ORDER BY created_at")).rows;
  const activeDevices = async () => (await devices()).filter((d) => d.revoked_reason === null).length;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@mfa-policy.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@mfa-policy.ph", ["nurse"]);
    admin = (await login(ctx, "admin@mfa-policy.ph")).accessToken;
    nurse = (await login(ctx, "nurse@mfa-policy.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    session = (
      await portalPost("/auth/activate", {
        organizationCode: ORG,
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: EMAIL,
        password: PASSWORD,
      }).expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  describe("the organization's policy", () => {
    it("is off by default, needs a week's notice to turn on, and is versioned and audited", async () => {
      expect((await staff(admin).get("/security/patient-mfa-policy").expect(200)).body).toMatchObject({
        required: false,
        requiredFrom: null,
        version: 0,
        updatedBy: null,
        accounts: { active: 1, withMfa: 0, withoutMfa: 1 },
      });
      await staff(nurse).get("/security/patient-mfa-policy").expect(403);
      await staff(nurse)
        .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(10), version: 0 })
        .expect(403);

      const atOnce = await staff(admin).put("/security/patient-mfa-policy", { required: true, version: 0 }).expect(422);
      expect(atOnce.body.error.code).toBe("notice_required");
      expect(atOnce.body.error.details).toEqual({ earliest: manilaDate(7) });
      await staff(admin)
        .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(3), version: 0 })
        .expect(422);

      const on = await staff(admin)
        .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(7), version: 0, reason: "Privacy review" })
        .expect(200);
      expect(on.body).toMatchObject({ required: true, requiredFrom: manilaDate(7), version: 1, updatedBy: { displayName: "admin@mfa-policy.ph" } });
      const stale = await staff(admin).put("/security/patient-mfa-policy", { required: false, version: 0 }).expect(409);
      expect(stale.body.error.code).toBe("version_conflict");
      const [event] = await auditRows(ctx.pool, "action = 'portal.mfa-policy.update'");
      expect(event).toMatchObject({ outcome: "success", reason: "Privacy review" });
      const { rows } = await ctx.pool.query<{ changes: Record<string, unknown> }>("SELECT changes FROM audit_event WHERE action = 'portal.mfa-policy.update'");
      expect(rows[0]!.changes).toMatchObject({ required: { from: false, to: true }, requiredFrom: { from: null, to: manilaDate(7) } });
    });

    it("warns the patient before the date and gates everything but set-up and sign-out from it", async () => {
      const before = await portalGet("/me", session).expect(200);
      expect(before.body.mfaPolicy).toEqual({ required: true, requiredFrom: manilaDate(7), enrollmentRequired: false });
      await portalGet("/consents", session).expect(200);

      // The date is moved to today: already required, so no further notice is needed.
      await staff(admin)
        .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(0), version: 1 })
        .expect(200);
      const gated = await portalGet("/me", session).expect(200);
      expect(gated.body.mfaPolicy).toEqual({ required: true, requiredFrom: manilaDate(0), enrollmentRequired: true });
      for (const path of ["/consents", "/results", "/mfa/devices"]) {
        const refused = await portalGet(path, session);
        if (path === "/mfa/devices") expect(refused.status).toBe(200);
        else {
          expect(refused.status).toBe(403);
          expect(refused.body.error.code).toBe("mfa_enrollment_required");
        }
      }
      await portalGet("/mfa", session).expect(200);
      await portalGet("/email", session).expect(200);

      // Set-up stays open (the email was verified at the clinic's desk here); once it is on, everything opens.
      await ctx.pool.query("UPDATE patient_portal_account SET email_verified_at = now() WHERE patient_id = $1", [patientId]);
      secret = (await portalPost("/mfa/setup", { password: PASSWORD }, session).expect(200)).body.secret;
      await portalPost("/mfa/enable", { code: authenticator.generate(secret) }, session).expect(200);
      expect((await portalGet("/me", session).expect(200)).body.mfaPolicy.enrollmentRequired).toBe(false);
      await portalGet("/consents", session).expect(200);
      expect((await staff(admin).get("/security/patient-mfa-policy").expect(200)).body.accounts).toEqual({ active: 1, withMfa: 1, withoutMfa: 0 });
    });
  });

  describe("trusted devices", () => {
    let deviceToken = "";

    it("remembers the browser after a correct code, and that browser then signs in with the password alone", async () => {
      const challengeToken = (await signIn().expect(200)).body.challengeToken as string;
      const done = await portalPost("/auth/mfa/verify", { challengeToken, code: await freshCode(), rememberDevice: true }).expect(200);
      expect(done.body).toMatchObject({ status: "authenticated" });
      deviceToken = done.body.deviceToken;
      expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(new Date(done.body.deviceTokenExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      const stored = await ctx.pool.query<{ token_hash: string; label: string }>("SELECT token_hash, label FROM patient_trusted_device");
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]!.token_hash).not.toBe(deviceToken);
      expect(stored.rows[0]!.label.length).toBeLessThanOrEqual(80);

      const direct = await signIn({ deviceToken }).expect(200);
      expect(direct.body).toMatchObject({ status: "authenticated" });
      expect(direct.body.challengeToken).toBeUndefined();
      const audit = await auditRows(ctx.pool, "action = 'portal.login' AND outcome = 'success'");
      expect(audit.at(-1)!.metadata).toMatchObject({ method: "password+trusted_device" });
      // A wrong password is still a wrong password, and an unknown token just asks for the code.
      await portalPost("/auth/login", { organizationCode: ORG, email: EMAIL, password: "not-the-password-1", deviceToken }).expect(401);
      expect((await signIn({ deviceToken: "x".repeat(43) }).expect(200)).body.status).toBe("mfa_required");

      const list = (await portalGet("/mfa/devices", direct.body.accessToken, { "X-Device-Token": deviceToken }).expect(200)).body as { current: boolean }[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ current: true });
      expect(JSON.stringify(list)).not.toContain(deviceToken);
    });

    it("keeps at most five, forgets one or all, and ignores an expired one", async () => {
      const trust = async () => {
        const challengeToken = (await signIn().expect(200)).body.challengeToken as string;
        return (await portalPost("/auth/mfa/verify", { challengeToken, code: await freshCode(), rememberDevice: true }).expect(200)).body as {
          accessToken: string;
          deviceToken: string;
        };
      };
      const tokens = [deviceToken];
      let last: { accessToken: string; deviceToken: string } | undefined;
      for (let i = 0; i < 5; i++) {
        await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
        last = await trust();
        tokens.push(last.deviceToken);
      }
      expect(await activeDevices()).toBe(5);
      expect((await devices()).filter((d) => d.revoked_reason === "replaced")).toHaveLength(1);
      // The first (oldest) one was replaced.
      expect((await signIn({ deviceToken: tokens[0] }).expect(200)).body.status).toBe("mfa_required");

      const list = (await portalGet("/mfa/devices", last!.accessToken, { "X-Device-Token": last!.deviceToken }).expect(200)).body as {
        id: string;
        current: boolean;
      }[];
      expect(list).toHaveLength(5);
      const other = list.find((d) => !d.current)!;
      await portalPost(`/mfa/devices/${other.id}/forget`, {}, last!.accessToken).expect(204);
      await portalPost(`/mfa/devices/${other.id}/forget`, {}, last!.accessToken).expect(404);
      expect(await activeDevices()).toBe(4);

      // Thirty days on: the device was remembered a month ago.
      await ctx.pool.query(
        "UPDATE patient_trusted_device SET created_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE token_hash = encode(sha256($1::bytea), 'hex')",
        [tokens[5]!],
      );
      expect((await signIn({ deviceToken: tokens[5] }).expect(200)).body.status).toBe("mfa_required");
      expect((await portalGet("/mfa/devices", last!.accessToken).expect(200)).body).toHaveLength(3);

      // The expired one is closed with the rest.
      expect((await portalPost("/mfa/devices/forget-all", {}, last!.accessToken).expect(200)).body).toEqual({ forgotten: 4 });
      expect(await activeDevices()).toBe(0);
      expect((await auditRows(ctx.pool, "action = 'portal.device-forget'")).length).toBe(2);
      expect((await auditRows(ctx.pool, "action = 'portal.device-trust'")).length).toBe(6);
    });

    it("forgets every browser when two-step verification is turned off or reset", async () => {
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
      const challengeToken = (await signIn().expect(200)).body.challengeToken as string;
      const done = (await portalPost("/auth/mfa/verify", { challengeToken, code: await freshCode(), rememberDevice: true }).expect(200)).body;
      expect(await activeDevices()).toBe(1);
      await portalPost("/mfa/disable", { password: PASSWORD, code: await freshCode() }, done.accessToken).expect(204);
      expect(await activeDevices()).toBe(0);
      expect((await devices()).at(-1)!.revoked_reason).toBe("mfa_disabled");
      // The policy is still on: the account is back behind the gate until it is set up again.
      await portalGet("/consents", done.accessToken).expect(403);

      secret = (await portalPost("/mfa/setup", { password: PASSWORD }, done.accessToken).expect(200)).body.secret;
      await portalPost("/mfa/enable", { code: authenticator.generate(secret) }, done.accessToken).expect(200);
      const again = (await signIn().expect(200)).body.challengeToken as string;
      await portalPost("/auth/mfa/verify", { challengeToken: again, code: await freshCode(), rememberDevice: true }).expect(200);
      expect(await activeDevices()).toBe(1);
      await staff(admin).post(`/patients/${patientId}/portal-account/mfa-reset`, { reason: "Patient lost phone; identity checked at the desk" }).expect(204);
      expect(await activeDevices()).toBe(0);
      expect((await devices()).at(-1)!.revoked_reason).toBe("mfa_reset");

      await staff(admin).put("/security/patient-mfa-policy", { required: false, version: 2 }).expect(200);
      expect((await staff(admin).get("/security/patient-mfa-policy").expect(200)).body).toMatchObject({ required: false, requiredFrom: null, version: 3 });
    });
  });
});
