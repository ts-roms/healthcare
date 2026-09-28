import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, binary, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Result attachments (docs/domains/laboratory.md#result-attachments): files on a result version, uploaded in two steps
 * like documents, kept as laboratory-managed documents (invisible to the generic documents API and FHIR), shown to
 * clinicians only once the result is released, and frozen from verification on.
 */
describe("laboratory result attachments", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let doctor: string;
  let patientId: string;
  let orderId: string;
  let resultId: string;
  let attachmentId: string;

  const lab = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/laboratory${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/laboratory${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const file = (title: string, sizeBytes = 2048) => ({
    title,
    fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    contentType: "application/pdf",
    sizeBytes,
  });
  const storageKey = async (id: string) =>
    (await ctx.pool.query(`SELECT d.storage_key, d.id FROM lab_result_attachment a JOIN document d ON d.id = a.document_id WHERE a.id = $1`, [id])).rows[0] as {
      storage_key: string;
      id: string;
    };
  /** Registers, uploads (as the client would, to the presigned URL) and completes an attachment. */
  const attach = async (title: string) => {
    const started = await lab(medtech).post(`/results/${resultId}/attachments`, file(title)).expect(201);
    ctx.storage.put((await storageKey(started.body.attachment.id)).storage_key, { sizeBytes: 2048, contentType: "application/pdf" });
    return (await lab(medtech).post(`/attachments/${started.body.attachment.id}/complete`).expect(200)).body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "attach-org");
    await createStaff(ctx.pool, tenant, "admin@attach.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "medtech@attach.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    const { practitionerId, userId } = await createClinician(ctx, tenant, "doc@attach.ph", ["physician"]);
    admin = (await login(ctx, "admin@attach.ph")).accessToken;
    medtech = (await login(ctx, "medtech@attach.ph")).accessToken;
    doctor = (await login(ctx, "doc@attach.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
    const encounterId = (
      await ctx.pool.query(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, practitionerId, userId],
      )
    ).rows[0].id;
    const chem = (await lab(admin).post("/departments", { code: "micro", name: "Microbiology" }).expect(201)).body.id;
    const swab = (await lab(admin).post("/specimen-types", { code: "swab", name: "Swab" }).expect(201)).body.id;
    const test = (
      await lab(admin).post("/tests", { code: "culture", name: "Wound culture", departmentId: chem, specimenTypeId: swab, resultType: "text" }).expect(201)
    ).body.id;
    const order = await lab(doctor)
      .post("/orders", { patientId, encounterId, testIds: [test] })
      .expect(201);
    orderId = order.body.id;
    const item = order.body.items[0];
    const specimen = (
      await lab(medtech)
        .post(`/orders/${orderId}/specimens`, { specimenTypeId: item.specimenTypeId, itemIds: [item.id] })
        .expect(201)
    ).body.specimens[0].id;
    await lab(medtech).post(`/specimens/${specimen}/receive`).expect(200);
    resultId = (await lab(medtech).post(`/order-items/${item.id}/results`, { valueText: "Staphylococcus aureus, heavy growth" }).expect(201)).body.id;
  });

  afterAll(() => ctx.close());

  it("uploads a file to an entered result in two steps and keeps it as a laboratory-managed document", async () => {
    const started = await lab(medtech).post(`/results/${resultId}/attachments`, file("Culture plate photo")).expect(201);
    expect(started.body.attachment).toMatchObject({ status: "pending", title: "Culture plate photo", contentType: "application/pdf", sizeBytes: 2048 });
    expect(started.body.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } });
    attachmentId = started.body.attachment.id;

    const missing = await lab(medtech).post(`/attachments/${attachmentId}/complete`).expect(422);
    expect(missing.body.error.code).toBe("upload_missing");
    const { storage_key: key, id: documentId } = await storageKey(attachmentId);
    expect(key).not.toContain(patientId);
    ctx.storage.put(key, { sizeBytes: 2048, contentType: "application/pdf" });
    const completed = await lab(medtech).post(`/attachments/${attachmentId}/complete`).expect(200);
    expect(completed.body).toMatchObject({ id: attachmentId, status: "attached" });
    const doc = (await ctx.pool.query(`SELECT managed_by, category, status, patient_id FROM document WHERE id = $1`, [documentId])).rows[0];
    expect(doc).toEqual({ managed_by: "laboratory", category: "clinical_attachment", status: "available", patient_id: patientId });

    // The generic documents API and the FHIR export neither list nor serve it.
    const listed = await ctx.http().get(`/api/v1/documents?patientId=${patientId}`).set(as(admin)).expect(200);
    expect(listed.body.map((d: { id: string }) => d.id)).not.toContain(documentId);
    await ctx.http().get(`/api/v1/documents/${documentId}`).set(as(admin)).expect(404);
    await ctx.http().get(`/api/v1/documents/${documentId}/download-url`).set(as(admin)).expect(404);
    const fhir = await ctx.http().get(`/api/v1/fhir/r4/DocumentReference?patient=${patientId}`).set(as(admin, tenant.facilityId)).expect(200);
    expect(JSON.stringify(fhir.body)).not.toContain(documentId);
    await ctx.http().get(`/api/v1/fhir/r4/Binary/${documentId}`).set(as(admin, tenant.facilityId)).expect(404);
  });

  it("shows attachments of an unreleased result to laboratory staff only", async () => {
    const own = await lab(medtech).get(`/results/${resultId}/attachments`).expect(200);
    expect(own.body.map((a: { id: string }) => a.id)).toEqual([attachmentId]);
    await lab(medtech).get(`/attachments/${attachmentId}/download-url`).expect(200);
    await lab(doctor).get(`/results/${resultId}/attachments`).expect(404);
    await lab(doctor).get(`/attachments/${attachmentId}/download-url`).expect(404);
    // The workbench's order view carries them with the result.
    const order = await lab(medtech).get(`/orders/${orderId}`).expect(200);
    expect(order.body.items[0].result.attachments).toEqual([expect.objectContaining({ id: attachmentId, status: "attached" })]);
  });

  it("removes an attachment before verification with a reason, and refuses to verify while an upload is unfinished", async () => {
    const extra = await attach("Wrong photo");
    await lab(medtech).post(`/attachments/${extra.id}/remove`, { reason: "no" }).expect(400);
    const removed = await lab(medtech).post(`/attachments/${extra.id}/remove`, { reason: "Photo of another plate" }).expect(200);
    expect(removed.body).toMatchObject({ status: "removed" });
    const { id: extraDocument } = await storageKey(extra.id);
    expect((await ctx.pool.query(`SELECT status, archive_reason FROM document WHERE id = $1`, [extraDocument])).rows[0]).toEqual({
      status: "archived",
      archive_reason: "Photo of another plate",
    });

    const pending = await lab(medtech).post(`/results/${resultId}/attachments`, file("Unfinished")).expect(201);
    const refused = await lab(admin).post(`/results/${resultId}/verify`).expect(422);
    expect(refused.body.error.code).toBe("attachment_pending");
    await lab(medtech).post(`/attachments/${pending.body.attachment.id}/remove`, { reason: "Upload abandoned" }).expect(200);

    const list = await lab(medtech).get(`/results/${resultId}/attachments`).expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([attachmentId]);
    const actions = (await auditRows(ctx.pool, "patient_id = $1 AND action LIKE 'lab.result.attachment.%'", [patientId])).map((a) => a.action);
    expect(actions.filter((a) => a === "lab.result.attachment.add")).toHaveLength(3);
    expect(actions.filter((a) => a === "lab.result.attachment.remove")).toHaveLength(2);
  });

  it("freezes attachments from verification on; clinicians see them once released, and the report lists them", async () => {
    await lab(admin).post(`/results/${resultId}/verify`).expect(200);
    expect((await lab(medtech).post(`/results/${resultId}/attachments`, file("Late")).expect(422)).body.error.code).toBe("result_not_editable");
    expect((await lab(medtech).post(`/attachments/${attachmentId}/remove`, { reason: "Changed my mind" }).expect(422)).body.error.code).toBe(
      "result_not_editable",
    );
    // The database refuses it too.
    await expect(ctx.pool.query(`UPDATE lab_result_attachment SET title = 'x' WHERE id = $1`, [attachmentId])).rejects.toThrow(
      /only while the result is entered/,
    );
    await expect(ctx.pool.query(`DELETE FROM lab_result_attachment WHERE id = $1`, [attachmentId])).rejects.toThrow(/not deleted/);

    await lab(admin).post(`/results/${resultId}/approve`).expect(200);
    await lab(admin).post(`/results/${resultId}/release`).expect(200);
    const seen = await lab(doctor).get(`/results/${resultId}/attachments`).expect(200);
    expect(seen.body).toEqual([expect.objectContaining({ id: attachmentId, title: "Culture plate photo", status: "attached" })]);
    const link = await lab(doctor).get(`/attachments/${attachmentId}/download-url`).expect(200);
    expect(link.body.url).toContain("culture-plate-photo.pdf");
    const { id: documentId } = await storageKey(attachmentId);
    expect(await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1", [documentId])).toHaveLength(2);

    const report = await ctx
      .http()
      .get(`/api/v1/laboratory/orders/${orderId}/report.pdf`)
      .set(as(doctor, tenant.facilityId))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const text = extractPdfText(report.body as Buffer);
    expect(text).toContain("Attachments");
    expect(text).toContain("Culture plate photo (culture-plate-photo.pdf)");
    expect(text).not.toContain("Wrong photo");
  });
});
