import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-sign";
const person = (familyName: string, givenName: string, birthDate: string, mobile: string) => ({
  familyName,
  givenName,
  sex: "female",
  birthDate,
  contacts: [{ system: "mobile", value: mobile }],
  addresses: juan.addresses,
  identifiers: [],
});
const stroke = [
  [0.05, 0.6],
  [0.2, 0.2],
  [0.35, 0.7],
  [0.5, 0.25],
  [0.8, 0.55],
];

/**
 * Signing consent forms in MyHealth (docs/architecture/electronic-signatures.md, phase 2): the clinic asks, the patient (or
 * the guardian acting for a minor) reads the fixed wording and signs by drawing after confirming the password again; the
 * evidence names the account and the grant; a minor's form is never signed by the patient's own account.
 */
describe("consent forms signed in MyHealth", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let cashier: string;
  let adultId: string;
  let adultToken: string;
  let guardianId: string;
  let guardianToken: string;
  let guardianNumber: string;
  let childId: string;
  let viewChildId: string;
  let strangerToken: string;
  let definitionId: string;
  const ids: Record<string, string> = {};

  const code = (status: number, expected: string) => (r: { status: number; body: { error?: { code?: string } } }) => {
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(expected);
  };
  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string, actingFor?: string) => {
    const headers = (r: import("supertest").Test) =>
      actingFor ? r.set("Authorization", `Bearer ${token}`).set("X-Acting-For", actingFor) : r.set("Authorization", `Bearer ${token}`);
    return {
      get: (url: string) => headers(ctx.http().get(`/api/v1/portal${url}`)),
      post: (url: string, body: object = {}) => headers(ctx.http().post(`/api/v1/portal${url}`)).send(body),
    };
  };
  const request = (patientId: string, token = nurse) => staff(token).post(`/patients/${patientId}/consent-signature-requests`, { definitionId });
  const signBody = (over: object = {}) => ({ password: PASSWORD, strokes: [stroke], understood: true, ...over });
  const notices = async (patientId: string) =>
    (
      await ctx.pool.query<{ channel: string }>(
        `SELECT channel FROM notification WHERE recipient_patient_id = $1 AND template_key = 'records.update' AND variables->>'kind' = 'form-ready' ORDER BY channel`,
        [patientId],
      )
    ).rows;

  async function register(body: object): Promise<{ id: string; number: string }> {
    const id = (await staff(admin).post("/patients", body).expect(201)).body.id as string;
    await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const { rows } = await ctx.pool.query<{ patient_number: string }>("SELECT patient_number FROM patient WHERE id = $1", [id]);
    return { id, number: rows[0]!.patient_number };
  }
  async function activate(id: string, email: string): Promise<string> {
    const invitation = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
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
          activationCode: invitation,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
  }
  const proxyGrant = (dependentId: string, body: object = {}) =>
    staff(admin)
      .post(`/patients/${dependentId}/portal-proxies`, {
        guardianPatientNumber: guardianNumber,
        relationship: "parent",
        basis: "parent_of_minor",
        verificationNote: "Birth certificate and ID seen at the front desk",
        ...body,
      })
      .expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@sign.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@sign.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "cashier@sign.ph", ["cashier"]);
    admin = (await login(ctx, "admin@sign.ph")).accessToken;
    nurse = (await login(ctx, "nurse@sign.ph")).accessToken;
    cashier = (await login(ctx, "cashier@sign.ph")).accessToken;
    const adult = await register(person("Dela Cruz", "Ana", "1990-02-02", "0917 100 0001"));
    adultId = adult.id;
    adultToken = await activate(adult.id, "ana@sign.ph");
    const guardian = await register(juan);
    guardianId = guardian.id;
    guardianNumber = guardian.number;
    guardianToken = await activate(guardian.id, "guardian@sign.ph");
    strangerToken = await activate((await register(person("Reyes", "Maria", "1991-07-09", "0918 765 4321"))).id, "stranger@sign.ph");
    const yearsAgo = (n: number) => `${new Date().getFullYear() - n}-03-02`;
    childId = (await register(person("Dela Cruz", "Bata", yearsAgo(7), "0917 100 0002"))).id;
    viewChildId = (await register(person("Dela Cruz", "Bunso", yearsAgo(5), "0917 100 0003"))).id;
    await proxyGrant(childId);
    await proxyGrant(viewChildId, { scopes: ["view"] });
    definitionId = (
      await staff(admin)
        .post("/clinic/procedure-definitions", { code: "DRESS", name: "Wound dressing", consentRequired: true, allowedOutsideConsultation: true })
        .expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("keeps the organization's choices: a reference age, nothing in MyHealth until it turns it on, versioned", async () => {
    expect((await staff(nurse).get("/clinic/consent-signing/settings").expect(200)).body).toEqual({
      minorAgeYears: 18,
      portalSigningEnabled: false,
      requestValidDays: 14,
      version: 0,
    });
    await staff(nurse).put("/clinic/consent-signing/settings", { minorAgeYears: 18, portalSigningEnabled: true, requestValidDays: 14, version: 0 }).expect(403);
    await staff(admin).put("/clinic/consent-signing/settings", { minorAgeYears: 0, portalSigningEnabled: true, requestValidDays: 14, version: 0 }).expect(400);
    // Asking is refused while signing in MyHealth is off, and then while there is no wording to read.
    await staff(admin)
      .post("/clinic/procedure-definitions", { code: "NOWORD", name: "Entry without wording", consentRequired: true })
      .expect(201)
      .then(async (r) => {
        ids.noWording = r.body.id;
      });
    await request(adultId).expect(code(422, "portal_signing_disabled"));
    const saved = await staff(admin)
      .put("/clinic/consent-signing/settings", { minorAgeYears: 18, portalSigningEnabled: true, requestValidDays: 7, version: 0 })
      .expect(200);
    expect(saved.body).toMatchObject({ minorAgeYears: 18, portalSigningEnabled: true, requestValidDays: 7, version: 1 });
    await staff(admin).put("/clinic/consent-signing/settings", { minorAgeYears: 18, portalSigningEnabled: true, requestValidDays: 7, version: 0 }).expect(409);
    await staff(nurse)
      .post(`/patients/${adultId}/consent-signature-requests`, { definitionId: ids.noWording })
      .expect(code(422, "consent_wording_not_published"));
    expect((await auditRows(ctx.pool, "action = 'clinic.consent-signing-settings.update'")).length).toBe(1);
  });

  it("asks an adult patient to sign: the wording version is fixed, one request is open at a time", async () => {
    await staff(admin)
      .post(`/clinic/procedure-definitions/${definitionId}/consent-wordings`, {
        title: "Consent to dressing",
        body: "I understand the dressing, its purpose and the usual after-care.\n\nI agree to it being done.",
      })
      .expect(201);
    await request(adultId, cashier).expect(403);
    const created = await request(adultId).expect(201);
    ids.adultRequest = created.body.id;
    expect(created.body).toMatchObject({
      status: "pending",
      representativeRequired: false,
      wordingVersion: 1,
      procedureName: "Wound dressing",
      expired: false,
    });
    await request(adultId).expect(code(422, "request_already_open"));
    // A newer wording never changes what was asked.
    await staff(admin)
      .post(`/clinic/procedure-definitions/${definitionId}/consent-wordings`, {
        title: "Consent to dressing",
        body: "A different text that is long enough to publish.",
      })
      .expect(201);
    const listed = (await staff(nurse).get(`/patients/${adultId}/consent-signature-requests`).expect(200)).body;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: ids.adultRequest, wordingVersion: 1 });
    // The patient is told, without detail.
    await drainEvents(ctx);
    expect((await notices(adultId)).map((n) => n.channel)).toContain("in_app");
  });

  it("lets the patient read the form and sign it with their password: the evidence names the account", async () => {
    expect((await portal(adultToken).get("/forms/count").expect(200)).body).toEqual({ count: 1 });
    const forms = (await portal(adultToken).get("/forms").expect(200)).body;
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({ id: ids.adultRequest, procedureName: "Wound dressing", representativeRequired: false });
    expect(forms[0].wording).toMatchObject({ version: 1, title: "Consent to dressing" });
    expect(forms[0].wording.body).toContain("after-care");
    // Someone else's account sees nothing and cannot sign it.
    expect((await portal(strangerToken).get("/forms").expect(200)).body).toEqual([]);
    await portal(strangerToken).post(`/forms/${ids.adultRequest}/sign`, signBody()).expect(404);

    await portal(adultToken)
      .post(`/forms/${ids.adultRequest}/sign`, signBody({ password: "Wrong-password-1" }))
      .expect(code(422, "invalid_credentials"));
    await portal(adultToken)
      .post(`/forms/${ids.adultRequest}/sign`, signBody({ strokes: [[[0.5, 0.5]]] }))
      .expect(code(422, "signature_empty"));
    await portal(adultToken)
      .post(`/forms/${ids.adultRequest}/sign`, signBody({ understood: false }))
      .expect(400);

    const signed = await portal(adultToken).post(`/forms/${ids.adultRequest}/sign`, signBody()).expect(201);
    expect(signed.body.documentId).toBe(ids.adultRequest);
    // A retry finds the same document and signature.
    const retry = await portal(adultToken).post(`/forms/${ids.adultRequest}/sign`, signBody()).expect(201);
    expect(retry.body).toMatchObject({ documentId: ids.adultRequest, signatureId: signed.body.signatureId });
    expect((await portal(adultToken).get("/forms/count").expect(200)).body).toEqual({ count: 0 });

    const document = (await staff(nurse).get(`/documents/${ids.adultRequest}`).expect(200)).body;
    expect(document).toMatchObject({
      category: "consent_form",
      status: "available",
      source: "generated",
      patientId: adultId,
      title: "Consent to dressing (signed in MyHealth)",
    });
    const evidence = (await staff(nurse).get(`/documents/${ids.adultRequest}/signatures`).expect(200)).body;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      signerKind: "patient",
      signerName: "DELA CRUZ, Ana",
      identityMethod: "portal_password",
      method: "drawn",
      requestId: ids.adultRequest,
      witnessedBy: null,
    });
    expect(evidence[0].portalAccountId).toBeTruthy();
    expect(evidence[0]).not.toHaveProperty("strokes");
    const answered = (await staff(nurse).get(`/patients/${adultId}/consent-signature-requests`).expect(200)).body[0];
    expect(answered).toMatchObject({ status: "signed", signedDocumentId: ids.adultRequest });
    await portal(adultToken).post(`/forms/${ids.adultRequest}/sign`, signBody()).expect(201);
    // The audit carries ids and kinds only.
    const audit = await auditRows(ctx.pool, "action IN ('portal.consent-form-sign', 'document.sign') AND patient_id = $1", [adultId]);
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit)).not.toMatch(/Ana|DELA CRUZ|Pahintulot/);
    // The request is answered: it cannot be cancelled or signed again by someone else.
    await staff(nurse).post(`/consent-signature-requests/${ids.adultRequest}/cancel`, { reason: "No longer needed" }).expect(code(422, "request_not_pending"));
  });

  it("asks a parent or guardian to sign for a minor: the child's own account never signs, a guardian acting for them does", async () => {
    // At the clinic too: a minor's form is signed by a representative.
    const onScreen = (signerKind: string, extra: object = {}) =>
      staff(nurse).post(`/clinic/procedure-definitions/${definitionId}/consent-form/sign`, {
        patientId: childId,
        requestId: crypto.randomUUID(),
        signerKind,
        signerName: "Bata Dela Cruz",
        identityCheck: "Known patient",
        strokes: [stroke],
        ...extra,
      });
    await onScreen("patient").expect(code(422, "minor_requires_representative"));
    await onScreen("representative", { signerName: "Juan Dela Cruz", signerRelationship: "father" }).expect(200);

    const created = await request(childId).expect(201);
    ids.childRequest = created.body.id;
    expect(created.body.representativeRequired).toBe(true);
    // The guardian with a grant is told as well as the child.
    await drainEvents(ctx);
    expect((await notices(guardianId)).length).toBeGreaterThan(0);

    // The guardian's own list does not show the child's form; acting for the child it does.
    expect((await portal(guardianToken).get("/forms").expect(200)).body).toEqual([]);
    const acting = (await portal(guardianToken, childId).get("/forms").expect(200)).body;
    expect(acting).toHaveLength(1);
    expect(acting[0]).toMatchObject({ id: ids.childRequest, representativeRequired: true });
    // Another person acting for the child is refused.
    await portal(strangerToken, childId).get("/forms").expect(403);

    // Signing needs the password of the guardian's own account.
    await portal(guardianToken, childId)
      .post(`/forms/${ids.childRequest}/sign`, signBody({ password: "Wrong-password-1" }))
      .expect(code(422, "invalid_credentials"));
    const signed = await portal(guardianToken, childId).post(`/forms/${ids.childRequest}/sign`, signBody()).expect(201);
    const evidence = (await staff(nurse).get(`/documents/${signed.body.documentId}/signatures`).expect(200)).body;
    expect(evidence[0]).toMatchObject({
      signerKind: "representative",
      signerRelationship: "parent",
      identityMethod: "portal_password",
      signerName: "DELA CRUZ, Juan Santos",
    });
    expect(evidence[0].proxyGrantId).toBeTruthy();
    expect((await staff(nurse).get(`/documents/${signed.body.documentId}`).expect(200)).body).toMatchObject({ patientId: childId, category: "consent_form" });
  });

  it("refuses a view-only guardian, an expired request and a cancelled one", async () => {
    const view = await request(viewChildId).expect(201);
    await portal(guardianToken, viewChildId).get("/forms").expect(200);
    await portal(guardianToken, viewChildId).post(`/forms/${view.body.id}/sign`, signBody()).expect(403);
    // Cancelled with a reason: it can no longer be signed.
    await staff(nurse).post(`/consent-signature-requests/${view.body.id}/cancel`, {}).expect(400);
    const cancelled = await staff(nurse).post(`/consent-signature-requests/${view.body.id}/cancel`, { reason: "Parent will come in person" }).expect(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled", cancelReason: "Parent will come in person" });
    expect((await portal(guardianToken, viewChildId).get("/forms").expect(200)).body).toEqual([]);
    // A cancelled request is not signable even by a guardian who may act.
    const again = await request(childId).expect(201);
    await staff(nurse).post(`/consent-signature-requests/${again.body.id}/cancel`, { reason: "Asked by mistake" }).expect(200);
    await portal(guardianToken, childId).post(`/forms/${again.body.id}/sign`, signBody()).expect(code(422, "request_not_pending"));

    // Expired: not listed and not signable (the clock is moved with the table's guard lifted for the test only).
    const stale = await request(viewChildId).expect(201);
    await ctx.pool.query("ALTER TABLE consent_signature_request DISABLE TRIGGER consent_signature_request_guard");
    await ctx.pool.query(
      "UPDATE consent_signature_request SET requested_at = now() - interval '10 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [stale.body.id],
    );
    await ctx.pool.query("ALTER TABLE consent_signature_request ENABLE TRIGGER consent_signature_request_guard");
    expect((await portal(guardianToken, viewChildId).get("/forms").expect(200)).body).toEqual([]);
    const listed = (await staff(nurse).get(`/patients/${viewChildId}/consent-signature-requests`).expect(200)).body;
    expect(listed.find((r: { id: string }) => r.id === stale.body.id)).toMatchObject({ status: "pending", expired: true });
  });

  it("is off in MyHealth when the organization turns it off, and a request cannot be edited in place", async () => {
    await expect(ctx.pool.query(`UPDATE consent_signature_request SET wording_version = 9 WHERE id = $1`, [ids.adultRequest])).rejects.toThrow();
    await expect(ctx.pool.query(`DELETE FROM consent_signature_request WHERE id = $1`, [ids.adultRequest])).rejects.toThrow();
    const current = (await staff(admin).get("/clinic/consent-signing/settings").expect(200)).body;
    await staff(admin)
      .put("/clinic/consent-signing/settings", { ...current, portalSigningEnabled: false })
      .expect(200);
    expect((await portal(adultToken).get("/forms").expect(200)).body).toEqual([]);
    await portal(guardianToken, childId).post(`/forms/${ids.childRequest}/sign`, signBody()).expect(code(422, "portal_signing_disabled"));
  });
});
