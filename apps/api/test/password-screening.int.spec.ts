import { BREACHED_PASSWORD_CHECKER, type BreachedPasswordChecker, PasswordCheckUnavailable } from "@healthcare/auth";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, PASSWORD, type Tenant, type TestContext } from "./harness";

const ORG = "screening-org";
const NEW_PASSWORD = "Fresh-Passphrase-2026";

/** Answers as the test says: "accepted", "breached" or "down" (the service unreachable); counts the passwords asked. */
class ScriptedChecker implements BreachedPasswordChecker {
  mode: "accepted" | "breached" | "down" = "accepted";
  calls = 0;
  async isBreached(): Promise<boolean> {
    this.calls += 1;
    if (this.mode === "down") throw new PasswordCheckUnavailable("unreachable");
    return this.mode === "breached";
  }
}

/**
 * Breached-password screening (docs/security/access-control.md): every route that sets a password refuses one found in
 * the breach corpus (422 password_breached) and one that cannot be checked (422 password_check_unavailable), after the
 * caller is verified and before anything is written — a refusal keeps links and activation codes usable and counts
 * no failed attempt.
 */
describe("breached-password screening", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurseId: string;
  const checker = new ScriptedChecker();

  const api = (token?: string) => ({
    post: (url: string, body: object) => {
      const request = ctx.http().post(`/api/v1${url}`);
      return (token ? request.set(as(token, tenant.facilityId)) : request).send(body);
    },
  });
  const refused = async (call: () => Promise<{ status: number; body: { error?: { code: string } } }>, mode: "breached" | "down") => {
    checker.mode = mode;
    const response = await call();
    checker.mode = "accepted";
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe(mode === "breached" ? "password_breached" : "password_check_unavailable");
  };

  beforeAll(async () => {
    ctx = await createTestApp(
      { breachedPasswordChecker: { provide: BREACHED_PASSWORD_CHECKER, useValue: checker } },
      { STAFF_BASE_URL: "https://staff.test.invalid/", PORTAL_BASE_URL: "https://myhealth.test.invalid/" },
    );
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@screening.ph", ["org_admin"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@screening.ph", ["nurse"]);
    admin = (await login(ctx, "admin@screening.ph")).accessToken;
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    checker.mode = "accepted";
  });

  it("screens a staff member's own new password after the current one is confirmed", async () => {
    const nurse = (await login(ctx, "nurse@screening.ph")).accessToken;
    const change = (currentPassword: string) => api(nurse).post("/auth/password", { currentPassword, newPassword: NEW_PASSWORD });

    const calls = checker.calls;
    checker.mode = "breached";
    await change("Not-The-Password-1").expect(422);
    expect(checker.calls).toBe(calls);

    await refused(() => change(PASSWORD), "breached");
    await refused(() => change(PASSWORD), "down");
    const failures = await auditRows(ctx.pool, `action = 'auth.password.change' AND outcome = 'failure' AND resource_id = $1`, [nurseId]);
    expect(failures.map((row) => row.reason)).toEqual(expect.arrayContaining(["password_breached", "password_check_unavailable"]));
    await ctx.http().post("/api/v1/auth/login").send({ email: "nurse@screening.ph", password: PASSWORD }).expect(200);

    await change(PASSWORD).expect(204);
    await ctx.http().post("/api/v1/auth/login").send({ email: "nurse@screening.ph", password: NEW_PASSWORD }).expect(200);
  });

  it("screens a staff reset link's password only for a usable link, and keeps the link usable after a refusal", async () => {
    const clerkId = await createStaff(ctx.pool, tenant, "clerk@screening.ph", ["receptionist"]);
    await api().post("/auth/password-reset/request", { email: "clerk@screening.ph" }).expect(204);
    const { rows } = await ctx.pool.query<{ variables: { link: string } }>(
      "SELECT variables FROM notification WHERE recipient_user_id = $1 AND template_key = 'staff.password-reset'",
      [clerkId],
    );
    const token = rows[0]!.variables.link.split("#token=")[1]!;

    const calls = checker.calls;
    checker.mode = "breached";
    await api()
      .post("/auth/password-reset", { token: "x".repeat(43), password: NEW_PASSWORD })
      .expect(401);
    expect(checker.calls).toBe(calls);

    await refused(() => api().post("/auth/password-reset", { token, password: NEW_PASSWORD }), "breached");
    await refused(() => api().post("/auth/password-reset", { token, password: NEW_PASSWORD }), "down");
    const link = await ctx.pool.query("SELECT failed_attempts, consumed_at FROM staff_password_reset WHERE user_id = $1", [clerkId]);
    expect(link.rows[0]).toEqual({ failed_attempts: 0, consumed_at: null });
    const failures = await auditRows(ctx.pool, `action = 'auth.password-reset' AND outcome = 'failure' AND resource_id = $1`, [clerkId]);
    expect(failures.map((row) => row.reason).sort()).toEqual(["password_breached", "password_check_unavailable"]);

    await api().post("/auth/password-reset", { token, password: NEW_PASSWORD }).expect(204);
  });

  it("screens the first and temporary passwords an administrator sets", async () => {
    const create = (email: string) => api(admin).post("/users", { email, displayName: "New Member", initialPassword: NEW_PASSWORD });
    await refused(() => create("new@screening.ph"), "breached");
    await refused(() => create("new@screening.ph"), "down");
    expect((await ctx.pool.query("SELECT 1 FROM app_user WHERE email = 'new@screening.ph'")).rowCount).toBe(0);
    await create("new@screening.ph").expect(201);

    // An email that already has an account keeps its own password: nothing to screen.
    const other = await createTenant(ctx.pool, "screening-other");
    await createStaff(ctx.pool, other, "shared@screening.ph", ["nurse"]);
    const calls = checker.calls;
    checker.mode = "breached";
    await create("shared@screening.ph").expect(201);
    expect(checker.calls).toBe(calls);
    checker.mode = "accepted";

    const reset = () => api(admin).post(`/users/${nurseId}/password-reset`, { temporaryPassword: "Temporary-Passphrase-77", reason: "Forgot password" });
    await refused(reset, "breached");
    await refused(reset, "down");
    await reset().expect(200);
  });

  describe("MyHealth", () => {
    let patientId: string;
    let patientNumber: string;
    let birthDate: string;
    let code: string;

    const activate = (activationCode: string, password = NEW_PASSWORD) =>
      api().post("/portal/auth/activate", { organizationCode: ORG, patientNumber, birthDate, activationCode, email: "juan@screening.ph", password });

    beforeAll(async () => {
      patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
      await api(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
      code = (await api(admin).post(`/patients/${patientId}/portal-account/invitations`, {}).expect(201)).body.activationCode;
      const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
        "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
        [patientId],
      );
      patientNumber = rows[0]!.patient_number;
      birthDate = rows[0]!.birth_date;
    });

    it("screens the password at activation once the code is right, keeping the code usable", async () => {
      const calls = checker.calls;
      checker.mode = "breached";
      await activate("AAAAA-AAAAA").expect(401);
      expect(checker.calls).toBe(calls);
      await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0 WHERE patient_id = $1", [patientId]);

      await refused(() => activate(code), "breached");
      await refused(() => activate(code), "down");
      const account = await ctx.pool.query("SELECT status, failed_attempts FROM patient_portal_account WHERE patient_id = $1", [patientId]);
      expect(account.rows[0]).toEqual({ status: "invited", failed_attempts: 0 });
      const failures = await auditRows(ctx.pool, `action = 'portal.activate' AND outcome = 'failure' AND patient_id = $1`, [patientId]);
      expect(failures.map((row) => row.reason)).toEqual(expect.arrayContaining(["password_breached", "password_check_unavailable"]));

      await activate(code).expect(200);
    });

    it("screens a MyHealth reset link's password, keeping the link usable", async () => {
      await api().post("/portal/auth/password-reset/request", { organizationCode: ORG, email: "juan@screening.ph" }).expect(202);
      const { rows } = await ctx.pool.query<{ variables: { link: string } }>(
        "SELECT variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'portal.password-reset'",
        [patientId],
      );
      const token = rows[0]!.variables.link.split("#token=")[1]!;
      const confirm = () => api().post("/portal/auth/password-reset/confirm", { token, birthDate, password: "Patient-Passphrase-88" });

      await refused(confirm, "breached");
      await refused(confirm, "down");
      const link = await ctx.pool.query(
        "SELECT r.failed_attempts, r.consumed_at FROM patient_portal_password_reset r JOIN patient_portal_account a ON a.id = r.account_id WHERE a.patient_id = $1",
        [patientId],
      );
      expect(link.rows[0]).toEqual({ failed_attempts: 0, consumed_at: null });

      await confirm().expect(204);
    });
  });
});
