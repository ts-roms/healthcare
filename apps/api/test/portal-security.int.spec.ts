import { Test } from "@nestjs/testing";
import { authenticator } from "otplib";
import { CoreModule } from "@healthcare/core";
import { CHANNEL_SENDERS, LoggingSender, NOTIFICATION_QUEUE, NotificationDispatcher, NotificationWorkerModule } from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-sec";
const EMAIL = "juan@sec.ph";
const NEW_EMAIL = "juan.new@sec.ph";

/**
 * MyHealth sign-in security (docs/architecture/portal-app.md, "Email verification", "Two-step verification"): a verified
 * sign-in email (and changing it), authenticator-app codes with recovery codes, replay protection, lockout, and the
 * clinic turning it off for a patient who lost both.
 */
describe("MyHealth email verification and two-step verification", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let patientId: string;
  let birthDate: string;
  let sessionA: string;
  let sessionB: string;
  let secret = "";
  let recoveryCodes: string[] = [];
  let dispatcher: NotificationDispatcher;
  let closeWorker: () => Promise<void>;
  const email = new LoggingSender("email");

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portalPost = (path: string, body: object = {}, token?: string) => {
    const req = ctx.http().post(`/api/v1/portal${path}`);
    return (token ? req.set("Authorization", `Bearer ${token}`) : req).send(body);
  };
  const portalGet = (path: string, token: string) => ctx.http().get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${token}`);
  const signIn = (address = EMAIL) => portalPost("/auth/login", { organizationCode: ORG, email: address, password: PASSWORD });
  const signedIn = async (address = EMAIL) => (await signIn(address).expect(200)).body.accessToken as string;
  const notifications = async (templateKey: string) =>
    (
      await ctx.pool.query<{ id: string; destination: string | null; status: string; variables: Record<string, string> }>(
        "SELECT id, destination, status, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = $2 ORDER BY created_at",
        [patientId, templateKey],
      )
    ).rows;
  const lastCode = async () => (await notifications("portal.email-verification")).at(-1)!.variables["code"]!;
  /** Lets the next email code be asked for at once: the resend cooldown and hourly limit look at these rows. */
  const ageVerifications = () => ctx.pool.query("UPDATE patient_portal_email_verification SET created_at = created_at - interval '2 hours'");
  /** A code the account has not used yet: the last accepted step is set back, then the current code is valid. */
  const freshCode = async () => {
    await ctx.pool.query("UPDATE patient_portal_account SET mfa_last_used_step = 0 WHERE patient_id = $1 AND mfa_enabled", [patientId]);
    return authenticator.generate(secret);
  };
  const accountRow = async () =>
    (
      await ctx.pool.query<{
        failed_attempts: number;
        locked_until: Date | null;
        mfa_enabled: boolean;
        email_verified_at: Date | null;
        mfa_last_used_step: string | null;
      }>("SELECT failed_attempts, locked_until, mfa_enabled, email_verified_at, mfa_last_used_step FROM patient_portal_account WHERE patient_id = $1", [
        patientId,
      ])
    ).rows[0]!;

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: "https://myhealth.test.invalid" });
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@sec.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "pharm@sec.ph", ["pharmacist"]);
    admin = (await login(ctx, "admin@sec.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    birthDate = rows[0]!.birth_date;
    sessionA = (
      await portalPost("/auth/activate", {
        organizationCode: ORG,
        patientNumber: rows[0]!.patient_number,
        birthDate,
        activationCode: code,
        email: EMAIL,
        password: PASSWORD,
      }).expect(200)
    ).body.accessToken;
    sessionB = await signedIn();

    const worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        NotificationWorkerModule.forRoot({
          autoStart: false,
          queue: { provide: NOTIFICATION_QUEUE, useValue: ctx.queue },
          senders: { provide: CHANNEL_SENDERS, useValue: [email, new LoggingSender("sms")] },
        }),
      ],
    }).compile();
    dispatcher = underPlatform(worker.get(NotificationDispatcher));
    closeWorker = () => worker.close();
  });
  afterAll(async () => {
    await closeWorker();
    await ctx.close();
  });

  describe("email verification", () => {
    it("starts unverified, and two-step verification waits for a verified email", async () => {
      expect((await portalGet("/email", sessionB).expect(200)).body).toMatchObject({ email: EMAIL, verified: false, pending: null });
      expect((await portalGet("/me", sessionB).expect(200)).body.account).toMatchObject({ email: EMAIL, emailVerified: false, mfaEnabled: false });
      await portalPost("/mfa/setup", { password: PASSWORD }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("email_not_verified"));
    });

    it("sends a six-digit code to the sign-in email, stores only its hash, and limits resending", async () => {
      const sent = await portalPost("/email/verification", {}, sessionB).expect(202);
      expect(sent.body).toEqual({ sentTo: "j***@sec.ph", validMinutes: 15 });
      const [queued] = await notifications("portal.email-verification");
      expect(queued).toMatchObject({ destination: EMAIL, status: "queued" });
      const code = await lastCode();
      expect(code).toMatch(/^\d{6}$/);
      const { rows } = await ctx.pool.query<{ code_hash: string }>("SELECT code_hash FROM patient_portal_email_verification");
      expect(rows[0]!.code_hash).not.toContain(code);

      await portalPost("/email/verification", {}, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("verification_too_soon"));
      expect((await portalGet("/email", sessionB).expect(200)).body.pending).toMatchObject({ emailMasked: "j***@sec.ph", isChange: false });

      await expect(dispatcher.dispatch(queued!.id)).resolves.toBe("sent");
      expect(email.sent.at(-1)!.message.text).toContain(code);
      expect((await notifications("portal.email-verification"))[0]!.variables["code"]).toBe("[removed]");
    });

    it("keeps the patient signed in on a wrong code, and burns the code after five", async () => {
      const wrong = (await lastCodeOrBlank()) === "000000" ? "111111" : "000000";
      await ageVerifications();
      await portalPost("/email/verification", {}, sessionB).expect(202);
      const code = await lastCode();
      const bad = code === wrong ? "222222" : wrong;
      await portalPost("/email/verification/confirm", { code: bad }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_verification_code"));
      await portalGet("/me", sessionB).expect(200);
      for (let i = 0; i < 4; i++) await portalPost("/email/verification/confirm", { code: bad }, sessionB).expect(422);
      await portalPost("/email/verification/confirm", { code }, sessionB).expect(422);
      const { rows } = await ctx.pool.query<{ consumed_reason: string }>(
        "SELECT consumed_reason FROM patient_portal_email_verification WHERE consumed_reason = 'exhausted'",
      );
      expect(rows).toHaveLength(1);
      await portalPost("/email/verification/confirm", { code: "12345" }, sessionB).expect(400);
    });

    it("verifies the email with the right code, once", async () => {
      await ageVerifications();
      await portalPost("/email/verification", {}, sessionB).expect(202);
      const code = await lastCode();
      expect((await portalPost("/email/verification/confirm", { code }, sessionB).expect(200)).body).toEqual({ email: EMAIL, changed: false });
      expect((await portalGet("/email", sessionB).expect(200)).body).toMatchObject({ verified: true, pending: null });
      await portalPost("/email/verification/confirm", { code }, sessionB).expect(422);
      await portalPost("/email/verification", {}, sessionB)
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("email_already_verified"));
      const audit = await auditRows(ctx.pool, "action = 'portal.email-verify' AND outcome = 'success'");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_type).toBe("patient");
    });

    it("changes the email only after the new address proves itself, ends other sessions and tells the old address", async () => {
      await portalPost("/email/change", { newEmail: NEW_EMAIL, password: "wrong-password-123" }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_credentials"));
      await portalPost("/email/change", { newEmail: EMAIL, password: PASSWORD }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("email_unchanged"));
      await ageVerifications();
      await portalPost("/email/change", { newEmail: NEW_EMAIL, password: PASSWORD }, sessionB).expect(202);
      const [latest] = (await notifications("portal.email-verification")).slice(-1);
      expect(latest!.destination).toBe(NEW_EMAIL);
      // Nothing changed yet.
      expect((await portalGet("/email", sessionB).expect(200)).body).toMatchObject({
        email: EMAIL,
        verified: true,
        pending: { isChange: true, emailMasked: "j***@sec.ph" },
      });
      await signIn(NEW_EMAIL).expect(401);

      const code = await lastCode();
      expect((await portalPost("/email/verification/confirm", { code }, sessionB).expect(200)).body).toEqual({ email: NEW_EMAIL, changed: true });
      await signIn(EMAIL).expect(401);
      await signIn(NEW_EMAIL).expect(200);
      await portalGet("/me", sessionB).expect(200);
      await portalGet("/me", sessionA).expect(401);
      const alerts = await notifications("portal.security-alert");
      expect(alerts.at(-1)).toMatchObject({ destination: EMAIL, status: "queued" });
      expect(alerts.at(-1)!.variables).toMatchObject({ event: "email_changed" });
      expect((await portalGet("/email", sessionB).expect(200)).body.email).toBe(NEW_EMAIL);
    });

    it("cannot be sent through the notification endpoint", async () => {
      for (const templateKey of ["portal.email-verification", "portal.security-alert"]) {
        await staff(admin)
          .post("/notifications", { recipient: { type: "patient", patientId }, channel: "email", templateKey, variables: {} })
          .expect(422)
          .expect((r) => expect(r.body.error.code).toBe("unknown_template"));
      }
    });
  });

  describe("two-step verification", () => {
    const enableUrl = "/mfa/enable";

    it("needs the password to start, then a code from the app to turn on, and shows recovery codes once", async () => {
      await portalPost("/mfa/setup", { password: "wrong-password-123" }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_credentials"));
      const setup = (await portalPost("/mfa/setup", { password: PASSWORD }, sessionB).expect(200)).body as {
        secret: string;
        setupKey: string;
        otpauthUri: string;
      };
      secret = setup.secret;
      expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/.+secret=/);
      expect(setup.setupKey.replace(/ /g, "")).toBe(secret);
      // Sealed at rest.
      const { rows } = await ctx.pool.query<{ mfa_pending_secret_encrypted: string }>(
        "SELECT mfa_pending_secret_encrypted FROM patient_portal_account WHERE patient_id = $1",
        [patientId],
      );
      expect(rows[0]!.mfa_pending_secret_encrypted).not.toContain(secret);

      await portalPost(enableUrl, { code: "000000" }, sessionB).expect(422);
      const enabled = (await portalPost(enableUrl, { code: authenticator.generate(secret) }, sessionB).expect(200)).body as { recoveryCodes: string[] };
      recoveryCodes = enabled.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const c of recoveryCodes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect((await portalGet("/mfa", sessionB).expect(200)).body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10, emailVerified: true });
      const stored = await ctx.pool.query<{ code_hash: string }>("SELECT code_hash FROM patient_portal_recovery_code");
      expect(stored.rows).toHaveLength(10);
      expect(JSON.stringify(stored.rows)).not.toContain(recoveryCodes[0]!.replace("-", ""));
      expect((await notifications("portal.security-alert")).at(-1)!.variables).toMatchObject({ event: "mfa_enabled" });
      await portalPost("/mfa/setup", { password: PASSWORD }, sessionB).expect(409);
    });

    it("asks for the second step after the password, and gives nothing away before it", async () => {
      await signIn(EMAIL).expect(401);
      const wrongPassword = await portalPost("/auth/login", { organizationCode: ORG, email: NEW_EMAIL, password: "not-the-password-1" }).expect(401);
      expect(wrongPassword.body).not.toHaveProperty("challengeToken");
      const challenge = (await signIn(NEW_EMAIL).expect(200)).body as { status: string; challengeToken: string; accessToken?: string };
      expect(challenge).toMatchObject({ status: "mfa_required" });
      expect(challenge.accessToken).toBeUndefined();
      // A challenge is not a session, and a session is not a challenge.
      await portalGet("/me", challenge.challengeToken).expect(401);
      await portalPost("/auth/mfa/verify", { challengeToken: sessionB, code: authenticator.generate(secret) }).expect(401);
      await portalPost("/auth/mfa/verify", { challengeToken: "x".repeat(30), code: "123456" }).expect(401);
    });

    it("finishes signing in with a code, and refuses a code that was already used", async () => {
      const challengeToken = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      // The code that turned it on is spent (same time step), and so is any older one.
      await portalPost("/auth/mfa/verify", { challengeToken, code: authenticator.generate(secret) }).expect(401);
      const next = authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);
      const done = await portalPost("/auth/mfa/verify", { challengeToken, code: next }).expect(200);
      expect(done.body).toMatchObject({ status: "authenticated" });
      await portalGet("/me", done.body.accessToken).expect(200);
      // Replay of the same code with a new challenge.
      const again = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      await portalPost("/auth/mfa/verify", { challengeToken: again, code: next }).expect(401);
      const audit = await auditRows(ctx.pool, "action = 'portal.login' AND outcome = 'success'");
      expect(audit.at(-1)!.metadata).toMatchObject({ method: "password+totp" });
    });

    it("counts wrong codes toward the lockout", async () => {
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
      const challengeToken = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      for (let i = 0; i < 4; i++) await portalPost("/auth/mfa/verify", { challengeToken, code: "000000" }).expect(401);
      expect((await accountRow()).failed_attempts).toBe(4);
      await portalPost("/auth/mfa/verify", { challengeToken, code: "000000" }).expect(401);
      expect((await accountRow()).locked_until).not.toBeNull();
      await portalPost("/auth/mfa/verify", { challengeToken, code: await freshCode() })
        .expect(401)
        .expect((r) => expect(r.body.error.code).toBe("account_locked"));
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
    });

    it("signs in with a recovery code, once, and tells the email", async () => {
      const challengeToken = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      const recovery = recoveryCodes[0]!;
      const done = await portalPost("/auth/mfa/verify", { challengeToken, code: recovery.toLowerCase().replace("-", " ") }).expect(200);
      expect(done.body.status).toBe("authenticated");
      await portalPost("/auth/mfa/verify", { challengeToken, code: recovery }).expect(401);
      expect((await portalGet("/mfa", done.body.accessToken).expect(200)).body.recoveryCodesRemaining).toBe(9);
      const alert = (await notifications("portal.security-alert")).at(-1)!;
      expect(alert.variables).toMatchObject({ event: "recovery_code_used", detail: "9" });
      const audit = await auditRows(ctx.pool, "action = 'portal.login' AND outcome = 'success'");
      expect(audit.at(-1)!.metadata).toMatchObject({ method: "password+recovery_code" });
      sessionB = done.body.accessToken;
    });

    it("needs the authenticator code to change the email, and makes new recovery codes with the password and the app's code", async () => {
      await ageVerifications();
      await portalPost("/email/change", { newEmail: "third@sec.ph", password: PASSWORD }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("mfa_code_required"));
      await portalPost("/email/change", { newEmail: "third@sec.ph", password: PASSWORD, code: "000000" }, sessionB)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_mfa_code"));

      await portalPost("/mfa/recovery-codes", { password: PASSWORD, code: recoveryCodes[1]! }, sessionB).expect(422);
      const renewed = (await portalPost("/mfa/recovery-codes", { password: PASSWORD, code: await freshCode() }, sessionB).expect(200)).body as {
        recoveryCodes: string[];
      };
      expect(renewed.recoveryCodes).toHaveLength(10);
      const challengeToken = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      await portalPost("/auth/mfa/verify", { challengeToken, code: recoveryCodes[1]! }).expect(401);
      recoveryCodes = renewed.recoveryCodes;
      expect((await notifications("portal.security-alert")).at(-1)!.variables).toMatchObject({ event: "recovery_codes_renewed" });
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
    });

    it("keeps two-step verification through a password reset", async () => {
      // A reset changes the password only; the second step is still asked.
      await portalPost("/auth/password-reset/request", { organizationCode: ORG, email: NEW_EMAIL }).expect(202);
      const [reset] = (await notifications("portal.password-reset")).slice(-1);
      const token = reset!.variables["link"]!.split("#token=")[1]!;
      await portalPost("/auth/password-reset/confirm", { token, birthDate, password: PASSWORD }).expect(204);
      expect((await signIn(NEW_EMAIL).expect(200)).body.status).toBe("mfa_required");
      expect((await accountRow()).mfa_enabled).toBe(true);
      // The reset ended every session: sign in again to carry on.
      const challengeToken = (await signIn(NEW_EMAIL).expect(200)).body.challengeToken as string;
      const done = await portalPost("/auth/mfa/verify", { challengeToken, code: await freshCode() }).expect(200);
      sessionB = done.body.accessToken;
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
    });

    it("turns off with the password and a current code, and signing in is direct again", async () => {
      await portalPost("/mfa/disable", { password: "wrong-password-123", code: await freshCode() }, sessionB).expect(422);
      await portalPost("/mfa/disable", { password: PASSWORD, code: "000000" }, sessionB).expect(422);
      await portalPost("/mfa/disable", { password: PASSWORD, code: await freshCode() }, sessionB).expect(204);
      expect((await portalGet("/mfa", sessionB).expect(200)).body).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
      expect((await ctx.pool.query("SELECT 1 FROM patient_portal_recovery_code")).rowCount).toBe(0);
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
      expect((await signIn(NEW_EMAIL).expect(200)).body.status).toBe("authenticated");
      expect((await notifications("portal.security-alert")).at(-1)!.variables).toMatchObject({ event: "mfa_disabled" });
      await portalPost("/mfa/disable", { password: PASSWORD, code: "123456" }, sessionB).expect(422);
    });

    it("is turned off by the clinic for a patient who lost the app and the codes, ending every session", async () => {
      const setup = (await portalPost("/mfa/setup", { password: PASSWORD }, sessionB).expect(200)).body as { secret: string };
      secret = setup.secret;
      await portalPost(enableUrl, { code: authenticator.generate(secret) }, sessionB).expect(200);
      expect((await staff(admin).get(`/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({ mfaEnabled: true, emailVerified: true });

      const pharmacist = (await login(ctx, "pharm@sec.ph")).accessToken;
      await staff(pharmacist)
        .post(`/patients/${patientId}/portal-account/mfa-reset`, { reason: "Patient lost phone" })
        .expect((r) => expect([403, 404]).toContain(r.status));
      await staff(admin).post(`/patients/${patientId}/portal-account/mfa-reset`, { reason: "abc" }).expect(400);
      await staff(admin).post(`/patients/${patientId}/portal-account/mfa-reset`, { reason: "Patient lost phone; identity checked at the desk" }).expect(204);

      await portalGet("/me", sessionB).expect(401);
      expect((await accountRow()).mfa_enabled).toBe(false);
      expect((await signIn(NEW_EMAIL).expect(200)).body.status).toBe("authenticated");
      expect((await staff(admin).get(`/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({ mfaEnabled: false });
      await staff(admin).post(`/patients/${patientId}/portal-account/mfa-reset`, { reason: "Patient lost phone again" }).expect(422);
      const audit = await auditRows(ctx.pool, "action = 'patient.portal-mfa-reset'");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.reason).toBe("Patient lost phone; identity checked at the desk");
      expect((await notifications("portal.security-alert")).at(-1)!.variables).toMatchObject({ event: "mfa_reset_by_clinic" });
    });

    it("cannot be on without a verified email, in the database", async () => {
      await expect(
        ctx.pool.query("UPDATE patient_portal_account SET mfa_enabled = true, mfa_secret_encrypted = 'x', email_verified_at = NULL WHERE patient_id = $1", [
          patientId,
        ]),
      ).rejects.toThrow(/patient_portal_account_mfa_verified_email/);
      await expect(
        ctx.pool.query("UPDATE patient_portal_account SET mfa_enabled = true, mfa_secret_encrypted = NULL WHERE patient_id = $1", [patientId]),
      ).rejects.toThrow(/patient_portal_account_mfa_secret/);
    });
  });

  async function lastCodeOrBlank() {
    return (await notifications("portal.email-verification")).at(-1)?.variables["code"] ?? "";
  }
});
