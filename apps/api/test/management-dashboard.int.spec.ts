import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Management dashboard (docs/architecture/management-dashboard.md): figures from every domain over a range of local
 * days, per facility or for the organization, limited to the facilities the caller's grant covers, never naming a
 * patient, and audited.
 */
describe("management dashboard", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let annexManager: string;
  let doctor: string;
  const ids: Record<string, string> = {};

  const api = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const dashboard = async (token: string, query = "", facilityId?: string, status = 200) =>
    (await api(token, facilityId).get(`/management/dashboard${query}`).expect(status)).body;
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "management-org");
    const adminUserId = await createStaff(ctx.pool, tenant, "admin@mgmt.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "annex@mgmt.ph", [{ role: "org_admin", facilityId: tenant.otherFacilityId }]);
    const doc = await createClinician(ctx, tenant, "reyes@mgmt.ph", ["physician"]);
    await createClinician(ctx, tenant, "santos@mgmt.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "cashier@mgmt.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "medtech@mgmt.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@mgmt.ph")).accessToken;
    annexManager = (await login(ctx, "annex@mgmt.ph")).accessToken;
    doctor = (await login(ctx, "reyes@mgmt.ph")).accessToken;
    const dentist = (await login(ctx, "santos@mgmt.ph")).accessToken;
    const cashier = (await login(ctx, "cashier@mgmt.ph")).accessToken;
    const medtech = (await login(ctx, "medtech@mgmt.ph")).accessToken;

    // Two patients: one registered at the main facility, one at the annex.
    ids.juan = (await api(admin).post("/patients", juan).expect(201)).body.id;
    ids.ana = (
      await api(admin, tenant.otherFacilityId).post("/patients", { familyName: "Garcia", givenName: "Ana", sex: "female", birthDate: "1990-02-02" }).expect(201)
    ).body.id;
    const visitType = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 15 }).expect(201)).body
      .id;

    // Appointments yesterday at the main facility: attended, missed, cancelled.
    for (const status of ["completed", "no_show", "cancelled"]) {
      await q(
        `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, status, booking_channel,
                                  completed_at, no_show_at, cancelled_at, cancelled_by, cancellation_reason, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, now() - interval '1 day', now() - interval '1 day' + interval '15 minutes', $6, 'front_desk',
                 CASE WHEN $6 = 'completed' THEN now() - interval '1 day' END, CASE WHEN $6 = 'no_show' THEN now() - interval '1 day' END,
                 CASE WHEN $6 = 'cancelled' THEN now() - interval '2 days' END, CASE WHEN $6 = 'cancelled' THEN $7::uuid END,
                 CASE WHEN $6 = 'cancelled' THEN 'Patient asked' END, $7, $7)`,
        [tenant.organizationId, tenant.facilityId, ids.juan, doc.practitionerId, visitType, status, adminUserId],
      );
    }
    // A walk-in who waited 30 minutes.
    await q(
      `INSERT INTO visit (organization_id, facility_id, patient_id, visit_type_id, arrival_mode, queue_date, queue_number, status, checked_in_at,
                          consultation_started_at, completed_at, checked_in_by)
       VALUES ($1, $2, $3, $4, 'walk_in', current_date, 1, 'completed', now() - interval '2 hours', now() - interval '90 minutes', now() - interval '1 hour', $5)`,
      [tenant.organizationId, tenant.facilityId, ids.juan, visitType, adminUserId],
    );
    // Encounters: Juan seen 40 days ago and again today (returning); Ana seen today online at the annex.
    const encounter = (patientId: string, facilityId: string, completedAt: string, modality = "in_person") =>
      q(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, modality, status, started_at, completed_at, signed_by_practitioner_id,
                                started_by)
         VALUES ($1, $2, $3, $4, $5, 'completed', ${completedAt} - interval '20 minutes', ${completedAt}, $4, $6)`,
        [tenant.organizationId, facilityId, patientId, doc.practitionerId, modality, doc.userId],
      );
    await encounter(ids.juan, tenant.facilityId, "now() - interval '40 days'");
    await encounter(ids.juan, tenant.facilityId, "now() - interval '1 hour'");
    await encounter(ids.ana, tenant.otherFacilityId, "now() - interval '1 hour'", "telemedicine");

    // A laboratory test ordered, collected and released at the main facility.
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const fbs = (await lab("/tests", { code: "fbs", name: "FBS", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body.id;
    const order = (
      await api(medtech)
        .post("/laboratory/orders", { patientId: ids.juan, source: "external", externalOrderer: "Dr. Cruz", testIds: [fbs] })
        .expect(201)
    ).body;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 5.2 }).expect(201)).body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${order.id}/release`).expect(200);

    // A dental procedure at the main facility.
    const dentalEncounter = (await api(dentist).post("/encounters", { patientId: ids.juan, chiefComplaint: "Cleaning" }).expect(201)).body.id;
    const prophylaxis = (await api(admin).post("/dental/procedure-types", { code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" }).expect(201)).body
      .id;
    await api(dentist).post(`/dental/patients/${ids.juan}/procedures`, { encounterId: dentalEncounter, procedureTypeId: prophylaxis }).expect(201);

    // An invoice of ₱500.00 issued at the main facility, ₱200.00 paid in cash.
    const service = (
      await api(admin)
        .post("/billing/services", { code: "cert", name: "Medical certificate", category: "other", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await api(cashier).post("/billing/charges", { patientId: ids.juan, serviceId: service }).expect(201);
    const draft = (await api(cashier).post("/billing/invoices", { patientId: ids.juan }).expect(201)).body;
    await api(cashier).post(`/billing/invoices/${draft.id}/issue`, { version: draft.version }).expect(200);
    await api(cashier).post(`/billing/invoices/${draft.id}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "mgmt-pay-0001" }).expect(201);
  });

  afterAll(() => ctx.close());

  it("needs the management permission", async () => {
    await dashboard(doctor, "", undefined, 403);
  });

  it("puts every domain's figures for the organization side by side (last 30 days by default)", async () => {
    const body = await dashboard(admin);
    expect(body).toMatchObject({ from: manilaDate(-29), to: manilaDate(0), timeZone: "Asia/Manila", facilityIds: null, wholeOrganization: true });
    expect(body.facilities).toHaveLength(2);
    // Patient counts under five are suppressed, and the rate built on them withheld (the extras spec has larger numbers).
    expect(body.patients).toEqual({ registered: "<5", seen: "<5", returning: "<5", firstTime: "<5", returningRate: null, returningRateSuppressed: true });
    expect(body.clinic.appointments).toEqual({ booked: 2, completed: 1, noShow: 1, cancelled: 1, selfBooked: 0, noShowRate: 0.5 });
    expect(body.clinic.visits).toEqual({ checkedIn: 1, walkIns: 1, leftWithoutBeingSeen: 0, averageWaitMinutes: 30 });
    expect(body.clinic.encounters).toEqual({ completed: 2, telemedicine: 1, patientsSeen: "<5", returningPatients: "<5" });
    expect(body.clinic.providers).toEqual([
      expect.objectContaining({ displayName: "Dr. reyes", encounters: 2, patients: "<5", appointments: 2, noShows: 1, bookedMinutes: 30 }),
    ]);
    expect(body.laboratory).toMatchObject({ orders: { orders: 1, stat: 0, cancelled: 0 }, testsOrdered: 1, released: 1, corrections: 0, specimensRejected: 0 });
    expect(body.laboratory.topTests).toEqual([expect.objectContaining({ name: "FBS", ordered: 1 })]);
    expect(body.dental).toEqual({
      procedures: 1,
      patients: "<5",
      byProcedure: [{ code: "prophylaxis", name: "Oral prophylaxis", procedures: 1, patients: "<5" }],
    });
    expect(body.billing.invoices).toMatchObject({ issued: 1, netTotal: 50_000, voided: 0 });
    expect(body.billing).toMatchObject({ collectedTotal: 20_000, refundedTotal: 0, netCollected: 20_000 });
    expect(body.billing.collections).toEqual([expect.objectContaining({ method: "cash", collected: 20_000, payments: 1 })]);
    expect(body.billing.byCategory).toEqual([expect.objectContaining({ category: "other", net: 50_000 })]);
    expect(body.billing.topServices).toEqual([expect.objectContaining({ code: "cert", name: "Medical certificate", quantity: 1, net: 50_000 })]);
    // One row per day, today's holding today's activity.
    expect(body.daily).toHaveLength(30);
    expect(body.daily.at(-1)).toMatchObject({
      date: manilaDate(0),
      registered: "<5",
      patientsSeen: "<5",
      encounters: 2,
      labReleased: 1,
      invoiced: 50_000,
      collected: 20_000,
    });
    // Figures only: no patient is named.
    expect(JSON.stringify(body)).not.toMatch(/Dela Cruz|Juan|Garcia|Ana\b|P\d{8}/);
  });

  it("filters by facility and by range of local days", async () => {
    const annex = await dashboard(admin, `?facilityId=${tenant.otherFacilityId}`);
    expect(annex).toMatchObject({ facilityIds: [tenant.otherFacilityId], patients: { registered: "<5", seen: "<5", returning: 0 } });
    expect(annex.clinic.encounters).toMatchObject({ completed: 1, telemedicine: 1 });
    expect(annex.billing.invoices.issued).toBe(0);

    const day = manilaDate(-40);
    const past = await dashboard(admin, `?from=${day}&to=${day}`);
    expect(past.daily).toEqual([expect.objectContaining({ date: day, encounters: 1 })]);
    expect(past.clinic.encounters).toMatchObject({ completed: 1, returningPatients: 0 });
    expect(past.patients.registered).toBe(0);

    await dashboard(admin, `?from=${manilaDate(0)}&to=${manilaDate(-1)}`, undefined, 400);
    await dashboard(admin, `?from=${manilaDate(-400)}&to=${manilaDate(0)}`, undefined, 400);
    await dashboard(admin, "?from=2026-02-30", undefined, 400);
    await dashboard(admin, "?facilityId=00000000-0000-4000-8000-000000000000", undefined, 404);
  });

  it("limits a facility-scoped grant to its facilities", async () => {
    const own = await dashboard(annexManager, "", tenant.otherFacilityId);
    expect(own).toMatchObject({ wholeOrganization: false, facilityIds: [tenant.otherFacilityId], facilities: [{ id: tenant.otherFacilityId }] });
    expect(own.clinic.encounters.completed).toBe(1);
    await dashboard(annexManager, `?facilityId=${tenant.facilityId}`, tenant.otherFacilityId, 403);
    // Outside its facility the grant does not apply at all.
    await dashboard(annexManager, "", tenant.facilityId, 403);
  });

  it("audits each view with its range and facilities", async () => {
    const rows = await auditRows(ctx.pool, "action = 'management.dashboard.view'");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => (r.metadata as { facilityIds: string[] | null }).facilityIds?.[0] === tenant.otherFacilityId)).toBe(true);
  });
});
