import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-consent-online";

/**
 * Giving consents online in MyHealth (docs/architecture/portal-app.md, "Privacy and consents"): only against the
 * organization's own wording, only where the organization offers it, recording the version the patient read.
 */
describe("MyHealth online consent", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let patientId: string;
  let portal: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const patient = {
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${portal}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${portal}`).send(body),
  };
  const wording = (over: object = {}) => ({
    consentType: "telemedicine",
    offered: true,
    title: "Consultations by video or phone",
    body: "The clinic will hold consultations by video or phone. Not every concern can be handled this way.",
    acknowledgement: "I have read this and I agree to consultations by video or phone.",
    ...over,
  });
  type Consent = {
    consentType: string;
    inEffect: boolean;
    canWithdraw: boolean;
    canGive: boolean;
    current: { recordedVia: string; wordingVersion: number | null } | null;
  };
  const consents = async () => Object.fromEntries(((await patient.get("/consents").expect(200)).body as Consent[]).map((c) => [c.consentType, c]));

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@consent.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@consent.ph", ["nurse"]);
    admin = (await login(ctx, "admin@consent.ph")).accessToken;
    nurse = (await login(ctx, "nurse@consent.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
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
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "juan@consent.ph",
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  it("offers nothing until the organization writes its own wording", async () => {
    const all = await consents();
    expect(Object.values(all).every((c) => !c.canGive)).toBe(true);
    await patient.get("/consents/telemedicine/wording").expect(404);
    await patient
      .post("/consents/telemedicine/give", { consentTextId: crypto.randomUUID(), acknowledged: true })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("consent_not_offered_online"));
    const texts = (await staff(admin).get("/consent-texts").expect(200)).body as Array<{ consentType: string; current: unknown }>;
    expect(texts.map((t) => t.consentType).sort()).toEqual(["data_sharing_hmo", "data_sharing_philhealth", "research", "telemedicine"]);
    expect(texts.every((t) => t.current === null)).toBe(true);
  });

  it("lets only administrators write wording, versions it, and keeps its text out of the audit trail", async () => {
    await staff(nurse)
      .post("/consent-texts", wording())
      .expect((r) => expect([403, 404]).toContain(r.status));
    await staff(nurse)
      .get("/consent-texts")
      .expect((r) => expect([403, 404]).toContain(r.status));
    await staff(admin)
      .post("/consent-texts", wording({ body: undefined }))
      .expect(400);
    await staff(admin)
      .post("/consent-texts", wording({ consentType: "portal_access" }))
      .expect(400);
    await staff(admin).post("/consent-texts", { consentType: "research", offered: false }).expect(422);
    const v1 = (await staff(admin).post("/consent-texts", wording()).expect(201)).body;
    expect(v1).toMatchObject({ version: 1, offered: true, consentType: "telemedicine" });
    const audit = await auditRows(ctx.pool, "action = 'consent.wording-publish'");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("video or phone");
    await expect(ctx.pool.query("UPDATE consent_text SET body = 'changed'")).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM consent_text")).rejects.toThrow();
  });

  it("shows the patient what they may give, and the wording, and refuses a version that is no longer current", async () => {
    const before = await consents();
    expect(before["telemedicine"]).toMatchObject({ canGive: true, inEffect: false });
    for (const other of ["research", "data_sharing_hmo", "data_sharing_philhealth", "data_processing", "treatment_general", "portal_access"]) {
      expect(before[other]!.canGive).toBe(false);
    }
    const v1 = (await patient.get("/consents/telemedicine/wording").expect(200)).body;
    expect(v1).toMatchObject({ version: 1, title: "Consultations by video or phone", acknowledgement: expect.stringContaining("I have read this") });

    // The clinic improves the wording while the patient is reading.
    const v2 = (
      await staff(admin)
        .post("/consent-texts", wording({ body: "The clinic will hold consultations by video or phone. Your doctor may ask you to come in." }))
        .expect(201)
    ).body;
    expect(v2.version).toBe(2);
    await patient
      .post("/consents/telemedicine/give", { consentTextId: v1.id, acknowledged: true })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("consent_wording_changed"));
    expect((await patient.get("/consents/telemedicine/wording").expect(200)).body.version).toBe(2);
  });

  it("records a consent given online with the version read, once, and never for consents given at the clinic", async () => {
    const current = (await patient.get("/consents/telemedicine/wording").expect(200)).body;
    await patient.post("/consents/telemedicine/give", { consentTextId: current.id, acknowledged: false }).expect(400);
    await patient.post("/consents/telemedicine/give", { consentTextId: current.id }).expect(400);
    const given = await patient.post("/consents/telemedicine/give", { consentTextId: current.id, acknowledged: true }).expect(200);
    expect(given.body).toMatchObject({ decision: "granted", recordedVia: "myhealth", wordingVersion: 2 });

    const after = await consents();
    expect(after["telemedicine"]).toMatchObject({ inEffect: true, canWithdraw: true, canGive: false, current: { recordedVia: "myhealth", wordingVersion: 2 } });
    await patient
      .post("/consents/telemedicine/give", { consentTextId: current.id, acknowledged: true })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("consent_already_given"));
    for (const type of ["data_processing", "treatment_general", "portal_access"]) {
      await patient
        .post(`/consents/${type}/give`, { consentTextId: current.id, acknowledged: true })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("consent_give_at_clinic"));
    }
    await patient.post("/consents/nonsense/give", { consentTextId: current.id, acknowledged: true }).expect(400);
    await patient.post("/consents/research/give", { consentTextId: current.id, acknowledged: true }).expect(422);
  });

  it("shows staff who recorded it and which wording, and audits the patient's act", async () => {
    const history = (await staff(nurse).get(`/patients/${patientId}/consents`).expect(200)).body as Array<{
      consentType: string;
      decision: string;
      recordedVia: string;
      recordedBy: string | null;
      capturedVia: string;
      wordingVersion: number | null;
    }>;
    expect(history.find((h) => h.consentType === "telemedicine")).toMatchObject({
      decision: "granted",
      recordedVia: "myhealth",
      recordedBy: null,
      capturedVia: "electronic",
      wordingVersion: 2,
    });
    const audit = await auditRows(ctx.pool, "action = 'portal.consent-give'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: patientId });
    expect(audit[0]!.metadata).toMatchObject({ consentType: "telemedicine", wordingVersion: 2 });
    const events = await ctx.pool.query("SELECT payload FROM domain_event WHERE event_type = 'PatientConsentGiven'");
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows[0].payload)).not.toContain("video");
  });

  it("can be given again after a withdrawal, and stops being offered when the organization says so", async () => {
    await patient.post("/consents/telemedicine/withdraw").expect(200);
    expect((await consents())["telemedicine"]).toMatchObject({ inEffect: false, canGive: true });
    const current = (await patient.get("/consents/telemedicine/wording").expect(200)).body;
    await patient.post("/consents/telemedicine/give", { consentTextId: current.id, acknowledged: true }).expect(200);
    await patient.post("/consents/telemedicine/withdraw").expect(200);

    await staff(admin).post("/consent-texts", { consentType: "telemedicine", offered: false }).expect(201);
    expect((await consents())["telemedicine"]!.canGive).toBe(false);
    await patient.get("/consents/telemedicine/wording").expect(404);
    await patient.post("/consents/telemedicine/give", { consentTextId: current.id, acknowledged: true }).expect(422);
    const status = (await staff(admin).get("/consent-texts").expect(200)).body.find((t: { consentType: string }) => t.consentType === "telemedicine");
    expect(status.current).toMatchObject({ version: 3, offered: false });
    expect(status.history).toHaveLength(3);
  });

  it("is held by the database: the patient's account records only withdrawals, or grants made against a wording", async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, effective_at, captured_via, recorded_by_portal_account)
         SELECT organization_id, patient_id, 'research', 'granted', now(), 'electronic', id FROM patient_portal_account WHERE patient_id = $1`,
        [patientId],
      ),
    ).rejects.toThrow(/patient_consent_patient_decision/);
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, captured_via, recorded_by, consent_text_id)
         SELECT $1, $2, 'telemedicine', 'granted', 'paper', u.id, t.id FROM app_user u, consent_text t LIMIT 1`,
        [tenant.organizationId, patientId],
      ),
    ).rejects.toThrow(/patient_consent_text_only_online/);
  });
});
