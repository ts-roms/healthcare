import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, binary, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const stroke = [
  [0.05, 0.6],
  [0.2, 0.2],
  [0.35, 0.7],
  [0.5, 0.25],
  [0.8, 0.55],
];
const other = [
  [0.1, 0.3],
  [0.4, 0.8],
  [0.7, 0.2],
  [0.9, 0.6],
];

/**
 * A practitioner's own signature on the certificates and letters they issue (docs/architecture/electronic-signatures.md,
 * phase 3): drawn by the practitioner themself, printed only when the organization turns it on, recorded on each document
 * when it is issued so a later change never alters what an issued document shows.
 */
describe("practitioner signatures on certificates and referral letters", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let patientId: string;
  let encounterId: string;
  const ids: Record<string, string> = {};

  const code = (status: number, expected: string) => (r: { status: number; body: { error?: { code?: string } } }) => {
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(expected);
  };
  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const signatureOf = async (table: "medical_certificate" | "referral", id: string) =>
    (await ctx.pool.query<{ practitioner_signature_id: string | null }>(`SELECT practitioner_signature_id FROM ${table} WHERE id = $1`, [id])).rows[0]!
      .practitioner_signature_id;
  const issueCertificate = async (purpose: string) =>
    (await req(doctor).post(`/encounters/${encounterId}/certificates`, { purpose, findings: "Seen today and well" }).expect(201)).body.id as string;
  const pdfText = async (url: string) =>
    extractPdfText((await req(doctor).get(url).buffer(true).parse(binary).expect(200)).body as Buffer).replace(/\s+/g, " ");

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "practitioner-signature-org");
    await createStaff(ctx.pool, tenant, "admin@psig.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@psig.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "nurse@psig.ph", ["nurse"]);
    admin = (await login(ctx, "admin@psig.ph")).accessToken;
    doctor = (await login(ctx, "doctor@psig.ph")).accessToken;
    nurse = (await login(ctx, "nurse@psig.ph")).accessToken;
    patientId = (await req(admin).post("/patients", juan).expect(201)).body.id;
    encounterId = (await req(doctor).post("/encounters", { patientId, chiefComplaint: "Cough" }).expect(201)).body.id;
    await req(doctor).put(`/encounters/${encounterId}/note`, { assessment: "Cough", plan: "Fluids", basedOnRevision: 0 }).expect(200);
    const current = await req(doctor).get(`/encounters/${encounterId}`).expect(200);
    await req(doctor).post(`/encounters/${encounterId}/sign`, { version: current.body.version }).expect(200);
  });
  afterAll(() => ctx.close());

  it("is off until the organization turns it on, and only a practitioner draws their own", async () => {
    expect((await req(nurse).get("/clinic/practitioner-signature/settings").expect(200)).body).toEqual({ enabled: false, version: 0 });
    await req(nurse).put("/clinic/practitioner-signature/settings", { enabled: true, version: 0 }).expect(403);
    // Someone who is not a practitioner has nothing to sign as.
    expect((await req(nurse).get("/me/practitioner-signature").expect(200)).body).toMatchObject({ practitioner: null, signature: null });
    await req(nurse)
      .put("/me/practitioner-signature", { strokes: [stroke] })
      .expect(403);
    await req(nurse).post("/me/practitioner-signature/withdraw").expect(403);

    const mine = (await req(doctor).get("/me/practitioner-signature").expect(200)).body;
    expect(mine).toMatchObject({ practitioner: { displayName: "Dr. doctor" }, enabled: false, signature: null });
    await req(doctor)
      .put("/me/practitioner-signature", { strokes: [[[0.5, 0.5]]] })
      .expect(code(422, "signature_empty"));
    await req(doctor).put("/me/practitioner-signature", { strokes: [] }).expect(400);
    await req(doctor).post("/me/practitioner-signature/withdraw").expect(code(422, "no_signature"));
    const drawn = (
      await req(doctor)
        .put("/me/practitioner-signature", { strokes: [stroke] })
        .expect(200)
    ).body;
    ids.first = drawn.signature.id;
    expect(drawn.signature.strokes).toEqual([stroke]);
    // The administrator does not see or set anyone's signature.
    expect((await req(admin).get("/me/practitioner-signature").expect(200)).body.signature).toBeNull();
    const audit = await auditRows(ctx.pool, "action = 'practitioner.signature-draw'");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/0\.2/);
  });

  it("prints nothing while the organization has it off, and records the signature in force when a document is issued", async () => {
    ids.before = await issueCertificate("Before the setting");
    expect(await signatureOf("medical_certificate", ids.before)).toBeNull();
    const saved = await req(admin).put("/clinic/practitioner-signature/settings", { enabled: true, version: 0 }).expect(200);
    expect(saved.body).toEqual({ enabled: true, version: 1 });
    await req(admin).put("/clinic/practitioner-signature/settings", { enabled: false, version: 0 }).expect(409);

    ids.after = await issueCertificate("After the setting");
    expect(await signatureOf("medical_certificate", ids.after)).toBe(ids.first);
    // The printable copy names the issuer under the mark.
    const text = await pdfText(`/medical-certificates/${ids.after}/certificate.pdf`);
    expect(text).toContain("Dr. doctor");
    expect(text).toContain("PRC-0000000");
    // An earlier certificate is not rewritten.
    expect(await signatureOf("medical_certificate", ids.before)).toBeNull();
  });

  it("keeps each document's own signature when the practitioner draws another or withdraws it", async () => {
    ids.second = (
      await req(doctor)
        .put("/me/practitioner-signature", { strokes: [other] })
        .expect(200)
    ).body.signature.id;
    expect(ids.second).not.toBe(ids.first);
    ids.third = await issueCertificate("With the second signature");
    expect(await signatureOf("medical_certificate", ids.third)).toBe(ids.second);
    expect(await signatureOf("medical_certificate", ids.after)).toBe(ids.first);
    // The earlier signature is withdrawn, not deleted: the document that printed it still names it.
    const { rows } = await ctx.pool.query("SELECT id, withdrawn_at FROM practitioner_signature ORDER BY drawn_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].withdrawn_at).not.toBeNull();
    expect(rows[1].withdrawn_at).toBeNull();

    const withdrawn = (await req(doctor).post("/me/practitioner-signature/withdraw").expect(200)).body;
    expect(withdrawn.signature).toBeNull();
    ids.none = await issueCertificate("After withdrawing");
    expect(await signatureOf("medical_certificate", ids.none)).toBeNull();
    expect(await signatureOf("medical_certificate", ids.third)).toBe(ids.second);
    // Voiding an issued certificate re-renders it from the signature it recorded, not the one in force.
    await req(doctor).post(`/medical-certificates/${ids.third}/void`, { reason: "Issued for the wrong purpose" }).expect(200);
    expect(await pdfText(`/medical-certificates/${ids.third}/certificate.pdf`)).toContain("VOID");
    expect(await signatureOf("medical_certificate", ids.third)).toBe(ids.second);
  });

  it("is also recorded on referral letters, and what is recorded cannot be changed", async () => {
    ids.drawn = (
      await req(doctor)
        .put("/me/practitioner-signature", { strokes: [stroke] })
        .expect(200)
    ).body.signature.id;
    const referral = await req(doctor)
      .post(`/encounters/${encounterId}/referrals`, { kind: "external", externalProvider: "Dr. R. Reyes, Cardiology", reason: "Stress test" })
      .expect(201);
    expect(await signatureOf("referral", referral.body.id)).toBe(ids.drawn);
    expect(await pdfText(`/referrals/${referral.body.id}/letter.pdf`)).toContain("Referring practitioner");

    await expect(ctx.pool.query("UPDATE referral SET practitioner_signature_id = NULL WHERE id = $1", [referral.body.id])).rejects.toThrow();
    await expect(ctx.pool.query("UPDATE medical_certificate SET practitioner_signature_id = NULL WHERE id = $1", [ids.after])).rejects.toThrow();
    await expect(ctx.pool.query("UPDATE practitioner_signature SET strokes = '[[[0,0],[1,1]]]'::jsonb WHERE id = $1", [ids.first])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM practitioner_signature WHERE id = $1", [ids.first])).rejects.toThrow();
    expect((await auditRows(ctx.pool, "action = 'clinic.practitioner-signature-settings.update'")).length).toBe(1);
  });
});
