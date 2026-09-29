import { extractPdfText } from "@healthcare/pdf";
import {
  as,
  auditRows,
  binary,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

/**
 * Medical certificates (docs/domains/clinic.md, "Medical certificates"): issued from a signed consultation by its
 * responsible practitioner, numbered, immutable, voided with a reason; the printable copy is stored once as a
 * medical_certificate document.
 */
describe("medical certificates", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let doctor: string;
  let otherDoctor: string;
  let nurse: string;
  let admin: string;
  const ids: Record<string, string> = {};

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const certificate = { purpose: "Absence from work", findings: "Acute gastroenteritis", recommendations: "Oral rehydration; return if worse" };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "certificates-org");
    await createStaff(ctx.pool, tenant, "admin@cert.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@cert.ph", ["physician"]);
    await createClinician(ctx, tenant, "other@cert.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "nurse@cert.ph", ["nurse"]);
    admin = (await login(ctx, "admin@cert.ph")).accessToken;
    doctor = (await login(ctx, "doctor@cert.ph")).accessToken;
    otherDoctor = (await login(ctx, "other@cert.ph")).accessToken;
    nurse = (await login(ctx, "nurse@cert.ph")).accessToken;
    ids.patient = (await req(admin).post("/patients", juan).expect(201)).body.id;
    ids.encounter = (await req(doctor).post("/encounters", { patientId: ids.patient, chiefComplaint: "Diarrhoea" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("is issued only from a signed consultation, by its responsible practitioner", async () => {
    await req(doctor)
      .post(`/encounters/${ids.encounter}/certificates`, certificate)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("encounter_not_signed"));
    await req(doctor).put(`/encounters/${ids.encounter}/note`, { assessment: "Acute gastroenteritis", plan: "ORS, rest", basedOnRevision: 0 }).expect(200);
    const current = await req(doctor).get(`/encounters/${ids.encounter}`).expect(200);
    await req(doctor).post(`/encounters/${ids.encounter}/sign`, { version: current.body.version }).expect(200);

    await req(nurse).post(`/encounters/${ids.encounter}/certificates`, certificate).expect(403);
    await req(otherDoctor).post(`/encounters/${ids.encounter}/certificates`, certificate).expect(403);
    await req(doctor)
      .post(`/encounters/${ids.encounter}/certificates`, { ...certificate, purpose: "x" })
      .expect(400);
    await req(doctor)
      .post(`/encounters/${ids.encounter}/certificates`, { ...certificate, rest: { from: manilaDate(2), to: manilaDate(1) } })
      .expect(400);

    const issued = await req(doctor)
      .post(`/encounters/${ids.encounter}/certificates`, { ...certificate, rest: { from: manilaDate(0), to: manilaDate(2) } })
      .expect(201);
    expect(issued.body).toMatchObject({
      certificateNumber: "MC00000001",
      examinedOn: manilaDate(0),
      status: "issued",
      restDays: 3,
      practitionerName: "Dr. doctor",
    });
    ids.certificate = issued.body.id;
    const second = await req(doctor).post(`/encounters/${ids.encounter}/certificates`, { purpose: "School", findings: "Seen today" }).expect(201);
    expect(second.body.certificateNumber).toBe("MC00000002");
    ids.second = second.body.id;
    expect((await req(nurse).get(`/encounters/${ids.encounter}/certificates`).expect(200)).body.map((c: { id: string }) => c.id)).toEqual([
      ids.second,
      ids.certificate,
    ]);
  });

  it("stores the printable copy once as a medical_certificate document of the patient", async () => {
    const response = await req(nurse).get(`/medical-certificates/${ids.certificate}/certificate.pdf`).buffer(true).parse(binary).expect(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    const text = extractPdfText(response.body as Buffer)
      .replace(/·/g, "")
      .replace(/\s+/g, " ");
    for (const expected of [
      "Medical Certificate",
      "MC00000001",
      "DELA CRUZ, Juan Santos",
      "Absence from work",
      "Acute gastroenteritis",
      "3 days",
      "PRC-0000000",
    ]) {
      expect(text).toContain(expected);
    }
    const docs = await ctx.pool.query<{ id: string; category: string; status: string }>(
      "SELECT id, category, status FROM document WHERE patient_id = $1 ORDER BY created_at",
      [ids.patient],
    );
    expect(docs.rows).toEqual([
      { id: ids.certificate, category: "medical_certificate", status: "available" },
      { id: ids.second, category: "medical_certificate", status: "available" },
    ]);
    // The patient's documents list shows it like any other document.
    const listed = await req(admin).get(`/documents?patientId=${ids.patient}`).expect(200);
    expect(listed.body.map((d: { id: string }) => d.id)).toContain(ids.certificate);
  });

  it("never changes once issued; a mistaken one is voided with a reason and its document archived", async () => {
    await expect(ctx.pool.query("UPDATE medical_certificate SET findings = 'Other' WHERE id = $1", [ids.certificate])).rejects.toThrow(/not edited/);
    await expect(ctx.pool.query("DELETE FROM medical_certificate WHERE id = $1", [ids.certificate])).rejects.toThrow(/never deleted/);

    await req(nurse).post(`/medical-certificates/${ids.second}/void`, { reason: "Wrong purpose" }).expect(403);
    await req(doctor).post(`/medical-certificates/${ids.second}/void`, { reason: "x" }).expect(400);
    const voided = await req(doctor).post(`/medical-certificates/${ids.second}/void`, { reason: "Wrong purpose" }).expect(200);
    expect(voided.body).toMatchObject({ status: "void", voidReason: "Wrong purpose" });
    await req(doctor)
      .post(`/medical-certificates/${ids.second}/void`, { reason: "Wrong purpose" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("certificate_void"));
    const doc = await ctx.pool.query<{ status: string }>("SELECT status FROM document WHERE id = $1", [ids.second]);
    expect(doc.rows[0]?.status).toBe("archived");
    const copy = await req(doctor).get(`/medical-certificates/${ids.second}/certificate.pdf`).buffer(true).parse(binary).expect(200);
    expect(extractPdfText(copy.body as Buffer)).toContain("VOID");

    const audit = await auditRows(ctx.pool, "action LIKE 'encounter.certificate.%' AND patient_id = $1", [ids.patient]);
    expect(audit.map((a) => a.action)).toEqual([
      "encounter.certificate.issue",
      "encounter.certificate.issue",
      "encounter.certificate.void",
      "encounter.certificate.print",
    ]);
    const events = await ctx.pool.query("SELECT event_type, payload FROM domain_event WHERE aggregate_type = 'medical_certificate' ORDER BY occurred_at");
    expect(events.rows.map((e: { event_type: string }) => e.event_type)).toEqual([
      "MedicalCertificateIssued",
      "MedicalCertificateIssued",
      "MedicalCertificateVoided",
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("gastroenteritis");
  });
});
