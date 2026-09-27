import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

describe("documents", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "docs-org");
    await createStaff(ctx.pool, tenant, "records@example.ph", ["records_officer", "receptionist"]);
    token = (await login(ctx, "records@example.ph")).accessToken;
    const created = await ctx.http().post("/api/v1/patients").set(as(token, tenant.facilityId)).send(juan).expect(201);
    patientId = created.body.id;
  });

  afterAll(() => ctx.close());

  it("uploads via a presigned URL, verifies the object, and audits downloads", async () => {
    const created = await ctx
      .http()
      .post("/api/v1/documents")
      .set(as(token, tenant.facilityId))
      .send({
        category: "consent_form",
        title: "Signed consent",
        fileName: "consent-pahintulot.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
        patientId,
      })
      .expect(201);
    expect(created.body.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } });
    expect(created.body.document).not.toHaveProperty("storageKey");
    const documentId = created.body.document.id;

    const missing = await ctx.http().post(`/api/v1/documents/${documentId}/complete`).set(as(token)).expect(422);
    expect(missing.body.error.code).toBe("upload_missing");

    const { rows } = await ctx.pool.query(`SELECT storage_key FROM document WHERE id = $1`, [documentId]);
    expect(rows[0].storage_key).not.toContain(patientId);
    ctx.storage.put(rows[0].storage_key, { sizeBytes: 999 });
    const mismatch = await ctx.http().post(`/api/v1/documents/${documentId}/complete`).set(as(token)).expect(422);
    expect(mismatch.body.error.code).toBe("upload_size_mismatch");

    ctx.storage.put(rows[0].storage_key, { sizeBytes: 2048, contentType: "application/pdf" });
    await ctx.http().post(`/api/v1/documents/${documentId}/complete`).set(as(token)).expect(200);
    const download = await ctx.http().get(`/api/v1/documents/${documentId}/download-url`).set(as(token)).expect(200);
    expect(download.body.url).toContain("consent-pahintulot.pdf");
    expect(await auditRows(ctx.pool, `action = 'document.download' AND patient_id = $1`, [patientId])).toHaveLength(1);

    const listed = await ctx.http().get(`/api/v1/documents?patientId=${patientId}`).set(as(token)).expect(200);
    expect(listed.body.map((d: { id: string }) => d.id)).toEqual([documentId]);

    await ctx.http().post(`/api/v1/documents/${documentId}/archive`).set(as(token)).send({ reason: "Superseded by new form" }).expect(200);
    await ctx.http().get(`/api/v1/documents/${documentId}/download-url`).set(as(token)).expect(422);
    const archived = await ctx.http().get(`/api/v1/documents?patientId=${patientId}&includeArchived=true`).set(as(token)).expect(200);
    expect(archived.body[0].status).toBe("archived");
  });

  it("rejects disallowed file types and patients from other organizations", async () => {
    await ctx
      .http()
      .post("/api/v1/documents")
      .set(as(token))
      .send({ category: "other", title: "Script", fileName: "run.exe", contentType: "application/x-msdownload", sizeBytes: 10 })
      .expect(400);

    const other = await createTenant(ctx.pool, "docs-other");
    await createStaff(ctx.pool, other, "other@example.ph", ["org_admin"]);
    const outsider = await login(ctx, "other@example.ph");
    await ctx
      .http()
      .post("/api/v1/documents")
      .set(as(outsider.accessToken))
      .send({ category: "other", title: "X", fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 10, patientId })
      .expect(404);
  });
});
