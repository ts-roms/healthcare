import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Workspace {
  patientId: string;
  referrals: Array<{ id: string; status: string }> | null;
  facility: { id: string; name: string } | null;
  timeZone: string;
  currentEncounter: {
    encounters: Array<{
      id: string;
      status: string;
      mine: boolean;
      atSelectedFacility: boolean;
      hasNoteDraft: boolean;
      practitionerName: string;
      visitTypeName: string | null;
      facility: { id: string; name: string } | null;
      diagnoses: Array<{ code: string | null; display: string }>;
    }>;
    visit: { id: string; status: string; queueNumber: number; visitTypeName: string } | null;
  } | null;
  encounterHistory: Array<{ id: string; status: string; diagnoses: Array<{ code: string | null; display: string; isChronic: boolean }> }> | null;
  criticalResults: Array<{ id: string; status: string; testName: string; orderNumber: string; orderId: string }> | null;
  labOrders: Array<{ id: string; orderNumber: string; priority: string; tests: Array<{ testName: string; status: string }> }> | null;
  immunizations: Array<{ id: string; vaccineName: string }> | null;
  dentalImages: Array<{ id: string; kind: string; teeth: string[] }> | null;
  documents: Array<{ id: string; category: string; title: string }> | null;
  withheld: string[];
}

/**
 * Patient 360 workspace (docs/domains/patient-360.md): what the doctor's one-screen view needs beyond the summary and
 * the timeline — composed from each domain's read query, gated per panel by that domain's read permission, free of
 * notes, complaints and result values, organization-scoped and audited once per view.
 */
