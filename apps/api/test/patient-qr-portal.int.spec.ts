import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

const PORTAL = "https://myhealth.example.ph";

/**
 * A card with a MyHealth link (migration 0118): scanning it with a phone names the patient number to activate, only while
 * the clinic's invitation is open; the date of birth and the one-time code are still required, and the card alone opens
 * nothing.
 */
describe("patient QR code as a MyHealth link", () => {
  let ctx: TestContext;
  let noPortal: TestContext;
  let tenant: Tenant;
  let admin: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const card = (organizationCode: string, payload: string) => ctx.http().post("/api/v1/portal/auth/activation-card").send({ organizationCode, payload });

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: PORTAL });
    tenant = await createTenant(ctx.pool, "qr-link-org");
    await createStaff(ctx.pool, tenant, "admin@qr-link.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@qr-link.ph")).accessToken;
    await api(admin).put("/patient-qr/setting", { enabled: true, issueAtRegistration: true, content: "portal_link", version: 0 }).expect(200);
  });

  afterAll(async () => {
    await ctx.close();
    await noPortal?.close();
  });

  it("encodes the portal address with the key in the fragment, never the patient number", async () => {
    const patient = (
      await api(admin)
        .post("/patients", {
          familyName: "Qrlinkfamily",
          givenName: "Lina",
          sex: "female",
          birthDate: "1988-04-09",
          contacts: [{ system: "email", value: "lina@qr-link.ph" }],
          addresses: [],
          identifiers: [],
        })
        .expect(201)
    ).body as { id: string; patientNumber: string };
    const { payload } = (await api(admin).get(`/patient-qr/patients/${patient.id}`).expect(200)).body.active as { payload: string };
    expect(payload).toMatch(new RegExp(`^${PORTAL}/activate#HPQ1:T:[A-Z2-7]{26}$`));
    expect(payload).not.toContain(patient.patientNumber);
    const key = payload.split("#")[1] as string;

    // Staff can scan the same card (the whole link, as a scanner reads it).
    expect((await api(admin).post("/patient-qr/scan", { payload }).expect(200)).body.patient.id).toBe(patient.id);

    // Not invited yet: nothing is revealed.
    await card("qr-link-org", key).expect(404);

    await api(admin).post(`/patients/${patient.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${patient.id}/portal-account/invitations`).expect(201)).body.activationCode as string;
    const found = await card("qr-link-org", key).expect(200);
    expect(found.body).toEqual({ patientNumber: patient.patientNumber, givenName: "Lina", birthDate: "1988-04-09", email: "lina@qr-link.ph" });
    // The right organization only, and only a MyHealth-link key.
    await card("other-org", key).expect(404);
    await card("qr-link-org", `HPQ1:T:${"A".repeat(26)}`).expect(404);
    await card("qr-link-org", "garbage").expect(404);

    // The card alone opens nothing: activation still needs the date of birth and the code.
    const base = {
      organizationCode: "qr-link-org",
      patientNumber: patient.patientNumber,
      activationCode: code,
      email: "lina@qr-link.ph",
      password: "Maaraw-na-umaga-2026",
    };
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ ...base, birthDate: "1988-04-10" })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ ...base, birthDate: "1988-04-09" })
      .expect(200);

    // Once activated, the card names nothing any more.
    await card("qr-link-org", key).expect(404);
    const audits = await auditRows(ctx.pool, "action = 'portal.activation-card'");
    expect(audits.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(key);
  });

  it("is refused without a portal address", async () => {
    noPortal = await createTestApp();
    const t = await createTenant(noPortal.pool, "qr-link-none");
    await createStaff(noPortal.pool, t, "admin@qr-none.ph", ["org_admin"]);
    const token = (await login(noPortal, "admin@qr-none.ph")).accessToken;
    const res = await noPortal
      .http()
      .put("/api/v1/patient-qr/setting")
      .set(as(token, t.facilityId))
      .send({ enabled: true, issueAtRegistration: true, content: "portal_link", version: 0 })
      .expect(422);
    expect(res.body.error.code).toBe("portal_link_unavailable");
  });
});
