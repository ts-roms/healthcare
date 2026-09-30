import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Pahintulot-ko-2026";

/**
 * MyHealth notification settings (docs/architecture/portal-app.md, "Notification settings"): the patient chooses which
 * messages the clinic may send by text message and email; the choice is the one the notification policy reads.
 */
describe("MyHealth communication preferences", () => {
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
    put: (url: string, body: object) => ctx.http().put(`/api/v1/portal${url}`).set("Authorization", `Bearer ${portal}`).send(body),
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "myhealth-prefs");
    await createStaff(ctx.pool, tenant, "admin@prefs.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@prefs.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    for (const consentType of ["portal_access"]) {
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
          organizationCode: "myhealth-prefs",
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "juan@prefs.ph",
          password: PATIENT_PASSWORD,
        })
        .expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  type View = {
    destinations: { sms: string | null; email: string | null };
    preferences: Array<{ channel: string; category: string; choice: boolean | null; enabled: boolean; recordedVia: string | null }>;
  };
  const find = (v: View, channel: string, category: string) => v.preferences.find((p) => p.channel === channel && p.category === category)!;

  it("shows the defaults and masked destinations", async () => {
    const view = (await patient.get("/communication-preferences").expect(200)).body as View;
    expect(view.preferences).toHaveLength(9);
    // No device has allowed push yet.
    expect(view.destinations).toMatchObject({ push: null });
    expect(view.destinations.sms).toMatch(/^•+ 4567$/);
    // The registration has no email; the sign-in email is not a contact point.
    expect(view.destinations.email).toBeNull();
    expect(find(view, "sms", "clinical")).toMatchObject({ choice: null, enabled: true, recordedVia: null });
    expect(find(view, "sms", "outreach")).toMatchObject({ choice: null, enabled: false });
    expect(JSON.stringify(view)).not.toContain("0917");
  });

  it("records the patient's choices, which the notification policy reads", async () => {
    const view = (
      await patient
        .put("/communication-preferences", {
          preferences: [
            { channel: "sms", category: "outreach", optedIn: true },
            { channel: "sms", category: "administrative", optedIn: false },
          ],
        })
        .expect(200)
    ).body as View;
    expect(find(view, "sms", "outreach")).toMatchObject({ choice: true, enabled: true, recordedVia: "myhealth" });
    expect(find(view, "sms", "administrative")).toMatchObject({ choice: false, enabled: false, recordedVia: "myhealth" });
    expect(find(view, "sms", "clinical")).toMatchObject({ choice: null, enabled: true });

    // Staff see the same rows, and a staff change is shown as made at the clinic.
    const staffView = (await staff(admin).get(`/patients/${patientId}`).expect(200)).body as {
      communicationPreferences: Array<{ channel: string; category: string; optedIn: boolean }>;
    };
    expect(staffView.communicationPreferences).toEqual(
      expect.arrayContaining([
        { channel: "sms", category: "outreach", optedIn: true },
        { channel: "sms", category: "administrative", optedIn: false },
      ]),
    );
    await ctx
      .http()
      .put(`/api/v1/patients/${patientId}/communication-preferences`)
      .set(as(admin, tenant.facilityId))
      .send({ preferences: [{ channel: "sms", category: "outreach", optedIn: false }] })
      .expect(200);
    const after = (await patient.get("/communication-preferences").expect(200)).body as View;
    expect(find(after, "sms", "outreach")).toMatchObject({ choice: false, recordedVia: "clinic" });
  });

  it("offers text messages, email and push but not the inbox, each choice once", async () => {
    await patient.put("/communication-preferences", { preferences: [{ channel: "in_app", category: "clinical", optedIn: false }] }).expect(400);
    await patient.put("/communication-preferences", { preferences: [] }).expect(400);
    await patient
      .put("/communication-preferences", {
        preferences: [
          { channel: "email", category: "clinical", optedIn: true },
          { channel: "email", category: "clinical", optedIn: false },
        ],
      })
      .expect(400);
  });

  it("requires a patient session and audits reads and changes as the patient", async () => {
    await ctx.http().get("/api/v1/portal/communication-preferences").expect(401);
    await ctx.http().get("/api/v1/portal/communication-preferences").set(as(admin, tenant.facilityId)).expect(401);
    const audit = await auditRows(ctx.pool, "organization_id = $1 AND action = 'portal.communication-preferences'", [tenant.organizationId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_type).toBe("patient");
    const { rows } = await ctx.pool.query<{ changes: unknown }>(
      "SELECT changes FROM audit_event WHERE organization_id = $1 AND action = 'portal.communication-preferences'",
      [tenant.organizationId],
    );
    expect(JSON.stringify(rows[0]!.changes)).toContain("sms.outreach");
  });

  it("requires exactly one recorder in the database", async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_communication_preference (organization_id, patient_id, channel, category, opted_in) VALUES ($1, $2, 'email', 'clinical', true)`,
        [tenant.organizationId, patientId],
      ),
    ).rejects.toThrow(/patient_communication_preference_one_recorder/);
  });
});