describe("patient 360 workspace", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let otherDoctor: string;
  let dentist: string;
  let cashier: string;
  let medtech: string;
  let otherOrgAdmin: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const api = (token: string, facilityId: string = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const workspace = async (token: string, status = 200, facilityId?: string): Promise<Workspace> =>
    (await api(token, facilityId).get(`/patients/${patientId}/workspace`).expect(status)).body;
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "workspace-org");
    await createStaff(ctx.pool, tenant, "admin@workspace.ph", ["org_admin"]);
    const doc = await createClinician(ctx, tenant, "reyes@workspace.ph", ["physician"]);
    await createClinician(ctx, tenant, "cruz@workspace.ph", ["physician"]);
    await createClinician(ctx, tenant, "santos@workspace.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "cashier@workspace.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "medtech@workspace.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@workspace.ph")).accessToken;
    doctor = (await login(ctx, "reyes@workspace.ph")).accessToken;
    otherDoctor = (await login(ctx, "cruz@workspace.ph")).accessToken;
    dentist = (await login(ctx, "santos@workspace.ph")).accessToken;
    cashier = (await login(ctx, "cashier@workspace.ph")).accessToken;
    medtech = (await login(ctx, "medtech@workspace.ph")).accessToken;
    const other = await createTenant(ctx.pool, "workspace-other");
    await createStaff(ctx.pool, other, "admin@other-ws.ph", ["org_admin"]);
    otherOrgAdmin = (await login(ctx, "admin@other-ws.ph")).accessToken;

    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;

    // 1. An earlier consultation, signed, with a chronic coded diagnosis (its notes must never appear).
    ids.earlier = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "SECRET-EARLIER-COMPLAINT" }).expect(201)).body.id;
    await q(
      `INSERT INTO diagnosis (organization_id, patient_id, encounter_id, code_system_key, code, display, rank, certainty, is_chronic, notes, recorded_by, updated_by)
       VALUES ($1, $2, $3, 'icd-10', 'E11.9', 'Type 2 diabetes mellitus', 'primary', 'confirmed', true, 'SECRET-DIAGNOSIS-NOTE', $4, $4)`,
      [tenant.organizationId, patientId, ids.earlier, doc.userId],
    );
    await q(
      `UPDATE encounter SET status = 'completed', signed_by_practitioner_id = practitioner_id, completed_at = now() - interval '1 day', started_at = now() - interval '2 days' WHERE id = $1`,
      [ids.earlier],
    );

    // 2. Today's walk-in at the selected facility, then the consultation started from it, with a note draft.
    const visitTypeId = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 15 }).expect(201))
      .body.id;
    ids.visit = (await api(admin).post("/queue/walk-ins", { patientId, visitTypeId, chiefComplaint: "SECRET-WALKIN-COMPLAINT" }).expect(201)).body.id;
  });

  afterAll(() => ctx.close());

  it("shows today's visit before a consultation starts, then the consultation in progress", async () => {
    const before = await workspace(doctor);
    expect(before.currentEncounter).toEqual({
      encounters: [],
      visit: expect.objectContaining({ id: ids.visit, status: "waiting", visitTypeName: "General consult", queueNumber: 1 }),
    });
    expect(before.facility).toEqual({ id: tenant.facilityId, name: "Main Clinic" });
    expect(before.timeZone).toBe("Asia/Manila");
    // Not at another facility: the visit belongs to the selected one.
    expect((await workspace(doctor, 200, tenant.otherFacilityId)).currentEncounter?.visit).toBeNull();

    ids.current = (await api(doctor).post("/encounters", { visitId: ids.visit }).expect(201)).body.id;
    await api(doctor)
      .put(`/encounters/${ids.current}/note`, { subjective: "SECRET-SUBJECTIVE", objective: "", assessment: "", plan: "", basedOnRevision: 0 })
      .expect(200);

    const mine = await workspace(doctor);
    expect(mine.currentEncounter?.visit).toMatchObject({ id: ids.visit, status: "in_consultation" });
    expect(mine.currentEncounter?.encounters).toEqual([
      expect.objectContaining({
        id: ids.current,
        status: "in_progress",
        mine: true,
        atSelectedFacility: true,
        hasNoteDraft: true,
        visitTypeName: "General consult",
        practitionerName: "Dr. reyes",
        facility: { id: tenant.facilityId, name: "Main Clinic" },
      }),
    ]);
    // Another physician sees the same consultation, not as theirs.
    expect((await workspace(otherDoctor)).currentEncounter?.encounters).toEqual([expect.objectContaining({ id: ids.current, mine: false })]);
    // Viewed from another facility, it is the patient's consultation elsewhere.
    expect((await workspace(doctor, 200, tenant.otherFacilityId)).currentEncounter?.encounters[0]).toMatchObject({
      id: ids.current,
      atSelectedFacility: false,
    });
  });

  it("lists recent consultations with their diagnoses, never the ones entered in error", async () => {
    const inError = (await api(doctor).post("/encounters", { patientId }).expect(201)).body.id;
    await q(
      `UPDATE encounter SET status = 'entered_in_error', entered_in_error_reason = 'SECRET-ERROR-REASON', started_at = now() - interval '3 days' WHERE id = $1`,
      [inError],
    );
    const view = await workspace(doctor);
    expect(view.encounterHistory?.map((e) => e.id)).toEqual([ids.current, ids.earlier]);
    expect(view.encounterHistory?.[1]).toMatchObject({
      status: "completed",
      diagnoses: [expect.objectContaining({ code: "E11.9", display: "Type 2 diabetes mellitus", isChronic: true })],
    });
  });

  it("raises critical results awaiting acknowledgement and open laboratory orders, without values", async () => {
    const lab = async (path: string, body: object) => {
      const res = await api(admin).post(`/laboratory${path}`, body);
      if (res.status !== 201) throw new Error(`${path}: ${JSON.stringify(res.body)}`);
      return res;
    };
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const k = (await lab("/tests", { code: "kplus", name: "Potassium", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body
      .id;
    const na = (await lab("/tests", { code: "sodium", name: "Sodium", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body
      .id;
    await lab(`/tests/${k}/reference-ranges`, { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 });
    const order = (
      await api(doctor)
        .post("/laboratory/orders", { patientId, encounterId: ids.current, testIds: [k, na], priority: "stat", notes: "SECRET-ORDER-NOTE" })
        .expect(201)
    ).body;
    ids.order = order.id;
    const kItem = order.items.find((i: { testId: string }) => i.testId === k);
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: kItem.specimenTypeId, itemIds: [kItem.id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const result = (await api(medtech).post(`/laboratory/order-items/${kItem.id}/results`, { valueNumeric: 7.77 }).expect(201)).body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);

    const view = await workspace(doctor);
    expect(view.criticalResults).toEqual([
      expect.objectContaining({ status: "open", testName: "Potassium", orderNumber: order.orderNumber, orderId: order.id, facility: expect.anything() }),
    ]);
    expect(view.labOrders).toEqual([
      expect.objectContaining({
        id: order.id,
        priority: "stat",
        tests: [
          expect.objectContaining({ testName: "Potassium", status: "resulted" }),
          expect.objectContaining({ testName: "Sodium", status: "pending_collection" }),
        ],
      }),
    ]);
    const body = JSON.stringify(view);
    expect(body).not.toContain("7.77");
    ids.alert = view.criticalResults![0]!.id;

    // Once the care team acknowledges it, it is no longer an alert.
    await api(medtech)
      .post(`/laboratory/critical-results/${ids.alert}/communicate`, { communicatedTo: "Dr. reyes", method: "phone", readBackConfirmed: true })
      .expect(200);
    expect((await workspace(doctor)).criticalResults).toEqual([expect.objectContaining({ id: ids.alert, status: "communicated" })]);
    await api(doctor).post(`/laboratory/critical-results/${ids.alert}/acknowledge`).expect(200);
    expect((await workspace(doctor)).criticalResults).toEqual([]);
  });

  it("lists dental images and uploaded documents, each once", async () => {
    const upload = async (category: string, title: string, contentType = "image/png") => {
      const created = await api(admin).post("/documents", { category, title, fileName: "file.png", contentType, sizeBytes: 4096, patientId }).expect(201);
      const id = created.body.document.id as string;
      const { rows } = await q("SELECT storage_key FROM document WHERE id = $1", [id]);
      ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 4096, contentType });
      await api(admin).post(`/documents/${id}/complete`).expect(200);
      return id;
    };
    ids.xrayDocument = await upload("imaging", "Periapical 36");
    ids.referral = await upload("clinical_attachment", "Referral letter", "application/pdf");
    ids.image = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/images`, {
          documentId: ids.xrayDocument,
          kind: "periapical",
          teeth: ["36"],
          takenOn: manilaDate(0),
          notes: "SECRET-IMAGE-NOTE",
        })
        .expect(201)
    ).body.id;

    const forDentist = await workspace(dentist);
    expect(forDentist.dentalImages).toEqual([expect.objectContaining({ id: ids.image, kind: "periapical", teeth: ["36"] })]);
    // The radiograph is listed as a dental image, not again as a document.
    expect(forDentist.documents?.map((d) => d.id)).toEqual([ids.referral]);
    expect(forDentist.documents?.[0]).toMatchObject({ category: "clinical_attachment", title: "Referral letter" });
    const forAdmin = await workspace(admin);
    expect(forAdmin.documents?.map((d) => d.id)).toContain(ids.referral);
    expect(JSON.stringify(forDentist)).not.toContain("SECRET");
  });

  it("gates each panel by the owning domain's read permission and says which were withheld", async () => {
    const forCashier = await workspace(cashier);
    expect(forCashier).toMatchObject({ currentEncounter: null, encounterHistory: null, criticalResults: null, labOrders: null, dentalImages: null });
    expect(forCashier.withheld).toEqual(expect.arrayContaining(["current_encounter", "encounter_history", "critical_results", "lab_orders", "dental_images"]));

    const forMedtech = await workspace(medtech);
    expect(forMedtech.currentEncounter).toBeNull();
    expect(forMedtech.encounterHistory).toBeNull();
    expect(forMedtech.labOrders?.map((o) => o.id)).toEqual([ids.order]);
    expect(forMedtech.criticalResults).toEqual([]);
    expect(forMedtech.withheld).toEqual(expect.arrayContaining(["current_encounter", "encounter_history", "dental_images"]));

    // A physician reads the clinical panels and documents; dental images are the dental team's (dental.imaging.read).
    const forDoctor = await workspace(doctor);
    expect(forDoctor.withheld).toEqual(["dental_images"]);
    expect(forDoctor.dentalImages).toBeNull();
    expect(forDoctor.documents?.map((d) => d.id)).toEqual(expect.arrayContaining([ids.referral, ids.xrayDocument]));
    for (const view of [forCashier, forMedtech, forDoctor]) for (const panel of view.withheld) expect(view[PANEL_FIELDS[panel]!]).toBeNull();
  });

  it("never carries notes, complaints, reasons or result values", async () => {
    for (const token of [admin, doctor, dentist]) expect(JSON.stringify(await workspace(token))).not.toMatch(/SECRET|7\.77/);
  });

  it("extends the summary's active prescriptions with the prescriber's name", async () => {
    await api(doctor)
      .post("/prescriptions", {
        encounterId: ids.current,
        items: [
          {
            genericName: "Metformin",
            strength: "500 mg",
            dosageForm: "tablet",
            doseAmount: 1,
            doseUnit: "tablet",
            route: "oral",
            frequency: "twice_daily",
            durationValue: 30,
            durationUnit: "days",
            quantity: 60,
            quantityUnit: "tablets",
            instructions: "After meals",
          },
        ],
      })
      .expect(201);
    const summary = (await api(doctor).get(`/patients/${patientId}/summary`).expect(200)).body;
    expect(summary.activePrescriptions).toEqual([expect.objectContaining({ prescriberName: "Dr. reyes", prescriptionNumber: expect.any(String) })]);
  });

  it("is organization-scoped and audited once per view without content", async () => {
    await ctx.http().get(`/api/v1/patients/${patientId}/workspace`).set(as(otherOrgAdmin)).expect(404);
    await api(doctor).get(`/patients/00000000-0000-4000-8000-000000000000/workspace`).expect(404);
    const views = () => auditRows(ctx.pool, "action = 'patient.workspace.view' AND patient_id = $1", [patientId]);
    const before = (await views()).length;
    await workspace(cashier);
    const rows = await views();
    expect(rows).toHaveLength(before + 1);
    const last = rows.at(-1)!;
    expect(last).toMatchObject({ patient_id: patientId, outcome: "success" });
    expect(last.metadata).toMatchObject({ withheld: expect.arrayContaining(["current_encounter"]) });
    expect(JSON.stringify(last.metadata)).not.toMatch(/SECRET|Potassium|Periapical/);
  });
});

const PANEL_FIELDS: Record<string, keyof Workspace> = {
  current_encounter: "currentEncounter",
  encounter_history: "encounterHistory",
  critical_results: "criticalResults",
  lab_orders: "labOrders",
  dental_images: "dentalImages",
  documents: "documents",
  referrals: "referrals",
  immunizations: "immunizations",
};
