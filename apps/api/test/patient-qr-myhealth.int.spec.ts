import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

const PORTAL = "https://myhealth.example.ph";
const PASSWORD = "Maaraw-na-umaga-2026";

/**
 * The patient's own check-in QR code in MyHealth: read-only, the same key staff scan, never the activation link, and nothing
 * until the clinic uses codes and has issued one.
 */
describe("patient QR code in MyHealth", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  /** A registered patient with an active MyHealth account; returns ids and a portal token. */
  let count = 0;
  async function patientWithAccount(issueQrCode: boolean | undefined) {
    count += 1;
    const birthDate = `198${count}-04-09`;
    const created = (
      await api(admin)
        .post("/patients", {
          familyName: `Myqr${count}`,
          givenName: "Lina",
          sex: "female",
          birthDate,
          contacts: [{ system: "mobile", value: `0917 777 010${count}` }],
          ...(issueQrCode === undefined ? {} : { issueQrCode }),
        })
        .expect(201)
    ).body as { id: string; patientNumber: string };
    await api(admin).post(`/patients/${created.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${created.id}/portal-account/invitations`).expect(201)).body.activationCode as string;
    const email = `lina${count}@myqr.ph`;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: "myqr-org", patientNumber: created.patientNumber, birthDate, activationCode: code, email, password: PASSWORD })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "myqr-org", email, password: PASSWORD }).expect(200)).body
      .accessToken as string;
    return { ...created, token };
  }
  const mine = (token: string) =>
    ctx
      .http()
      .get("/api/v1/portal/qr")
      .set({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: PORTAL });
    tenant = await createTenant(ctx.pool, "myqr-org");
    await createStaff(ctx.pool, tenant, "admin@myqr.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@myqr.ph")).accessToken;
  });

  afterAll(() => ctx.close());

  it("shows nothing while the clinic does not use QR codes", async () => {
    const patient = await patientWithAccount(undefined);
    expect((await mine(patient.token).expect(200)).body).toEqual({ enabled: false, issued: false, payload: null, patientNumber: patient.patientNumber });
    await ctx.http().get("/api/v1/portal/qr").expect(401);
  });

  it("shows the patient's own check-in key, the one staff scan, even when the card is a MyHealth link", async () => {
    await api(admin).put("/patient-qr/setting", { enabled: true, issueAtRegistration: true, content: "portal_link", version: 0 }).expect(200);
    const patient = await patientWithAccount(true);
    const shown = (await mine(patient.token).expect(200)).body as { enabled: boolean; issued: boolean; payload: string };
    expect(shown).toMatchObject({ enabled: true, issued: true, patientNumber: patient.patientNumber });
    // The check-in key only: not the activation link, and never the patient number or any detail.
    expect(shown.payload).toMatch(/^HPQ1:T:[A-Z2-7]{26}$/);
    expect(shown.payload).not.toContain("http");
    expect(shown.payload).not.toContain(patient.patientNumber);
    // Staff scan it and find this patient.
    expect((await api(admin).post("/patient-qr/scan", { payload: shown.payload }).expect(200)).body.patient.id).toBe(patient.id);
    // Viewing is audited as the patient, without the key.
    const audits = await auditRows(ctx.pool, "action = 'portal.qr-view' AND actor_type = 'patient'");
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(shown.payload.split(":")[2]);
  });

  it("says the clinic has not issued one when there is none, and stops showing a revoked one", async () => {
    const without = await patientWithAccount(false);
    expect((await mine(without.token).expect(200)).body).toMatchObject({ enabled: true, issued: false, payload: null });

    const issued = await patientWithAccount(true);
    expect((await mine(issued.token).expect(200)).body.issued).toBe(true);
    await api(admin)
      .post(`/patient-qr/patients/${issued.id}/revoke`, { reason: "Card lost at the market" })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((await mine(issued.token).expect(200)).body).toMatchObject({ enabled: true, issued: false, payload: null });
  });

  it("shows nothing once the clinic turns QR codes off", async () => {
    const patient = await patientWithAccount(true);
    expect((await mine(patient.token).expect(200)).body.issued).toBe(true);
    const current = (await api(admin).get("/patient-qr/setting").expect(200)).body as { version: number };
    await api(admin).put("/patient-qr/setting", { enabled: false, issueAtRegistration: true, content: "portal_link", version: current.version }).expect(200);
    expect((await mine(patient.token).expect(200)).body).toMatchObject({ enabled: false, issued: false, payload: null });
  });
});
