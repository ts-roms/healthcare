import { randomUUID } from "node:crypto";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface OutsideResult {
  id: string;
  patientId: string;
  documentId: string;
  sourceName: string;
  sourceKind: string;
  performedOn: string;
  tests: string;
  receivedFrom: string;
  enteredInError: { reason: string } | null;
}

/**
 * Results from outside laboratories and hospitals (docs/domains/outside-results.md): a report uploaded for the patient is
 * filed with its source, day and tests; never one of this laboratory's results; immutable, corrected by entered in error.
 */
describe("outside results", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let cashier: string;
  let outsider: string;
  let patientId: string;
  let otherPatientId: string;
  const ids: Record<string, string> = {};

  const staff = (t: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
  });
  const addDocument = async (patient: string, category = "outside_result", status = "available"): Promise<string> => {
    const id = randomUUID();
    await ctx.pool.query(
      `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, created_by, scan_status, scanned_at)
       SELECT $1, $2, $3, $4, $5, 'Outside report', 'report.pdf', 'application/pdf', 1000, $6, $7,
              CASE WHEN $7 = 'available' THEN now() END, id, CASE WHEN $7 = 'available' THEN 'not_scanned' END, CASE WHEN $7 = 'available' THEN now() END
       FROM app_user LIMIT 1`,
      [id, tenant.organizationId, tenant.facilityId, patient, category, `org/${tenant.organizationId}/documents/${id}`, status],
    );
    return id;
  };
  const filing = (documentId: string, extra: object = {}) => ({
    documentId,
    sourceName: "St. Luke's Medical Center Laboratory",
    sourceKind: "laboratory",
    performedOn: manilaDate(0),
    tests: "CBC, HbA1c",
    receivedFrom: "patient",
    ...extra,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "outres-org");
    const other = await createTenant(ctx.pool, "outres-other");
    await createStaff(ctx.pool, tenant, "admin@outres.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "nurse@outres.ph", ["nurse"], "nurse");
    await createStaff(ctx.pool, tenant, "cashier@outres.ph", ["cashier"]);
    await createStaff(ctx.pool, other, "admin@outres-other.ph", ["org_admin"]);
    [admin, nurse, cashier] = await Promise.all(["admin", "nurse", "cashier"].map(async (u) => (await login(ctx, `${u}@outres.ph`)).accessToken));
    outsider = (await login(ctx, "admin@outres-other.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    otherPatientId = (
      await staff(admin)
        .post("/patients", {
          familyName: "Reyes",
          givenName: "Maria",
          sex: "female",
          birthDate: "1992-07-15",
          contacts: [{ system: "mobile", value: "0918 111 2222" }],
        })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => ctx.close());

  it("files an uploaded report with its source, day and tests, and audits it", async () => {
    ids.document = await addDocument(patientId);
    const filed = await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(ids.document, { notes: "Brought by the patient's daughter" }))
      .expect(201);
    ids.result = filed.body.id;
    expect(filed.body).toMatchObject({
      patientId,
      documentId: ids.document,
      sourceKind: "laboratory",
      tests: "CBC, HbA1c",
      receivedFrom: "patient",
      enteredInError: null,
    });

    const list: OutsideResult[] = (await staff(nurse).get(`/patients/${patientId}/outside-results`).expect(200)).body;
    expect(list.map((r) => r.id)).toEqual([ids.result]);

    const record = await auditRows(ctx.pool, "action = 'outside-result.record' AND patient_id = $1", [patientId]);
    expect(record).toHaveLength(1);
    expect((await auditRows(ctx.pool, "action = 'outside-result.view' AND patient_id = $1", [patientId])).length).toBeGreaterThan(0);
    const events = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'OutsideResultFiled' AND organization_id = $1`, [
      tenant.organizationId,
    ]);
    expect(events.rows.map((r) => r.payload)).toEqual([{ outsideResultId: ids.result, documentId: ids.document }]);
  });

  it("is never a laboratory result of this laboratory", async () => {
    const lab = await ctx.pool.query(`SELECT count(*)::int AS n FROM lab_result WHERE organization_id = $1`, [tenant.organizationId]);
    expect(lab.rows[0].n).toBe(0);
  });

  it("refuses a report that is not the patient's, not of this kind, not yet uploaded, or already filed", async () => {
    const otherPatientsDoc = await addDocument(otherPatientId);
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(otherPatientsDoc))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_not_of_patient"));
    const wrongKind = await addDocument(patientId, "other");
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(wrongKind))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_not_of_patient"));
    const pending = await addDocument(patientId, "outside_result", "pending_upload");
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(pending))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_unavailable"));
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(ids.document))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("outside_result_exists"));
  });

  it("refuses a future day and incomplete details", async () => {
    const doc = await addDocument(patientId);
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(doc, { performedOn: "2999-01-01" }))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("performed_on_in_future"));
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(doc, { tests: "" }))
      .expect(400);
    await staff(nurse)
      .post(`/patients/${patientId}/outside-results`, filing(doc, { sourceKind: "pharmacy" }))
      .expect(400);
  });

  it("opens the report behind a short-lived audited link", async () => {
    const link = await staff(nurse).get(`/outside-results/${ids.result}/download-url`).expect(200);
    expect(link.body.url).toEqual(expect.any(String));
    expect((await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1", [ids.document])).length).toBe(1);
  });

  it("needs its own permissions, and another organization sees nothing", async () => {
    await staff(cashier).get(`/patients/${patientId}/outside-results`).expect(403);
    await staff(cashier)
      .post(`/patients/${patientId}/outside-results`, filing(await addDocument(patientId)))
      .expect(403);
    await ctx.http().get(`/api/v1/patients/${patientId}/outside-results`).set(as(outsider, tenant.facilityId)).expect(403);
    await ctx
      .http()
      .get(`/api/v1/outside-results/${ids.result}/download-url`)
      .set({ authorization: `Bearer ${outsider}` })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(403));
  });

  it("is immutable: only marked entered in error, once, with a reason; never deleted", async () => {
    await expect(ctx.pool.query(`UPDATE outside_result SET tests = 'Something else' WHERE id = $1`, [ids.result])).rejects.toThrow(
      /only marking entered in error/,
    );
    await expect(ctx.pool.query(`DELETE FROM outside_result WHERE id = $1`, [ids.result])).rejects.toThrow(/never deleted/);

    await staff(nurse).post(`/outside-results/${ids.result}/entered-in-error`, { reason: "x" }).expect(400);
    const corrected = await staff(nurse).post(`/outside-results/${ids.result}/entered-in-error`, { reason: "Filed on the wrong patient" }).expect(200);
    expect(corrected.body.enteredInError).toMatchObject({ reason: "Filed on the wrong patient" });
    await staff(nurse)
      .post(`/outside-results/${ids.result}/entered-in-error`, { reason: "Again" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("already_entered_in_error"));

    // The entry stays listed, marked; its report may be filed again on the right record.
    const list: OutsideResult[] = (await staff(nurse).get(`/patients/${patientId}/outside-results`).expect(200)).body;
    expect(list.find((r) => r.id === ids.result)?.enteredInError?.reason).toBe("Filed on the wrong patient");
    await staff(nurse).post(`/patients/${patientId}/outside-results`, filing(ids.document)).expect(201);
  });

  it("shows in the timeline and Patient 360 as outside results, without notes and never as a document or laboratory result", async () => {
    const timeline = (await staff(nurse).get(`/patients/${patientId}/timeline?kinds=outside_result`).expect(200)).body;
    const entries = timeline.items as Array<{
      kind: string;
      title: string;
      detail: string;
      marker: string | null;
      link: { type: string };
      sourceIds: Record<string, string>;
    }>;
    expect(entries.every((e) => e.kind === "outside_result")).toBe(true);
    expect(entries.map((e) => e.title)).toEqual(["Outside result: CBC, HbA1c", "Outside result: CBC, HbA1c"]);
    expect(entries[0]?.detail).toContain("From St. Luke's Medical Center Laboratory");
    expect(entries.filter((e) => e.marker === "entered_in_error")).toHaveLength(1);
    expect(entries[0]?.link.type).toBe("patient_outside_results");
    expect(JSON.stringify(timeline)).not.toMatch(/daughter/);
    // The filed reports are not also listed as plain documents.
    const documents = (await staff(nurse).get(`/patients/${patientId}/timeline?kinds=document`).expect(200)).body.items as Array<{
      sourceIds: Record<string, string>;
    }>;
    expect(documents.map((d) => d.sourceIds.documentId)).not.toContain(ids.document);
    expect((await staff(cashier).get(`/patients/${patientId}/timeline`).expect(200)).body.withheld).toContain("outside_result");

    const workspace = (await staff(nurse).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(workspace.outsideResults).toHaveLength(1);
    expect(workspace.outsideResults[0]).toMatchObject({
      sourceName: "St. Luke's Medical Center Laboratory",
      sourceKind: "laboratory",
      tests: "CBC, HbA1c",
      filedUnder: null,
    });
    expect(JSON.stringify(workspace.outsideResults)).not.toMatch(/daughter/);
    const forCashier = (await staff(cashier).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(forCashier.outsideResults).toBeNull();
    expect(forCashier.withheld).toContain("outside_results");
  });
});
