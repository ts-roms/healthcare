import { randomUUID } from "node:crypto";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Mga-rekord-ko-2026";

/**
 * Records requests and documents in MyHealth (docs/domains/records-requests.md): a patient asks for copies of their
 * records; the records office shares documents or declines with a reason; the patient downloads what was shared and
 * their medical certificates; patients and the records office are told.
 */
describe("records requests and MyHealth documents", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  let nurse: string;
  let doctor: string;
  let token: string;
  let patientId: string;
  let otherPatientId: string;
  const ids: Record<string, string> = {};

  const staff = (t: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
  });
  const portal = {
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` }),
    post: (url: string, body: object = {}) =>
      ctx
        .http()
        .post(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` })
        .send(body),
  };
  const addDocument = async (forPatient: string, title: string) => {
    const id = randomUUID();
    await ctx.pool.query(
      `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, source, scan_status, scanned_at)
       VALUES ($1, $2, $3, $4, 'other', $5, 'copy.pdf', 'application/pdf', 1000, $6, 'available', now(), 'generated', 'clean', now())`,
      [id, tenant.organizationId, tenant.facilityId, forPatient, title, `org/${tenant.organizationId}/documents/${id}`],
    );
    return id;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "records-org");
    await createStaff(ctx.pool, tenant, "admin@records.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@records.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@records.ph", ["nurse"]);
    await createClinician(ctx, tenant, "doctor@records.ph", ["physician"]);
    admin = (await login(ctx, "admin@records.ph")).accessToken;
    officer = (await login(ctx, "officer@records.ph")).accessToken;
    nurse = (await login(ctx, "nurse@records.ph")).accessToken;
    doctor = (await login(ctx, "doctor@records.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    otherPatientId = (
      await staff(admin)
        .post("/patients", {
          ...juan,
          givenName: "Maria",
          sex: "female",
          birthDate: "1991-07-08",
          contacts: [{ system: "mobile", value: "0917 111 1111" }],
          identifiers: [],
        })
        .expect(201)
    ).body.id;

    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "records-org",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@records.ph",
        password: PASSWORD,
      })
      .expect(200);
    token = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "records-org", email: "juan@records.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  it("lets the patient ask for copies, up to three open requests, and withdraw one", async () => {
    await portal.post("/records-requests", { scope: [] }).expect(400);
    await portal.post("/records-requests", { scope: ["other"] }).expect(400);
    await portal.post("/records-requests", { scope: ["laboratory"], periodFrom: "2026-05-01", periodTo: "2026-04-01" }).expect(400);
    const first = await portal
      .post("/records-requests", { scope: ["consultations", "laboratory"], periodFrom: "2026-01-01", periodTo: "2026-06-30", purpose: "Second opinion" })
      .expect(201);
    expect(first.body).toMatchObject({ requestNumber: "RR00000001", status: "submitted", scope: ["consultations", "laboratory"] });
    ids.first = first.body.id;
    ids.second = (await portal.post("/records-requests", { scope: ["prescriptions"] }).expect(201)).body.id;
    ids.third = (await portal.post("/records-requests", { scope: ["other"], details: "My vaccination card copy" }).expect(201)).body.id;
    await portal
      .post("/records-requests", { scope: ["imaging"] })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("too_many_open_requests"));
    await portal.post(`/records-requests/${ids.third}/withdraw`).expect(200);
    await portal
      .post(`/records-requests/${ids.third}/withdraw`)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("request_closed"));
    const audit = await auditRows(ctx.pool, "action = 'portal.records-request.submit' AND patient_id = $1", [patientId]);
    expect(audit[0]).toMatchObject({ actor_type: "patient" });

    // The records office is told in the app of each new request.
    await drainEvents(ctx);
    const notices = (await ctx.http().get("/api/v1/me/notifications").set(as(officer)).expect(200)).body.filter(
      (n: { templateKey: string }) => n.templateKey === "records.request-new",
    );
    expect(notices).toHaveLength(3);
    expect(notices.find((n: { subject: string }) => n.subject === "New records request RR00000001")).toMatchObject({ href: `/records/requests/${ids.first}` });
    expect((await ctx.http().get("/api/v1/me/notifications").set(as(nurse)).expect(200)).body).toEqual([]);
  });

  it("lets the records office share documents from the patient's record, or decline with a reason", async () => {
    await staff(nurse).get("/records-requests").expect(403);
    const open = await staff(officer).get("/records-requests").expect(200);
    expect(open.body.map((r: { id: string }) => r.id)).toEqual([ids.first, ids.second]);
    expect(open.body[0]).toMatchObject({ patient: { displayName: "DELA CRUZ, Juan Santos" }, daysWaiting: 0 });

    ids.doc = await addDocument(patientId, "Consultation summaries Jan–Jun 2026");
    ids.otherDoc = await addDocument(otherPatientId, "Someone else's record");
    const detail = await staff(officer).get(`/records-requests/${ids.first}`).expect(200);
    expect(detail.body.available.map((d: { id: string }) => d.id)).toContain(ids.doc);
    expect(detail.body.available.map((d: { id: string }) => d.id)).not.toContain(ids.otherDoc);

    const review = await staff(officer).post(`/records-requests/${ids.first}/review`, { version: detail.body.version }).expect(200);
    expect(review.body.status).toBe("in_review");
    await staff(officer)
      .post(`/records-requests/${ids.first}/fulfil`, { documentIds: [ids.otherDoc], version: review.body.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_not_shareable"));
    await staff(officer)
      .post(`/records-requests/${ids.first}/fulfil`, { documentIds: [ids.doc], version: detail.body.version })
      .expect(409);
    const fulfilled = await staff(officer)
      .post(`/records-requests/${ids.first}/fulfil`, { documentIds: [ids.doc], note: "Summaries attached", version: review.body.version })
      .expect(200);
    expect(fulfilled.body).toMatchObject({ status: "fulfilled", responseNote: "Summaries attached" });
    await staff(officer)
      .post(`/records-requests/${ids.first}/decline`, { reason: "Too late", version: fulfilled.body.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("request_closed"));

    const second = (await staff(officer).get(`/records-requests/${ids.second}`).expect(200)).body;
    await staff(officer).post(`/records-requests/${ids.second}/decline`, { reason: "x", version: second.version }).expect(400);
    await staff(officer)
      .post(`/records-requests/${ids.second}/decline`, {
        reason: "Your prescriptions are already in MyHealth under Prescriptions.",
        version: second.version,
      })
      .expect(200);

    await expect(ctx.pool.query("UPDATE records_request SET scope = '{imaging}' WHERE id = $1", [ids.first])).rejects.toThrow(/not changed/);
    await expect(ctx.pool.query("DELETE FROM records_request WHERE id = $1", [ids.first])).rejects.toThrow(/never deleted/);
    await expect(ctx.pool.query("DELETE FROM records_request_document WHERE request_id = $1", [ids.first])).rejects.toThrow();
    const audit = await auditRows(ctx.pool, "action LIKE 'patient.records-request.%' AND patient_id = $1", [patientId]);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "patient.records-request.view",
        "patient.records-request.review",
        "patient.records-request.fulfil",
        "patient.records-request.decline",
      ]),
    );
  });

  it("shows the patient their answers, shared documents and medical certificates, with audited links", async () => {
    // A medical certificate from a signed consultation.
    const encounterId = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Fever" }).expect(201)).body.id;
    await staff(doctor).put(`/encounters/${encounterId}/note`, { assessment: "Viral fever", plan: "Rest", basedOnRevision: 0 }).expect(200);
    const encounter = await staff(doctor).get(`/encounters/${encounterId}`).expect(200);
    await staff(doctor).post(`/encounters/${encounterId}/sign`, { version: encounter.body.version }).expect(200);
    ids.certificate = (
      await staff(doctor).post(`/encounters/${encounterId}/certificates`, { purpose: "Absence from school", findings: "Viral fever" }).expect(201)
    ).body.id;

    const documents = await portal.get("/documents").expect(200);
    expect(documents.body.certificates).toEqual([
      expect.objectContaining({ id: ids.certificate, certificateNumber: "MC00000001", purpose: "Absence from school", practitionerName: "Dr. doctor" }),
    ]);
    expect(JSON.stringify(documents.body.certificates)).not.toContain("Viral fever");
    const byId = Object.fromEntries(documents.body.requests.map((r: { id: string }) => [r.id, r]));
    expect(byId[ids.first]).toMatchObject({
      status: "fulfilled",
      responseNote: "Summaries attached",
      documents: [expect.objectContaining({ documentId: ids.doc })],
    });
    expect(byId[ids.second]).toMatchObject({
      status: "declined",
      responseNote: "Your prescriptions are already in MyHealth under Prescriptions.",
      documents: [],
    });
    expect(byId[ids.third]).toMatchObject({ status: "withdrawn" });

    const link = await portal.get(`/records-requests/documents/${ids.doc}/link`).expect(200);
    expect(link.body.url).toEqual(expect.any(String));
    await portal.get(`/records-requests/documents/${ids.otherDoc}/link`).expect(404);
    await portal.get(`/certificates/${ids.certificate}/link`).expect(200);
    const downloads = await auditRows(ctx.pool, "action = 'document.download' AND actor_type = 'patient' AND patient_id = $1", [patientId]);
    expect(downloads).toHaveLength(2);

    // A voided certificate leaves MyHealth.
    await staff(doctor).post(`/medical-certificates/${ids.certificate}/void`, { reason: "Issued in error" }).expect(200);
    expect((await portal.get("/documents").expect(200)).body.certificates).toEqual([]);
    await portal.get(`/certificates/${ids.certificate}/link`).expect(404);

    // The patient was told — in the app and by SMS — without clinical detail.
    await drainEvents(ctx);
    const sent = await ctx.pool.query<{ channel: string; variables: unknown }>(
      "SELECT channel, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'records.update' ORDER BY created_at, channel",
      [patientId],
    );
    // A certificate ready and two answered requests (the withdrawn one is not announced).
    expect(sent.rows.filter((r) => r.channel === "in_app")).toHaveLength(3);
    expect(JSON.stringify(sent.rows)).not.toMatch(/fever|prescription/i);
  });
});
