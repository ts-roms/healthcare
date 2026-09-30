import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Pahintulot-ko-2026";

/**
 * MyHealth consents (docs/architecture/portal-app.md, "Privacy and consents"): the patient sees each consent's current
 * decision and history, and withdraws the consents MyHealth offers; withdrawing MyHealth itself ends its sessions.
 */
describe("MyHealth consents", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let patientId: string;
  let portal: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const patient = {
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${portal}`),
    post: (url: string) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${portal}`).send({}),
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "myhealth-consents");
    await createStaff(ctx.pool, tenant, "admin@consents.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@consents.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    for (const consentType of ["portal_access", "research", "data_processing"]) {
      await staff(admin).post(`/patients/${patientId}/consents`, { consentType, decision: "granted", capturedVia: "paper" }).expect(201);
    }
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    portal = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: "myhealth-consents",
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "juan@consents.ph",
          password: PATIENT_PASSWORD,
        })
        .expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  it("lists each consent with its state and which MyHealth can withdraw", async () => {
    const consents = (await patient.get("/consents").expect(200)).body as Array<{
      consentType: string;
      inEffect: boolean;
      canWithdraw: boolean;
      current: { recordedVia: string } | null;
      history: unknown[];
    }>;
    const byType = Object.fromEntries(consents.map((c) => [c.consentType, c]));
    expect(byType["research"]).toMatchObject({ inEffect: true, canWithdraw: true, current: { recordedVia: "clinic" } });
    expect(byType["research"]!.history).toHaveLength(1);
    expect(byType["data_processing"]).toMatchObject({ inEffect: true, canWithdraw: false });
    expect(byType["telemedicine"]).toMatchObject({ inEffect: false, canWithdraw: false, current: null });
    // No staff names or notes.
    expect(JSON.stringify(consents)).not.toContain('recordedBy"');
  });

  it("withdraws only offered consents in effect, recorded by the patient's account", async () => {
    await patient
      .post("/consents/data_processing/withdraw")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("consent_withdraw_at_clinic"));
    await patient
      .post("/consents/telemedicine/withdraw")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("consent_not_in_effect"));
    await patient.post("/consents/nonsense/withdraw").expect(400);
    const withdrawn = await patient.post("/consents/research/withdraw").expect(200);
    expect(withdrawn.body).toMatchObject({ decision: "withdrawn", recordedVia: "myhealth" });
    await patient.post("/consents/research/withdraw").expect(422);

    // Staff see it recorded in MyHealth, without a staff recorder.
    const history = (await staff(admin).get(`/patients/${patientId}/consents`).expect(200)).body as Array<{
      consentType: string;
      decision: string;
      recordedVia: string;
      recordedBy: string | null;
      capturedVia: string;
    }>;
    expect(history.find((h) => h.consentType === "research" && h.decision === "withdrawn")).toMatchObject({
      recordedVia: "myhealth",
      recordedBy: null,
      capturedVia: "electronic",
    });
    // The database lets the patient's account record only electronic withdrawals, and requires exactly one recorder.
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, effective_at, captured_via, recorded_by_portal_account)
         SELECT organization_id, patient_id, 'research', 'granted', now(), 'electronic', id FROM patient_portal_account WHERE patient_id = $1`,
        [patientId],
      ),
    ).rejects.toThrow(/patient_consent_patient_decision/);
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, effective_at, captured_via)
         VALUES ($1, $2, 'research', 'granted', now(), 'paper')`,
        [tenant.organizationId, patientId],
      ),
    ).rejects.toThrow(/patient_consent_one_recorder/);
  });

  it("withdrawing MyHealth ends every session of the account", async () => {
    await patient.post("/consents/portal_access/withdraw").expect(200);
    await patient.get("/consents").expect(401);
    const { rows } = await ctx.pool.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM patient_portal_session s JOIN patient_portal_account a ON a.id = s.account_id
       WHERE a.patient_id = $1 AND s.revoked_at IS NULL`,
      [patientId],
    );
    expect(rows[0]!.open).toBe(0);
    await ctx
      .http()
      .post("/api/v1/portal/auth/login")
      .send({ organizationCode: "myhealth-consents", email: "juan@consents.ph", password: PATIENT_PASSWORD })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    const audit = await auditRows(ctx.pool, "organization_id = $1 AND action = 'portal.consent-withdraw'", [tenant.organizationId]);
    expect(audit.map((a) => [a.actor_type, (a.metadata as { consentType: string }).consentType])).toEqual([
      ["patient", "research"],
      ["patient", "portal_access"],
    ]);
  });
});
