import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Ngiti-sa-umaga-2026";

/**
 * MyHealth dental records (docs/domains/dental.md, "Dental records in MyHealth"): off by default per organization;
 * when on, the patient sees their treatment plans, completed procedures and current chart — and nothing else.
 */
describe("patient portal dental records", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let admin: string;
  let dentist: string;
  let assistant: string;
  let otherAdmin: string;
  let otherDentist: string;
  let patientId: string;
  let secondPatientId: string;
  let patientToken: string;
  const ids: Record<string, string> = {};

  const staff = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const portal = (url: string, token = patientToken) =>
    ctx
      .http()
      .get(`/api/v1/portal/dental${url}`)
      .set({ authorization: `Bearer ${token}` });

  /** Types, an examination with notes, a plan decided in part, procedures (one corrected), a perio chart and an image. */
  async function dentalHistory(t: Tenant, adminToken: string, dentistToken: string, forPatient: string, prefix: string) {
    const api = (token: string) => staff(token, t.facilityId);
    const type = async (code: string, name: string, site: string, chartEffect?: string) =>
      (await api(adminToken).post("/dental/procedure-types", { code, name, site, chartEffect }).expect(201)).body.id as string;
    const composite = await type("composite", `${prefix} composite restoration`, "surface", "restoration");
    const extraction = await type("extraction", `${prefix} extraction`, "tooth", "missing");
    const encounterId = (await api(dentistToken).post("/encounters", { patientId: forPatient, chiefComplaint: "Toothache" }).expect(201)).body.id;
    await api(dentistToken)
      .post(`/dental/patients/${forPatient}/examinations`, {
        encounterId,
        oralHygiene: "poor",
        notes: `${prefix} SECRET-EXAM-NOTE gingivitis`,
        teeth: [
          { tooth: "16", findings: [{ condition: "caries", surfaces: ["M", "O"] }], note: `${prefix} SECRET-TOOTH-NOTE` },
          { tooth: "48", findings: [{ condition: "impacted", surfaces: [] }] },
          { tooth: "21", findings: [] },
        ],
      })
      .expect(201);
    const plan = await api(dentistToken)
      .post("/dental/treatment-plans", {
        patientId: forPatient,
        title: `${prefix} restorative plan`,
        notes: `${prefix} SECRET-PLAN-NOTE`,
        items: [
          { phase: 1, procedureTypeId: composite, tooth: "16", surfaces: ["M", "O"], note: `${prefix} SECRET-ITEM-NOTE` },
          { phase: 2, procedureTypeId: extraction, tooth: "48" },
        ],
      })
      .expect(201);
    const [compositeItem] = plan.body.items as Array<{ id: string }>;
    await api(dentistToken)
      .post(`/dental/treatment-plans/${plan.body.id}/decision`, { acceptedItemIds: [compositeItem!.id], note: `${prefix} SECRET-DECISION-NOTE`, version: 1 })
      .expect(200);
    const performed = await api(dentistToken)
      .post(`/dental/patients/${forPatient}/procedures`, {
        encounterId,
        procedureTypeId: composite,
        tooth: "16",
        surfaces: ["M", "O"],
        planItemId: compositeItem!.id,
        notes: `${prefix} SECRET-PROCEDURE-NOTE`,
      })
      .expect(201);
    // Recorded on the wrong tooth and corrected: never shown, and the chart shows 36 as never charted.
    const wrong = await api(dentistToken)
      .post(`/dental/patients/${forPatient}/procedures`, { encounterId, procedureTypeId: extraction, tooth: "36" })
      .expect(201);
    await api(dentistToken).post(`/dental/procedures/${wrong.body.id}/entered-in-error`, { reason: "Wrong tooth recorded" }).expect(200);
    const awaiting = await api(dentistToken)
      .post("/dental/treatment-plans", { patientId: forPatient, title: `${prefix} wisdom tooth`, items: [{ procedureTypeId: extraction, tooth: "48" }] })
      .expect(201);
    await api(dentistToken)
      .post(`/dental/patients/${forPatient}/perio-charts`, {
        encounterId,
        notes: `${prefix} SECRET-PERIO-NOTE`,
        teeth: [{ tooth: "11", mobility: 1, sites: [{ site: "MB", probingDepth: 7, gingivalMargin: 2, bleeding: true }] }],
      })
      .expect(201);
    const document = await api(adminToken)
      .post("/documents", { category: "imaging", title: "Bitewing", fileName: "bw.png", contentType: "image/png", sizeBytes: 4096, patientId: forPatient })
      .expect(201);
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [document.body.document.id]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 4096, contentType: "image/png" });
    await api(adminToken).post(`/documents/${document.body.document.id}/complete`).expect(200);
    await api(adminToken)
      .post(`/dental/patients/${forPatient}/images`, {
        documentId: document.body.document.id,
        kind: "bitewing",
        teeth: ["16"],
        takenOn: manilaDate(0),
        notes: "SECRET-IMAGE",
      })
      .expect(201);
    return { plan: plan.body.id as string, awaiting: awaiting.body.id as string, procedure: performed.body.id as string, wrong: wrong.body.id as string };
  }

  async function portalAccount(t: Tenant, orgCode: string, forPatient: string, email: string) {
    const adminToken = t === tenant ? admin : otherAdmin;
    await staff(adminToken, t.facilityId)
      .post(`/patients/${forPatient}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" })
      .expect(201);
    const code = (await staff(adminToken, t.facilityId).post(`/patients/${forPatient}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [forPatient],
    );
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: orgCode,
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email,
        password: PATIENT_PASSWORD,
      })
      .expect(200);
    return (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: orgCode, email, password: PATIENT_PASSWORD }).expect(200)).body
      .accessToken as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "smile-org");
    other = await createTenant(ctx.pool, "other-smile");
    await createStaff(ctx.pool, tenant, "admin@smile.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@smile.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "assistant@smile.ph", ["dental_assistant"]);
    await createStaff(ctx.pool, other, "admin@other-smile.ph", ["org_admin"]);
    await createClinician(ctx, other, "dentist@other-smile.ph", ["dentist"], "dentist");
    admin = (await login(ctx, "admin@smile.ph")).accessToken;
    dentist = (await login(ctx, "dentist@smile.ph")).accessToken;
    assistant = (await login(ctx, "assistant@smile.ph")).accessToken;
    otherAdmin = (await login(ctx, "admin@other-smile.ph")).accessToken;
    otherDentist = (await login(ctx, "dentist@other-smile.ph")).accessToken;

    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    secondPatientId = (
      await staff(admin)
        .post("/patients", { ...juan, givenName: "Maria", middleName: "Reyes", sex: "female", birthDate: "1991-07-19", contacts: [], identifiers: [] })
        .expect(201)
    ).body.id;
    patientToken = await portalAccount(tenant, "smile-org", patientId, "juan@smile.ph");

    Object.assign(ids, await dentalHistory(tenant, admin, dentist, patientId, "JUAN"));
    // Another patient of the same organization, and a patient of another organization that shares dental records.
    const secondEncounter = (await staff(dentist).post("/encounters", { patientId: secondPatientId, chiefComplaint: "Check-up" }).expect(201)).body.id;
    const types = (await staff(admin).get("/dental/settings").expect(200)).body.procedureTypes as Array<{ id: string; code: string }>;
    await staff(dentist)
      .post(`/dental/patients/${secondPatientId}/procedures`, {
        encounterId: secondEncounter,
        procedureTypeId: types.find((t) => t.code === "extraction")!.id,
        tooth: "18",
      })
      .expect(201);
    const otherPatient = (await staff(otherAdmin, other.facilityId).post("/patients", juan).expect(201)).body.id;
    await dentalHistory(other, otherAdmin, otherDentist, otherPatient, "OTHER");
    await staff(otherAdmin, other.facilityId).put("/dental/settings/portal", { portalDentalRecords: true, version: 0 }).expect(200);
  });
  afterAll(() => ctx.close());

  it("shows nothing dental while the organization has not turned MyHealth dental records on", async () => {
    expect((await portal("/availability").expect(200)).body).toEqual({ available: false });
    const refused = await portal("/record").expect(403);
    expect(refused.body.error.message).toMatch(/does not share dental records/);
    expect((await staff(assistant).get("/dental/settings/portal").expect(200)).body).toMatchObject({ portalDentalRecords: false, version: 0 });
    const denied = await auditRows(ctx.pool, "action = 'portal.dental-view'");
    expect(denied).toEqual([expect.objectContaining({ outcome: "denied", actor_type: "patient", patient_id: patientId })]);
  });

  it("lets only dental settings managers turn it on, audited with before and after", async () => {
    await staff(dentist).put("/dental/settings/portal", { portalDentalRecords: true, version: 0 }).expect(403);
    await staff(assistant).put("/dental/settings/portal", { portalDentalRecords: true, version: 0 }).expect(403);
    await staff(admin).put("/dental/settings/portal", { portalDentalRecords: "yes", version: 0 }).expect(400);
    await staff(admin).put("/dental/settings/portal", { portalDentalRecords: true, version: 3 }).expect(409);
    const on = await staff(admin).put("/dental/settings/portal", { portalDentalRecords: true, version: 0 }).expect(200);
    expect(on.body).toMatchObject({ portalDentalRecords: true, version: 1, updatedByName: "admin@smile.ph" });
    // Stale version: someone else changed it.
    await staff(admin).put("/dental/settings/portal", { portalDentalRecords: false, version: 0 }).expect(409);
    const off = await staff(admin).put("/dental/settings/portal", { portalDentalRecords: false, version: 1 }).expect(200);
    expect(off.body).toMatchObject({ portalDentalRecords: false, version: 2 });
    expect((await portal("/availability").expect(200)).body).toEqual({ available: false });
    await staff(admin).put("/dental/settings/portal", { portalDentalRecords: true, version: 2 }).expect(200);

    const audit = await auditRows(ctx.pool, "action = 'dental.settings.portal' AND organization_id = $1", [tenant.organizationId]);
    expect(audit.map((a) => a.actor_type)).toEqual(["user", "user", "user"]);
    const changes = await ctx.pool.query<{ changes: unknown }>(
      "SELECT changes FROM audit_event WHERE action = 'dental.settings.portal' AND organization_id = $1 ORDER BY occurred_at, id",
      [tenant.organizationId],
    );
    expect(changes.rows.map((r) => r.changes)).toEqual([
      { portalDentalRecords: { from: false, to: true } },
      { portalDentalRecords: { from: true, to: false } },
      { portalDentalRecords: { from: false, to: true } },
    ]);
    // Per organization: the other organization's choice is its own.
    expect((await staff(otherAdmin, other.facilityId).get("/dental/settings/portal").expect(200)).body).toMatchObject({
      portalDentalRecords: true,
      version: 1,
    });
  });

  it("shows plans, completed procedures and the chart with exactly the patient-facing fields", async () => {
    expect((await portal("/availability").expect(200)).body).toEqual({ available: true });
    const { body } = await portal("/record").expect(200);
    expect(Object.keys(body).sort()).toEqual(["chart", "notation", "plans", "procedures"]);
    expect(body.notation).toBe("fdi");

    // The chart: current states only, without notes or authors; the corrected extraction left no trace on 36.
    expect(body.chart).toEqual([
      { tooth: "16", conditions: [{ condition: "restoration", surfaces: ["M", "O"] }], updatedOn: manilaDate(0) },
      { tooth: "21", conditions: [], updatedOn: manilaDate(0) },
      { tooth: "48", conditions: [{ condition: "impacted", surfaces: [] }], updatedOn: manilaDate(0) },
    ]);

    expect(body.procedures).toEqual([
      {
        id: ids.procedure,
        performedOn: manilaDate(0),
        tooth: "16",
        surfaces: ["M", "O"],
        procedureName: "JUAN composite restoration",
        facilityName: "Main Clinic",
        dentistName: "Dr. dentist",
      },
    ]);

    expect(body.plans.map((p: { id: string }) => p.id)).toEqual([ids.awaiting, ids.plan]);
    const [awaiting, decided] = body.plans;
    expect(Object.keys(decided).sort()).toEqual(["decidedOn", "dentistName", "facilityName", "id", "items", "proposedOn", "status", "title"]);
    expect(decided).toMatchObject({ title: "JUAN restorative plan", status: "completed", proposedOn: manilaDate(0), decidedOn: manilaDate(0) });
    expect(decided.items).toEqual([
      {
        id: expect.any(String),
        phase: 1,
        tooth: "16",
        surfaces: ["M", "O"],
        procedureName: "JUAN composite restoration",
        status: "completed",
        decision: "accepted",
      },
      { id: expect.any(String), phase: 2, tooth: "48", surfaces: [], procedureName: "JUAN extraction", status: "declined", decision: "declined" },
    ]);
    expect(awaiting).toMatchObject({ status: "proposed", decidedOn: null, items: [expect.objectContaining({ status: "proposed", decision: "awaiting" })] });

    // Never: notes, remarks, periodontal measurements, images, codes, staff users, corrections — nor anyone else's record.
    const text = JSON.stringify(body);
    for (const absent of [
      "SECRET",
      "gingivitis",
      "oralHygiene",
      "probing",
      "mobility",
      "bitewing",
      "document",
      "notes",
      "note",
      "code",
      "recordedBy",
      "organizationId",
      "enteredInError",
      "entered_in_error",
      ids.wrong,
      '"36"',
      '"18"',
      "OTHER",
      secondPatientId,
    ]) {
      expect(text).not.toContain(absent);
    }
  });

  it("keeps staff out and each patient to their own record", async () => {
    await ctx.http().get("/api/v1/portal/dental/record").set(as(admin)).expect(401);
    await ctx.http().get("/api/v1/portal/dental/record").expect(401);
    // Maria (same organization) has one procedure and no portal account: once she has one, she sees only hers.
    const mariaToken = await portalAccount(tenant, "smile-org", secondPatientId, "maria@smile.ph");
    const maria = (await portal("/record", mariaToken).expect(200)).body;
    expect(maria.plans).toEqual([]);
    expect(maria.procedures.map((p: { tooth: string }) => p.tooth)).toEqual(["18"]);
    expect(maria.chart).toEqual([{ tooth: "18", conditions: [{ condition: "missing", surfaces: [] }], updatedOn: manilaDate(0) }]);
    for (const juans of [ids.procedure, ids.plan, ids.awaiting, "restorative plan"]) expect(JSON.stringify(maria)).not.toContain(juans);

    // Withdrawn portal consent ends access at the next request.
    await staff(admin).post(`/patients/${secondPatientId}/consents`, { consentType: "portal_access", decision: "withdrawn", capturedVia: "paper" }).expect(201);
    await portal("/record", mariaToken).expect(401);
  });

  it("audits every read of the record as the patient", async () => {
    const rows = await auditRows(ctx.pool, "action = 'portal.dental-view' AND patient_id = $1", [patientId]);
    expect(rows.map((r) => [r.outcome, r.actor_type])).toEqual([
      ["denied", "patient"],
      ["success", "patient"],
    ]);
    expect(rows[1]!.metadata).toEqual({ plans: 2, procedures: 1, teeth: 3 });
  });
});
