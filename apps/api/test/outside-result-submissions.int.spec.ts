import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

const PASSWORD = "Resulta-mula-sa-labas-2026";

interface Submission {
  id: string;
  status: string;
  sourceName: string;
  tests: string;
  declineReason: string | null;
  answeredAt: string | null;
  patient?: { id: string; patientNumber: string };
  outsideResultId?: string | null;
}

/**
 * Results patients send from MyHealth (docs/domains/outside-results.md, "Sent by patients"): the patient uploads a report
 * and describes it; nothing is on their record until the records office files it (then a clinician reviews it) or
 * declines it with a reason the patient reads; the patient may withdraw while it waits.
 */
describe("outside results sent by patients", () => {
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
  /** Uploads a report the way MyHealth does: prepare, put the bytes, confirm. */
  const upload = async (contentType = "application/pdf", sizeBytes = 2048): Promise<string> => {
    const prepared = await portal.post("/outside-results/uploads", { fileName: "result.pdf", contentType, sizeBytes }).expect(201);
    const id: string = prepared.body.document.id;
    const { rows } = await ctx.pool.query(`SELECT storage_key FROM document WHERE id = $1`, [id]);
    ctx.storage.put(rows[0].storage_key, { sizeBytes, contentType });
    await portal.post(`/outside-results/uploads/${id}/complete`).expect(200);
    return id;
  };
  const send = (documentId: string, extra: object = {}) =>
    portal.post("/outside-results", { documentId, sourceName: "Hi-Precision Diagnostics", tests: "Lipid profile", ...extra });
  const mine = async (): Promise<Submission[]> => (await portal.get("/outside-results").expect(200)).body;
  const queue = async (t = officer): Promise<Submission[]> => (await staff(t).get("/outside-result-submissions").expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "outsub-org");
    await createStaff(ctx.pool, tenant, "admin@outsub.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@outsub.ph", ["records_officer"]);
    await createClinician(ctx, tenant, "nurse@outsub.ph", ["nurse"], "nurse");
    await createClinician(ctx, tenant, "doctor@outsub.ph", ["physician"]);
    [admin, officer, nurse, doctor] = await Promise.all(
      ["admin", "records", "nurse", "doctor"].map(async (u) => (await login(ctx, `${u}@outsub.ph`)).accessToken),
    );
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;

    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string }>("SELECT patient_number FROM patient WHERE id = $1", [patientId]);
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "outsub-org",
        patientNumber: rows[0]!.patient_number,
        birthDate: juan.birthDate,
        activationCode: code,
        email: "juan@outsub.ph",
        password: PASSWORD,
      })
      .expect(200);
    token = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "outsub-org", email: "juan@outsub.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;
  });
  afterAll(async () => ctx.close());

  it("lets the patient upload a report and send it with their own description, and tells the records office", async () => {
    ids.doc1 = await upload();
    const sent = await send(ids.doc1, { performedOn: manilaDate(-3), notes: "My doctor asked for this" }).expect(201);
    ids.sub1 = sent.body.id;
    expect(sent.body).toMatchObject({
      status: "submitted",
      sourceName: "Hi-Precision Diagnostics",
      tests: "Lipid profile",
      declineReason: null,
      answeredAt: null,
    });

    // The uploaded file is a private document of the patient's record, of its own category.
    const doc = await ctx.pool.query(`SELECT category, source, status FROM document WHERE id = $1`, [ids.doc1]);
    expect(doc.rows[0]).toMatchObject({ category: "outside_result", source: "patient_upload", status: "available" });
    expect((await mine()).map((s) => s.id)).toEqual([ids.sub1]);

    // Nothing is on the record yet: no outside result, nothing in the timeline.
    expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM outside_result WHERE patient_id = $1`, [patientId])).rows[0].n).toBe(0);
    expect((await staff(doctor).get(`/patients/${patientId}/timeline?kinds=outside_result`).expect(200)).body.items).toEqual([]);

    const audit = await auditRows(ctx.pool, "action = 'portal.outside-result-submit' AND patient_id = $1", [patientId]);
    expect(audit[0]).toMatchObject({ actor_type: "patient" });

    await drainEvents(ctx);
    const notices = (await ctx.http().get("/api/v1/me/notifications").set(as(officer)).expect(200)).body.filter(
      (n: { templateKey: string }) => n.templateKey === "records.outside-result-new",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ href: "/records/outside-results" });
    expect(JSON.stringify(notices)).not.toMatch(/Lipid|Hi-Precision/);
    expect((await ctx.http().get("/api/v1/me/notifications").set(as(nurse)).expect(200)).body).toEqual([]);
  });

  it("shows the records office the queue, with the patient and what they wrote, and a link to the report", async () => {
    const waiting = await queue();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ id: ids.sub1, tests: "Lipid profile", patient: { id: patientId } });
    expect((await staff(officer).get(`/outside-result-submissions/${ids.sub1}/link`).expect(200)).body.url).toEqual(expect.any(String));
    expect((await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1", [ids.doc1])).length).toBe(1);
    expect((await auditRows(ctx.pool, "action = 'outside-result.submission-view' AND patient_id = $1", [patientId])).length).toBeGreaterThan(0);
    expect((await staff(admin).get("/me/badges").expect(200)).body.outsideResultSubmissions).toBe(1);
    expect((await staff(nurse).get("/me/badges").expect(200)).body.outsideResultSubmissions).toBeNull();

    // Only those who answer them may see them.
    await staff(nurse).get("/outside-result-submissions").expect(403);
    await staff(doctor).get("/outside-result-submissions").expect(403);
    await staff(nurse).post(`/outside-result-submissions/${ids.sub1}/decline`, { reason: "Not legible" }).expect(403);

    // The patient opens their own report too, and nobody else's.
    expect((await portal.get(`/outside-results/${ids.sub1}/link`).expect(200)).body.url).toEqual(expect.any(String));
  });

  it("files it on the record as the records office reads it; a clinician then reviews it; the patient is told without detail", async () => {
    await staff(officer)
      .post(`/outside-result-submissions/${ids.sub1}/file`, {
        sourceName: "Hi-Precision Diagnostics, Makati",
        sourceKind: "laboratory",
        performedOn: "2999-01-01",
        tests: "Lipid profile",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("performed_on_in_future"));
    const filed = await staff(officer)
      .post(`/outside-result-submissions/${ids.sub1}/file`, {
        sourceName: "Hi-Precision Diagnostics, Makati",
        sourceKind: "laboratory",
        performedOn: manilaDate(-3),
        tests: "Lipid profile (fasting)",
      })
      .expect(200);
    expect(filed.body).toMatchObject({ status: "filed", outsideResultId: expect.any(String), decidedByName: expect.any(String) });
    ids.result = filed.body.outsideResultId;

    // It is an ordinary outside result received from the patient, awaiting a clinician's review.
    const record = (await staff(doctor).get(`/patients/${patientId}/outside-results`).expect(200)).body as Array<{
      id: string;
      receivedFrom: string;
      tests: string;
      review: unknown;
      documentId: string;
    }>;
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ id: ids.result, receivedFrom: "patient", tests: "Lipid profile (fasting)", review: null, documentId: ids.doc1 });
    expect((await staff(doctor).get("/outside-results/unreviewed").expect(200)).body.map((r: { id: string }) => r.id)).toContain(ids.result);
    expect(await queue()).toEqual([]);

    await staff(officer)
      .post(`/outside-result-submissions/${ids.sub1}/decline`, { reason: "Changed my mind" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("submission_answered"));
    await portal
      .post(`/outside-results/${ids.sub1}/withdraw`)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("submission_answered"));
    expect(await mine()).toEqual([expect.objectContaining({ id: ids.sub1, status: "filed", answeredAt: expect.any(String) })]);

    await drainEvents(ctx);
    const sent = await ctx.pool.query<{ channel: string; variables: Record<string, unknown> }>(
      `SELECT channel, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'records.update' AND variables->>'kind' = 'outside-result-answered'`,
      [patientId],
    );
    expect(sent.rows.some((r) => r.channel === "in_app")).toBe(true);
    expect(JSON.stringify(sent.rows)).not.toMatch(/Lipid|Hi-Precision|fasting/);
    expect((await auditRows(ctx.pool, "action = 'outside-result.submission-file' AND patient_id = $1", [patientId])).length).toBe(1);
  });

  it("lets the records office decline with a reason the patient reads, and the patient withdraw while it waits", async () => {
    ids.doc2 = await upload("image/jpeg", 4096);
    ids.sub2 = (await send(ids.doc2, { tests: "Chest X-ray result" }).expect(201)).body.id;
    await staff(officer).post(`/outside-result-submissions/${ids.sub2}/decline`, { reason: "no" }).expect(400);
    const declined = await staff(officer)
      .post(`/outside-result-submissions/${ids.sub2}/decline`, { reason: "The photo is too blurry to read. Please send a clearer one." })
      .expect(200);
    expect(declined.body).toMatchObject({ status: "declined", declineReason: "The photo is too blurry to read. Please send a clearer one." });
    const patientsView = (await mine()).find((s) => s.id === ids.sub2);
    expect(patientsView).toMatchObject({ status: "declined", declineReason: "The photo is too blurry to read. Please send a clearer one." });
    expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM outside_result WHERE patient_id = $1`, [patientId])).rows[0].n).toBe(1);

    ids.doc3 = await upload();
    ids.sub3 = (await send(ids.doc3, { tests: "Urinalysis" }).expect(201)).body.id;
    const withdrawn = await portal.post(`/outside-results/${ids.sub3}/withdraw`).expect(200);
    expect(withdrawn.body).toMatchObject({ status: "withdrawn", answeredAt: expect.any(String) });
    expect(await queue()).toEqual([]);
    await staff(officer)
      .post(`/outside-result-submissions/${ids.sub3}/file`, { sourceName: "Lab", sourceKind: "laboratory", performedOn: manilaDate(0), tests: "Urinalysis" })
      .expect(422);
    expect((await auditRows(ctx.pool, "action = 'portal.outside-result-withdraw' AND patient_id = $1", [patientId])).length).toBe(1);
  });

  it("limits what a patient can send: a report of their own, once, three waiting at most, valid details", async () => {
    // Not someone else's file, not a made-up id, and not a staff upload.
    await send("3f1c7f0e-6a55-4d3e-9a62-1b0f2c8a9d11").expect(422);
    const staffUpload = (
      await staff(officer)
        .post("/documents", {
          category: "outside_result",
          title: "Staff upload",
          fileName: "s.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          patientId,
        })
        .expect(201)
    ).body.document.id;
    const { rows } = await ctx.pool.query(`SELECT storage_key FROM document WHERE id = $1`, [staffUpload]);
    ctx.storage.put(rows[0].storage_key, { sizeBytes: 1024, contentType: "application/pdf" });
    await staff(officer).post(`/documents/${staffUpload}/complete`).expect(200);
    await send(staffUpload)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_not_of_patient"));

    // The same report cannot be sent twice while one of them stands.
    await send(ids.doc3, { tests: "Urinalysis again" }).expect(201); // the withdrawn one may be sent again
    await send(ids.doc3)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("submission_exists"));

    // Details: what and where, a day that is not in the future, a file type the clinic accepts.
    const fresh = await upload();
    await send(fresh, { tests: "" }).expect(400);
    await send(fresh, { sourceName: "x" }).expect(400);
    await send(fresh, { performedOn: "2999-01-01" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("performed_on_in_future"));
    await portal.post("/outside-results/uploads", { fileName: "r.exe", contentType: "application/x-msdownload", sizeBytes: 100 }).expect(400);
    await portal.post("/outside-results/uploads", { fileName: "big.pdf", contentType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }).expect(400);

    // Three waiting at most.
    await send(fresh, { tests: "CBC" }).expect(201);
    const another = await upload();
    await send(another, { tests: "HbA1c" }).expect(201);
    expect((await queue()).length).toBe(3);
    const overflow = await upload().catch(() => null);
    expect(overflow).toBeNull(); // preparing a fourth upload is refused while three wait
    await portal
      .post("/outside-results/uploads", { fileName: "result.pdf", contentType: "application/pdf", sizeBytes: 1024 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("too_many_open_submissions"));
  });

  it("is a record that never changes: only the first answer, never deleted; and staff cannot see another organization's", async () => {
    await expect(ctx.pool.query(`UPDATE outside_result_submission SET tests = 'Something else' WHERE id = $1`, [ids.sub1])).rejects.toThrow(
      /only the first answer/,
    );
    await expect(
      ctx.pool.query(
        `UPDATE outside_result_submission SET status = 'submitted', outside_result_id = NULL, decided_by = NULL, decided_at = NULL WHERE id = $1`,
        [ids.sub1],
      ),
    ).rejects.toThrow();
    await expect(ctx.pool.query(`DELETE FROM outside_result_submission WHERE id = $1`, [ids.sub1])).rejects.toThrow(/never deleted/);

    const other = await createTenant(ctx.pool, "outsub-other");
    await createStaff(ctx.pool, other, "records@outsub-other.ph", ["records_officer"]);
    const outsider = (await login(ctx, "records@outsub-other.ph")).accessToken;
    const asOutsider = {
      get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(outsider, other.facilityId)),
      post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(outsider, other.facilityId)).send(body),
    };
    expect((await asOutsider.get("/outside-result-submissions").expect(200)).body).toEqual([]);
    await asOutsider.get(`/outside-result-submissions/${ids.sub1}/link`).expect(404);
    await asOutsider.post(`/outside-result-submissions/${ids.sub1}/decline`, { reason: "Not ours to answer" }).expect(404);
  });

  it("is for the account holder themself and needs a signed-in patient", async () => {
    await ctx.http().get("/api/v1/portal/outside-results").expect(401);
    await ctx.http().post("/api/v1/portal/outside-results").send({}).expect(401);
    // A staff token is not a patient's.
    await ctx
      .http()
      .get("/api/v1/portal/outside-results")
      .set({ authorization: `Bearer ${admin}` })
      .expect(401);
  });
});
