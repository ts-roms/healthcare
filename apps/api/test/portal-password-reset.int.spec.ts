import { Test } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import { CHANNEL_SENDERS, LoggingSender, NOTIFICATION_QUEUE, NotificationDispatcher, NotificationWorkerModule } from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const OLD_PASSWORD = "Pahintulot-ko-2026";
const NEW_PASSWORD = "Bagong-sikreto-2026";
const ORG = "myhealth-reset";
const EMAIL = "juan@reset.ph";

/**
 * MyHealth password reset (docs/architecture/portal-app.md, "Password reset"): a link by email, a single-use short-lived
 * token, the patient's date of birth, the same answer whether or not an account exists, and every session ended.
 */
describe("MyHealth password reset", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let patientId: string;
  let birthDate: string;
  let accessToken: string;
  let dispatcher: NotificationDispatcher;
  let closeWorker: () => Promise<void>;
  const email = new LoggingSender("email");

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (path: string, body: object) => ctx.http().post(`/api/v1/portal${path}`).send(body);
  const signIn = (password: string, address = EMAIL) => portal("/auth/login", { organizationCode: ORG, email: address, password });
  const askForLink = (address = EMAIL) => portal("/auth/password-reset/request", { organizationCode: ORG, email: address });
  const confirm = (token: string, password = NEW_PASSWORD, date = birthDate) => portal("/auth/password-reset/confirm", { token, birthDate: date, password });
  const messages = async (templateKey: string) =>
    (
      await ctx.pool.query<{ id: string; status: string; destination: string | null; variables: { link?: string } }>(
        "SELECT id, status, destination, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = $2 ORDER BY created_at",
        [patientId, templateKey],
      )
    ).rows;
  const latestToken = async () => {
    const rows = await messages("portal.password-reset");
    const link = rows[rows.length - 1]!.variables.link!;
    expect(link).toMatch(/^https:\/\/myhealth\.test\.invalid\/reset-password#token=[\w-]{20,}$/);
    return link.split("#token=")[1]!;
  };
  /** Ages every issued link, so the hourly limit and the current link no longer count. */
  const agePastHour = () => ctx.pool.query("UPDATE patient_portal_password_reset SET created_at = created_at - interval '2 hours'");

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: "https://myhealth.test.invalid/" });
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@reset.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@reset.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    birthDate = rows[0]!.birth_date;
    accessToken = (
      await portal("/auth/activate", {
        organizationCode: ORG,
        patientNumber: rows[0]!.patient_number,
        birthDate,
        activationCode: code,
        email: EMAIL,
        password: OLD_PASSWORD,
      }).expect(200)
    ).body.accessToken;

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
    dispatcher = worker.get(NotificationDispatcher);
    closeWorker = () => worker.close();
  });
  afterAll(async () => {
    await closeWorker();
    await ctx.close();
  });

  it("gives the same answer whether or not an account exists, and sends nothing for one that does not", async () => {
    const known = await askForLink().expect(202);
    const unknown = await askForLink("nobody@reset.ph").expect(202);
    const otherClinic = await portal("/auth/password-reset/request", { organizationCode: "no-such-clinic", email: EMAIL }).expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(otherClinic.body).toEqual(known.body);
    expect(await messages("portal.password-reset")).toHaveLength(1);
    const failures = await auditRows(ctx.pool, "action = 'portal.password-reset-request' AND outcome = 'failure'");
    expect(failures.map((f) => f.reason)).toEqual(["unknown_account", "unknown_account"]);
    await portal("/auth/password-reset/request", { organizationCode: ORG, email: "not-an-email" }).expect(400);
  });

  it("emails the link to the sign-in email, keeps only the token's hash, and blanks the stored link once sent", async () => {
    const [queued] = await messages("portal.password-reset");
    expect(queued).toMatchObject({ status: "queued", destination: EMAIL });
    const token = await latestToken();

    const { rows } = await ctx.pool.query<{ token_hash: string }>("SELECT token_hash FROM patient_portal_password_reset");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);

    await expect(dispatcher.dispatch(queued!.id)).resolves.toBe("sent");
    expect(email.sent.at(-1)!.destination).toBe(EMAIL);
    expect(email.sent.at(-1)!.message.text).toContain(`#token=${token}`);
    expect(email.sent.at(-1)!.message.text).toContain("date of birth");
    const [after] = await messages("portal.password-reset");
    expect(after!.variables.link).toBe("[removed]");
    expect(JSON.stringify(after)).not.toContain(token);
  });

  it("is not something staff can send through the notification endpoint", async () => {
    await staff(admin)
      .post("/notifications", {
        recipient: { type: "patient", patientId },
        channel: "email",
        templateKey: "portal.password-reset",
        variables: { organizationName: "Demo", link: "https://evil.example/reset", validMinutes: 30 },
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("unknown_template"));
  });

  it("refuses a wrong date of birth, keeps the link for the patient, and burns it after five", async () => {
    await agePastHour();
    await askForLink().expect(202);
    const token = await latestToken();
    await confirm(token, NEW_PASSWORD, "1990-01-01")
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("invalid_reset"));
    for (let i = 0; i < 3; i++) await confirm(token, NEW_PASSWORD, "1990-01-01").expect(401);
    await confirm(token, NEW_PASSWORD, "1990-01-02").expect(401);
    // Burned: even the right date no longer works.
    await confirm(token).expect(401);
    const { rows } = await ctx.pool.query<{ consumed_reason: string }>(
      "SELECT consumed_reason FROM patient_portal_password_reset WHERE consumed_reason = 'exhausted'",
    );
    expect(rows).toHaveLength(1);
    await signIn(OLD_PASSWORD).expect(200);
  });

  it("refuses an unknown, expired or superseded link, and a weak password", async () => {
    await confirm("x".repeat(43)).expect(401);
    await agePastHour();
    await askForLink().expect(202);
    const first = await latestToken();
    await ctx.pool.query("UPDATE patient_portal_password_reset SET expires_at = now() - interval '1 minute' WHERE consumed_at IS NULL");
    await confirm(first).expect(401);

    await agePastHour();
    await askForLink().expect(202);
    const older = await latestToken();
    await askForLink().expect(202);
    const newer = await latestToken();
    expect(newer).not.toBe(older);
    await confirm(older).expect(401);
    await confirm(newer, "short").expect(400);
    await agePastHour();
    await askForLink().expect(202);
  });

  it("chooses a new password, ends every session, clears a lockout, and works once", async () => {
    const token = await latestToken();
    await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 3, locked_until = now() + interval '10 minutes' WHERE patient_id = $1", [
      patientId,
    ]);
    await confirm(token).expect(204);

    await signIn(OLD_PASSWORD).expect(401);
    await signIn(NEW_PASSWORD).expect(200);
    // The session from before the reset ended.
    await ctx.http().get("/api/v1/portal/me").set("Authorization", `Bearer ${accessToken}`).expect(401);
    const { rows } = await ctx.pool.query<{ revoked_reason: string | null }>(
      "SELECT s.revoked_reason FROM patient_portal_session s JOIN patient_portal_account a ON a.id = s.account_id WHERE a.patient_id = $1 AND s.revoked_at IS NOT NULL",
      [patientId],
    );
    expect(rows.map((r) => r.revoked_reason)).toContain("password_reset");

    await confirm(token, "Ikatlo-kong-sikreto-2026").expect(401);
    await signIn(NEW_PASSWORD).expect(200);

    const audit = await auditRows(ctx.pool, "action = 'portal.password-reset' AND outcome = 'success'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: patientId });
    const [changed] = await messages("portal.password-changed");
    expect(changed).toMatchObject({ status: "queued", destination: EMAIL });
    await dispatcher.dispatch(changed!.id);
    expect(email.sent.at(-1)!.message.text).toContain("was just changed");
  });

  it("limits how many links one account can be sent in an hour, answering the same", async () => {
    await agePastHour();
    const before = (await messages("portal.password-reset")).length;
    for (let i = 0; i < 3; i++) await askForLink().expect(202);
    await askForLink().expect(202);
    expect((await messages("portal.password-reset")).length).toBe(before + 3);
    const limited = await auditRows(ctx.pool, "action = 'portal.password-reset-request' AND reason = 'rate_limited'");
    expect(limited).toHaveLength(1);
  });

  it("sends nothing for an account that cannot sign in, and refuses a link held by one", async () => {
    await agePastHour();
    const token = await (async () => {
      await askForLink().expect(202);
      return latestToken();
    })();
    await staff(admin).post(`/patients/${patientId}/portal-account/disable`, { reason: "Patient request" }).expect(204);
    const before = (await messages("portal.password-reset")).length;
    await agePastHour();
    await askForLink().expect(202);
    expect((await messages("portal.password-reset")).length).toBe(before);
    await confirm(token).expect(401);
    const { rows } = await ctx.pool.query<{ consumed_reason: string }>(
      "SELECT consumed_reason FROM patient_portal_password_reset WHERE consumed_reason = 'account_inactive'",
    );
    expect(rows).toHaveLength(1);
    await signIn(NEW_PASSWORD).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });

  it("requires a consumed reason exactly when a link is consumed", async () => {
    await expect(ctx.pool.query("UPDATE patient_portal_password_reset SET consumed_reason = NULL WHERE consumed_at IS NOT NULL")).rejects.toThrow(
      /patient_portal_password_reset_check/,
    );
  });
});
