import { randomUUID } from "node:crypto";
import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Kopya-ng-rekord-2026";

/**
 * Copies of the record (docs/domains/records-requests.md, "Copy of the record"): the records office compiles the
 * chosen sections of the patient's record over a period into one PDF, stored once as a record_copy document of the
 * patient and shared in answer to the request like any other document.
 */
describe("copies of the record for records requests", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  let nurse: string;
  let doctor: string;
  let token: string;
  let patientId: string;
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
  const pdfText = (documentId: string) =>
    extractPdfText(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${documentId}`)!)
      .replace(/·/g, "")
      .replace(/\s+/g, " ");

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "copies-org");
    await createStaff(ctx.pool, tenant, "admin@copies.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@copies.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@copies.ph", ["nurse"]);
    await createClinician(ctx, tenant, "doctor@copies.ph", ["physician"]);
    admin = (await login(ctx, "admin@copies.ph")).accessToken;
    officer = (await login(ctx, "officer@copies.ph")).accessToken;
    nurse = (await login(ctx, "nurse@copies.ph")).accessToken;
    doctor = (await login(ctx, "doctor@copies.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;

    await staff(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
    // A signed consultation with a note, a diagnosis and an allergy; a certificate; a document on file.
    await staff(doctor).post(`/patients/${patientId}/allergies`, { category: "medication", substance: "Penicillin", reaction: "Hives" }).expect(201);
    ids.encounter = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Fever for three days" }).expect(201)).body.id;
    await staff(doctor)
      .post(`/encounters/${ids.encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "A90", display: "Dengue fever", rank: "primary" })
      .expect(201);
    await staff(doctor)
      .put(`/encounters/${ids.encounter}/note`, {
        subjective: "Fever and body aches",
        assessment: "Dengue fever, no warning signs",
        plan: "Fluids",
        basedOnRevision: 0,
      })
      .expect(200);
    const current = await staff(doctor).get(`/encounters/${ids.encounter}`).expect(200);
    await staff(doctor).post(`/encounters/${ids.encounter}/sign`, { version: current.body.version }).expect(200);
    await staff(doctor).post(`/encounters/${ids.encounter}/certificates`, { purpose: "Absence from work", findings: "Dengue fever" }).expect(201);
    ids.upload = randomUUID();
    await ctx.pool.query(
      `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, source)
       VALUES ($1, $2, $3, $4, 'referral_letter', 'Referral from Barangay Health Center', 'referral.pdf', 'application/pdf', 1000, $5, 'available', now(), 'generated')`,
      [ids.upload, tenant.organizationId, tenant.facilityId, patientId, `org/${tenant.organizationId}/documents/${ids.upload}`],
    );

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
        organizationCode: "copies-org",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@copies.ph",
        password: PASSWORD,
      })
      .expect(200);
    token = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "copies-org", email: "juan@copies.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;
    ids.request = (await portal.post("/records-requests", { scope: ["consultations", "certificates"], purpose: "Company clinic" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("suggests the sections matching what the patient asked for", async () => {
    const request = await staff(officer).get(`/records-requests/${ids.request}`).expect(200);
    expect(request.body.suggestedSections).toEqual(["allergies", "consultations", "care_plans", "certificates"]);
    expect(request.body.copies).toEqual([]);
  });

  it("is prepared by the records office only, with valid sections and period", async () => {
    await staff(nurse)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["consultations"] })
      .expect(403);
    await staff(officer).post(`/records-requests/${ids.request}/copies`, { sections: [] }).expect(400);
    await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["billing"] })
      .expect(400);
    await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["consultations"], periodFrom: "2026-05-01", periodTo: "2026-04-01" })
      .expect(400);
  });

  it("compiles the chosen sections into one PDF stored as a record_copy document of the patient", async () => {
    const copy = await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, {
        sections: ["documents", "consultations", "allergies", "certificates"],
        periodFrom: manilaDate(-1),
        periodTo: manilaDate(0),
      })
      .expect(201);
    // In the copy's own order, whatever order they were chosen in.
    expect(copy.body).toMatchObject({ sections: ["allergies", "consultations", "certificates", "documents"], periodFrom: manilaDate(-1) });
    ids.copy = copy.body.documentId;

    const text = pdfText(ids.copy);
    for (const expected of [
      "Copy of Medical Records",
      "RR00000001",
      "DELA CRUZ, Juan Santos",
      "Penicillin",
      "Fever for three days",
      "Dengue fever",
      "A90",
      "Subjective: Fever and body aches",
      "Assessment: Dengue fever, no warning signs",
      "MC00000001",
      "Referral from Barangay Health Center",
      "officer",
    ]) {
      expect(text).toContain(expected);
    }
    // Sections not chosen are not in the copy.
    expect(text).not.toContain("Laboratory results");
    expect(text).not.toContain("Prescriptions");

    const doc = await ctx.pool.query("SELECT category, status, source, patient_id FROM document WHERE id = $1", [ids.copy]);
    expect(doc.rows[0]).toEqual({ category: "record_copy", status: "available", source: "generated", patient_id: patientId });
    const request = await staff(officer).get(`/records-requests/${ids.request}`).expect(200);
    expect(request.body.copies).toMatchObject([{ documentId: ids.copy, sections: ["allergies", "consultations", "certificates", "documents"] }]);
    expect(request.body.available.map((d: { id: string }) => d.id)).toContain(ids.copy);

    const audit = await auditRows(ctx.pool, "action = 'patient.records-request.copy' AND patient_id = $1", [patientId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ requestNumber: "RR00000001", documentId: ids.copy });
    expect(JSON.stringify(audit)).not.toContain("Dengue");
  });

  it("leaves out records outside the period, and earlier copies from the documents list", async () => {
    const past = await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["allergies", "consultations", "documents"], periodTo: "2020-12-31" })
      .expect(201);
    const text = pdfText(past.body.documentId);
    // Allergies are the current list whatever the period.
    expect(text).toContain("Penicillin");
    expect(text).toContain("No consultations in this period");
    expect(text).toContain("No documents in this period");
    expect(text).not.toContain("Dengue");

    const again = await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["documents"] })
      .expect(201);
    const listed = pdfText(again.body.documentId);
    expect(listed).toContain("Referral from Barangay Health Center");
    expect(listed).not.toContain("Copy of records RR00000001");
    await expect(ctx.pool.query("DELETE FROM records_request_export WHERE id = $1", [ids.copy])).rejects.toThrow();
  });

  it("is shared in answer, then no more copies are prepared for the closed request", async () => {
    const request = await staff(officer).get(`/records-requests/${ids.request}`).expect(200);
    await staff(officer)
      .post(`/records-requests/${ids.request}/fulfil`, { documentIds: [ids.copy], version: request.body.version })
      .expect(200);
    const mine = await portal.get("/documents").expect(200);
    const answered = mine.body.requests.find((r: { id: string }) => r.id === ids.request);
    expect(answered.documents).toMatchObject([{ documentId: ids.copy, category: "record_copy" }]);
    await portal.get(`/records-requests/documents/${ids.copy}/link`).expect(200);
    await staff(officer)
      .post(`/records-requests/${ids.request}/copies`, { sections: ["consultations"] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("request_closed"));
  });
});
