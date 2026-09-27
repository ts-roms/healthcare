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

  describe("consent forms", () => {
    let otherPatientId: string;

    const upload = async (overrides: Record<string, unknown> = {}, complete = true): Promise<string> => {
      const body = {
        category: "consent_form",
        title: "Signed consent",
        fileName: "consent.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        patientId,
        ...overrides,
      };
      const created = await ctx.http().post("/api/v1/documents").set(as(token, tenant.facilityId)).send(body).expect(201);
      const id: string = created.body.document.id;
      if (complete) {
        const { rows } = await ctx.pool.query(`SELECT storage_key FROM document WHERE id = $1`, [id]);
        ctx.storage.put(rows[0].storage_key, { sizeBytes: body.sizeBytes as number, contentType: body.contentType as string });
        await ctx.http().post(`/api/v1/documents/${id}/complete`).set(as(token)).expect(200);
      }
      return id;
    };
    const recordConsent = (forPatient: string, documentId: string) =>
      ctx
        .http()
        .post(`/api/v1/patients/${forPatient}/consents`)
        .set(as(token))
        .send({ consentType: "portal_access", decision: "granted", capturedVia: "paper", documentId });

    beforeAll(async () => {
      const other = { ...juan, givenName: "Maria", middleName: "Reyes", sex: "female", birthDate: "1991-07-19", contacts: [], identifiers: [] };
      otherPatientId = (await ctx.http().post("/api/v1/patients").set(as(token, tenant.facilityId)).send(other).expect(201)).body.id;
    });

    it("links the patient's uploaded consent form to the consent", async () => {
      const documentId = await upload();
      const response = await recordConsent(patientId, documentId).expect(201);
      expect(response.body.documentId).toBe(documentId);
    });

    it("rejects another patient's form, a pending upload and other document categories", async () => {
      const othersForm = await upload({ patientId: otherPatientId });
      const pending = await upload({}, false);
      const idCard = await upload({ category: "identification", title: "PhilHealth ID" });
      for (const documentId of [othersForm, pending, idCard]) {
        expect((await recordConsent(patientId, documentId).expect(422)).body.error.code).toBe("consent_document_invalid");
      }
      expect((await recordConsent(patientId, "00000000-0000-4000-8000-000000000000").expect(422)).body.error.code).toBe("consent_document_invalid");
    });

    it("enforces the same patient in the database too", async () => {
      const othersForm = await upload({ patientId: otherPatientId });
      await expect(
        ctx.pool.query(
          `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, captured_via, document_id, recorded_by)
           SELECT organization_id, $1, 'research', 'granted', 'paper', $2, created_by FROM document WHERE id = $2`,
          [patientId, othersForm],
        ),
      ).rejects.toThrow(/patient_consent_document_same_patient_fkey/);
    });
  });
});
