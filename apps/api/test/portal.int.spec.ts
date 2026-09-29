import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";

describe("patient portal sign-in", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let reception: string;
  let nurse: string;
  let patientId: string;
  let otherPatientId: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
  });
  const consent = (id: string, decision: "granted" | "withdrawn") =>
    staff(admin).post(`/api/v1/patients/${id}/consents`).send({ consentType: "portal_access", decision, capturedVia: "paper" }).expect(201);
  const invite = (id: string, token = reception) => staff(token).post(`/api/v1/patients/${id}/portal-account/invitations`);
  const activate = (body: Record<string, unknown>) => ctx.http().post("/api/v1/portal/auth/activate").send(body);
  const portalLogin = (email: string, password = PATIENT_PASSWORD) =>
    ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "portal-org", email, password });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "portal-org");
    await createStaff(ctx.pool, tenant, "admin@portal.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "reception@portal.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "nurse@portal.ph", ["nurse"]);
    admin = (await login(ctx, "admin@portal.ph")).accessToken;
    reception = (await login(ctx, "reception@portal.ph")).accessToken;
    nurse = (await login(ctx, "nurse@portal.ph")).accessToken;
    patientId = (await staff(admin).post("/api/v1/patients").send(juan).expect(201)).body.id;
    otherPatientId = (
      await staff(admin).post("/api/v1/patients").send({ familyName: "Reyes", givenName: "Ana", sex: "female", birthDate: "1995-12-21" }).expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("requires portal_access consent before inviting", async () => {
    const response = await invite(patientId).expect(422);
    expect(response.body.error.code).toBe("portal_consent_required");
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      status: "none",
      portalConsent: false,
    });
  });

  it("only staff with patient.portal.manage may invite", async () => {
    await consent(patientId, "granted");
    await invite(patientId, nurse).expect(403);
  });

  let code: string;

  it("issues a one-time activation code, stored hashed and audited", async () => {
    const response = await invite(patientId).expect(201);
    code = response.body.activationCode;
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const stored = await ctx.pool.query(`SELECT status, activation_code_hash FROM patient_portal_account WHERE patient_id = $1`, [patientId]);
    expect(stored.rows[0].status).toBe("invited");
    expect(stored.rows[0].activation_code_hash).not.toContain(code.replace("-", ""));
    expect((await auditRows(ctx.pool, `action = 'patient.portal-invite' AND patient_id = $1`, [patientId])).length).toBe(1);
  });

  const activation = () => ({
    organizationCode: "portal-org",
    patientNumber: "P00000001",
    birthDate: juan.birthDate,
    activationCode: code,
    email: "juan@example.ph",
    password: PATIENT_PASSWORD,
  });

  it("rejects wrong activation details without saying which one was wrong", async () => {
    const wrongBirth = await activate({ ...activation(), birthDate: "1990-01-01" }).expect(401);
    const wrongCode = await activate({ ...activation(), activationCode: "AAAAA-AAAAA" }).expect(401);
    const unknownOrg = await activate({ ...activation(), organizationCode: "nope" }).expect(401);
    expect(new Set([wrongBirth.body.error.message, wrongCode.body.error.message, unknownOrg.body.error.message]).size).toBe(1);
    expect(wrongBirth.body.error.code).toBe("invalid_activation");
    // Staff see the specific reason of the latest attempt against the invitation (an unknown organization reaches none).
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      lastActivationFailure: { reason: "code_mismatch" },
      failedActivationAttempts: 2,
      maxActivationAttempts: 5,
    });
    const reasons = await auditRows(ctx.pool, `action = 'portal.activate' AND outcome = 'failure' AND patient_id = $1`, [patientId]);
    expect(reasons.map((row) => row.reason).sort()).toEqual(["birth_date_mismatch", "code_mismatch"]);
  });

  it("destroys the code after 5 wrong attempts; a new invitation is needed", async () => {
    for (let i = 0; i < 3; i++) await activate({ ...activation(), activationCode: "BBBBB-BBBBB" }).expect(401);
    await activate(activation()).expect(401);
    expect((await auditRows(ctx.pool, `action = 'portal.activate' AND reason = 'attempts_exhausted'`)).length).toBe(1);
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      status: "invited",
      invitationExpired: true,
    });
    code = (await invite(patientId).expect(201)).body.activationCode;
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      status: "invited",
      invitationExpired: false,
      lastActivationFailure: null,
      failedActivationAttempts: 0,
    });
  });

  let refreshToken: string;
  let accessToken: string;

  it("activates with the code (case and dashes don't matter) and signs the patient in", async () => {
    const response = await activate({ ...activation(), activationCode: code.toLowerCase().replace("-", " ") }).expect(200);
    expect(response.body).toMatchObject({ status: "authenticated", tokenType: "Bearer" });
    ({ accessToken, refreshToken } = response.body);
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      status: "active",
      email: "juan@example.ph",
    });
    const [event] = await auditRows(ctx.pool, `action = 'portal.activate' AND outcome = 'success'`);
    expect(event).toMatchObject({ actor_type: "patient", patient_id: patientId });
    await activate(activation()).expect(401); // the code is single-use
  });

  it("returns the patient's own profile and audits the access as the patient", async () => {
    const me = await ctx.http().get("/api/v1/portal/me").set(as(accessToken)).expect(200);
    expect(me.body).toMatchObject({
      patient: { patientNumber: "P00000001", givenName: juan.givenName, birthDate: juan.birthDate },
      organization: { name: "Org portal-org" },
      account: { email: "juan@example.ph" },
      timeZone: "Asia/Manila",
    });
    const [event] = await auditRows(ctx.pool, `action = 'portal.profile-view'`);
    expect(event).toMatchObject({ actor_type: "patient", patient_id: patientId });
  });

  it("gives the time zone of the patient's clinic, for showing dates and times", async () => {
    const zone = (tz: string) =>
      ctx.pool.query(`UPDATE facility SET timezone = $2 WHERE id = (SELECT registered_facility_id FROM patient WHERE id = $1)`, [patientId, tz]);
    await zone("Asia/Tokyo");
    try {
      expect((await ctx.http().get("/api/v1/portal/me").set(as(accessToken)).expect(200)).body.timeZone).toBe("Asia/Tokyo");
    } finally {
      await zone("Asia/Manila");
    }
  });

  it("keeps patient and staff tokens apart", async () => {
    await ctx.http().get("/api/v1/patients?q=juan").set(as(accessToken)).expect(401);
    await ctx.http().get(`/api/v1/patients/${patientId}`).set(as(accessToken)).expect(401);
    await ctx.http().get("/api/v1/portal/me").set(as(admin)).expect(401);
  });

  it("rotates refresh tokens and revokes the session when an old one is reused", async () => {
    const rotated = await ctx.http().post("/api/v1/portal/auth/refresh").send({ refreshToken }).expect(200);
    await ctx.http().post("/api/v1/portal/auth/refresh").send({ refreshToken }).expect(401); // reuse
    await ctx.http().post("/api/v1/portal/auth/refresh").send({ refreshToken: rotated.body.refreshToken }).expect(401); // session revoked
    await ctx.http().get("/api/v1/portal/me").set(as(rotated.body.accessToken)).expect(401);
    expect((await auditRows(ctx.pool, `action = 'portal.session-revoke' AND reason = 'refresh_token_reuse'`)).length).toBe(1);
  });

  it("signs in with email and password, and signs out", async () => {
    await portalLogin("juan@example.ph", "wrong-password-123").expect(401);
    const session = await portalLogin("JUAN@example.ph").expect(200);
    await ctx.http().post("/api/v1/portal/auth/logout").set(as(session.body.accessToken)).expect(204);
    await ctx.http().get("/api/v1/portal/me").set(as(session.body.accessToken)).expect(401);
  });

  it("keeps one login email per organization", async () => {
    await consent(otherPatientId, "granted");
    const otherCode = (await invite(otherPatientId).expect(201)).body.activationCode;
    const response = await activate({
      organizationCode: "portal-org",
      patientNumber: "P00000002",
      birthDate: "1995-12-21",
      activationCode: otherCode,
      email: "juan@example.ph",
      password: PATIENT_PASSWORD,
    }).expect(409);
    expect(response.body.error.code).toBe("email_in_use");
  });

  it("ends portal access when consent is withdrawn", async () => {
    const session = await portalLogin("juan@example.ph").expect(200);
    await consent(patientId, "withdrawn");
    await ctx.http().get("/api/v1/portal/me").set(as(session.body.accessToken)).expect(401);
    await ctx.http().post("/api/v1/portal/auth/refresh").send({ refreshToken: session.body.refreshToken }).expect(401);
    await portalLogin("juan@example.ph").expect(403);
    await consent(patientId, "granted");
    await portalLogin("juan@example.ph").expect(200);
  });

  it("locks the account after repeated wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await portalLogin("juan@example.ph", `wrong-password-${i}xx`).expect(401);
    const locked = await portalLogin("juan@example.ph").expect(401);
    expect(locked.body.error.code).toBe("account_locked");
    await ctx.pool.query(`UPDATE patient_portal_account SET locked_until = NULL WHERE patient_id = $1`, [patientId]);
  });

  it("lets staff disable the account, which ends every session", async () => {
    const session = await portalLogin("juan@example.ph").expect(200);
    await staff(nurse).post(`/api/v1/patients/${patientId}/portal-account/disable`).send({ reason: "Patient request" }).expect(403);
    await staff(reception).post(`/api/v1/patients/${patientId}/portal-account/disable`).send({ reason: "Patient request" }).expect(204);
    await ctx.http().get("/api/v1/portal/me").set(as(session.body.accessToken)).expect(401);
    await portalLogin("juan@example.ph").expect(401);
    expect((await staff(reception).get(`/api/v1/patients/${patientId}/portal-account`).expect(200)).body).toMatchObject({
      status: "disabled",
      disabledReason: "Patient request",
    });
  });
});
