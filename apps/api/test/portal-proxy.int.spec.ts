import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-proxy";
const person = (familyName: string, givenName: string, birthDate: string, mobile: string) => ({
  familyName,
  givenName,
  sex: "female",
  birthDate,
  contacts: [{ system: "mobile", value: mobile }],
  addresses: juan.addresses,
  identifiers: [],
});

/**
 * Guardian and dependent access (docs/architecture/portal-app.md, "Guardians and dependents"): only through a grant the
 * clinic made, only on routes opened to it, only with the dependent's portal consent, and every action audited.
 */
describe("MyHealth guardian access", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let guardianId: string;
  let guardianToken: string;
  let guardianNumber: string;
  let childId: string;
  let strangerToken: string;
  let adultId: string;
  let adultToken: string;
  let grantId = "";

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string, actingFor?: string) => {
    const headers = (r: import("supertest").Test) =>
      actingFor ? r.set("Authorization", `Bearer ${token}`).set("X-Acting-For", actingFor) : r.set("Authorization", `Bearer ${token}`);
    return {
      get: (url: string) => headers(ctx.http().get(`/api/v1/portal${url}`)),
      post: (url: string, body: object = {}) => headers(ctx.http().post(`/api/v1/portal${url}`)).send(body),
    };
  };
  const grant = (dependentId: string, body: object = {}) =>
    staff(admin).post(`/patients/${dependentId}/portal-proxies`, {
      guardianPatientNumber: guardianNumber,
      relationship: "parent",
      basis: "parent_of_minor",
      verificationNote: "Birth certificate and ID seen at the front desk",
      ...body,
    });

  async function register(body: object, consent = true): Promise<{ id: string; number: string }> {
    const id = (await staff(admin).post("/patients", body).expect(201)).body.id as string;
    if (consent) await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const { rows } = await ctx.pool.query<{ patient_number: string }>("SELECT patient_number FROM patient WHERE id = $1", [id]);
    return { id, number: rows[0]!.patient_number };
  }
  async function activate(id: string, email: string): Promise<string> {
    const code = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    return (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@proxy.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@proxy.ph", ["nurse"]);
    admin = (await login(ctx, "admin@proxy.ph")).accessToken;
    nurse = (await login(ctx, "nurse@proxy.ph")).accessToken;
    const g = await register(juan);
    guardianId = g.id;
    guardianNumber = g.number;
    guardianToken = await activate(g.id, "guardian@proxy.ph");
    const s = await register(person("Reyes", "Maria", "1991-07-09", "0918 765 4321"));
    strangerToken = await activate(s.id, "stranger@proxy.ph");
    childId = (await register(person("Dela Cruz", "Bata", "2018-03-02", "0917 000 1111"))).id;
    const a = await register(person("Dela Cruz", "Lola", "1950-01-05", "0917 000 2222"));
    adultId = a.id;
    adultToken = await activate(a.id, "lola@proxy.ph");
  });
  afterAll(() => ctx.close());

  it("is refused without the permission, without the guardian's own account, and without the dependent's consent", async () => {
    await staff(nurse)
      .post(`/patients/${childId}/portal-proxies`, {
        guardianPatientNumber: guardianNumber,
        relationship: "parent",
        basis: "parent_of_minor",
        verificationNote: "ID seen",
      })
      .expect(403);
    const noConsent = await register(person("Dela Cruz", "Walang", "2019-01-01", "0917 000 3333"), false);
    expect((await grant(noConsent.id).expect(422)).body.error.code).toBe("portal_consent_required");
    const noAccount = await register(person("Santos", "Pedro", "1980-05-05", "0917 000 4444"));
    expect(
      (
        await staff(admin)
          .post(`/patients/${childId}/portal-proxies`, {
            guardianPatientNumber: noAccount.number,
            relationship: "parent",
            basis: "parent_of_minor",
            verificationNote: "ID seen",
          })
          .expect(422)
      ).body.error.code,
    ).toBe("guardian_no_portal_account");
    await grant(childId, { verificationNote: "no" }).expect(400);
    await grant(childId, { scopes: ["act"] }).expect(400);
  });

  it("grants access, audited, and lists it on both records", async () => {
    const created = await grant(childId).expect(201);
    grantId = created.body.id;
    expect(created.body).toMatchObject({ relationship: "parent", scopes: ["view", "act"] });
    expect((await grant(childId).expect(409)).body.error.code).toBe("proxy_exists");
    expect(await auditRows(ctx.pool, `action = 'patient.portal-proxy-grant' AND patient_id = $1`, [childId])).toHaveLength(1);
    const overview = (await staff(nurse).get(`/patients/${childId}/portal-proxies`).expect(200)).body;
    expect(overview.actedForBy).toHaveLength(1);
    expect((await staff(nurse).get(`/patients/${guardianId}/portal-proxies`).expect(200)).body.actingFor).toHaveLength(1);

    const dependents = (await portal(guardianToken).get("/proxy/dependents").expect(200)).body;
    expect(dependents).toEqual([expect.objectContaining({ grantId, patientId: childId, relationship: "parent" })]);
  });

  it("lets the guardian read and write as the child, and audits it with the grant", async () => {
    const me = (await portal(guardianToken, childId).get("/me").expect(200)).body;
    expect(me.patient.givenName).toBe("Bata");
    expect(me.acting).toMatchObject({ relationship: "parent", scopes: ["view", "act"] });
    expect((await portal(guardianToken).get("/me").expect(200)).body.acting).toBeNull();

    const thread = await portal(guardianToken, childId)
      .post("/message-threads", { topic: "general", subject: "For my child", body: "Is the cough serious?" })
      .expect(201);
    expect(thread.body.messages[0]).toMatchObject({ sender: "patient", viaGuardian: true });
    const seen = (await staff(nurse).get(`/patient-messages/${thread.body.id}`).expect(200)).body;
    expect(seen.messages[0]).toMatchObject({ viaGuardian: true });
    // The guardian's own conversations do not include the child's.
    expect((await portal(guardianToken).get("/message-threads").expect(200)).body).toEqual([]);

    const audits = await auditRows(ctx.pool, `action = 'portal.message-send' AND patient_id = $1`, [childId]);
    expect(audits[0]!.metadata).toMatchObject({ proxyGrantId: grantId, actingAsGuardian: true });
  });

  it("keeps the guardian's own account matters out of reach while acting", async () => {
    for (const path of ["/security/mfa", "/preferences", "/consents", "/push/devices"]) {
      const res = await portal(guardianToken, childId).get(path);
      expect([403, 404]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe("proxy_not_allowed");
    }
    await portal(guardianToken, childId).get("/proxy/dependents").expect(403);
  });

  it("refuses strangers, malformed ids and other people's dependents", async () => {
    for (const token of [strangerToken, adultToken]) {
      expect((await portal(token, childId).get("/me").expect(403)).body.error.code).toBe("proxy_not_allowed");
    }
    expect((await portal(guardianToken, "not-a-uuid").get("/me").expect(403)).body.error.code).toBe("proxy_not_allowed");
    expect((await portal(guardianToken, adultId).get("/me").expect(403)).body.error.code).toBe("proxy_not_allowed");
  });

  it("honours a view-only scope", async () => {
    await staff(admin).post(`/patients/${childId}/portal-proxies/${grantId}/revoke`, { reason: "Changing scope" }).expect(200);
    await portal(guardianToken, childId).get("/me").expect(403);
    const viewOnly = await grant(childId, { scopes: ["view"] }).expect(201);
    grantId = viewOnly.body.id;
    await portal(guardianToken, childId).get("/me").expect(200);
    expect((await portal(guardianToken, childId).post("/message-threads", { topic: "general", subject: "s", body: "b" }).expect(403)).body.error.code).toBe(
      "proxy_view_only",
    );
  });

  it("stops when the dependent's portal consent is withdrawn at the clinic", async () => {
    await portal(guardianToken, childId).get("/me").expect(200);
    await staff(admin).post(`/patients/${childId}/consents`, { consentType: "portal_access", decision: "withdrawn", capturedVia: "paper" }).expect(201);
    expect((await portal(guardianToken, childId).get("/me").expect(403)).body.error.code).toBe("proxy_not_allowed");
    expect((await portal(guardianToken).get("/proxy/dependents").expect(200)).body).toEqual([]);
    await staff(admin).post(`/patients/${childId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    await portal(guardianToken, childId).get("/me").expect(200);
  });

  it("lets an adult with an account grant access, be told, and take it back", async () => {
    const created = await grant(adultId, {
      relationship: "adult_child",
      basis: "authorized_by_patient",
      verificationNote: "Patient came in and signed the form",
    }).expect(201);
    await drainEvents(ctx);
    const told = await ctx.pool.query(
      "SELECT variables FROM notification WHERE template_key = 'portal.security-alert' AND recipient_patient_id = $1 ORDER BY created_at",
      [adultId],
    );
    expect(told.rows.at(-1).variables).toMatchObject({ event: "proxy_access_granted" });
    const guardians = (await portal(adultToken).get("/proxy/guardians").expect(200)).body;
    expect(guardians).toEqual([expect.objectContaining({ grantId: created.body.id, relationship: "adult_child" })]);
    await portal(guardianToken, adultId).get("/me").expect(200);

    // Someone unrelated cannot end it; the patient can.
    await portal(strangerToken).post(`/proxy/grants/${created.body.id}/end`).expect(404);
    await portal(adultToken).post(`/proxy/grants/${created.body.id}/end`).expect(204);
    expect((await portal(guardianToken, adultId).get("/me").expect(403)).body.error.code).toBe("proxy_not_allowed");
    await drainEvents(ctx);
    const ended = await ctx.pool.query(
      "SELECT variables FROM notification WHERE template_key = 'portal.security-alert' AND recipient_patient_id = $1 ORDER BY created_at",
      [adultId],
    );
    expect(ended.rows.at(-1).variables).toMatchObject({ event: "proxy_access_ended" });
  });

  it("lets the guardian give access up, and refuses an expired one", async () => {
    await portal(guardianToken).post(`/proxy/grants/${grantId}/end`).expect(204);
    await portal(guardianToken, childId).get("/me").expect(403);
    const expiring = await grant(childId).expect(201);
    await ctx.pool.query("UPDATE portal_proxy_grant SET granted_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = $1", [
      expiring.body.id,
    ]);
    await portal(guardianToken, childId).get("/me").expect(403);
    expect((await portal(guardianToken).get("/proxy/dependents").expect(200)).body).toEqual([]);
  });
});
