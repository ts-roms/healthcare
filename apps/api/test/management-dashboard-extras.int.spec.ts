import { zonedToUtc } from "@healthcare/core";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Management dashboard extras (docs/architecture/management-dashboard.md): small-cell suppression, previous-period
 * comparison, retention and return, online consultations, specimen rejection and results per instrument, schedule
 * utilization, revenue gated by billing.report.read, CSV sections, no patient identifiers, audit and organization
 * isolation — over a dataset whose figures are known exactly.
 */
describe("management dashboard extras", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let noBilling: string;
  let annexBilling: string;
  let otherAdmin: string;
  let otherFacilityId: string;
  const secrets: string[] = [];

  /** A local Manila wall-clock time `days` from today, as an ISO instant. */
  const at = (days: number, time: string) => zonedToUtc(manilaDate(days), time, "Asia/Manila").toISOString();
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);
  const api = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const dashboard = async (token: string, query = "", status = 200, facilityId?: string) =>
    (await api(token, facilityId).get(`/management/dashboard${query}`).expect(status)).body;
  const csv = async (token: string, query: string, status = 200) => {
    const response = await api(token).get(`/management/dashboard.csv?${query}`).buffer(true).expect(status);
    return { text: response.text as string, headers: response.headers as Record<string, string> };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "mgmtx-org");
    const adminUserId = await createStaff(ctx.pool, tenant, "admin@mgmtx.ph", ["org_admin"]);
    const doc = await createClinician(ctx, tenant, "reyes@mgmtx.ph", ["physician"]);
    const doc2 = await createClinician(ctx, tenant, "santos@mgmtx.ph", ["physician"]);
    await createClinician(ctx, tenant, "lim@mgmtx.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "medtech@mgmtx.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@mgmtx.ph")).accessToken;
    const dentist = (await login(ctx, "lim@mgmtx.ph")).accessToken;
    const medtech = (await login(ctx, "medtech@mgmtx.ph")).accessToken;

    // A manager role with the dashboard but not billing reports: one user organization-wide; another also a cashier
    // (billing.report.read) at the annex only.
    const role = (
      await q(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'ops_manager', 'Operations manager') RETURNING id`, [tenant.organizationId])
    ).rows[0].id;
    await q(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'management.dashboard.read')`, [role]);
    for (const [email, extra] of [
      ["ops@mgmtx.ph", []],
      ["ops-annex@mgmtx.ph", [{ role: "cashier", facilityId: tenant.otherFacilityId }]],
    ] as const) {
      const userId = await createStaff(ctx.pool, tenant, email, [...extra]);
      await q(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.organizationId, userId, role]);
    }
    noBilling = (await login(ctx, "ops@mgmtx.ph")).accessToken;
    annexBilling = (await login(ctx, "ops-annex@mgmtx.ph")).accessToken;

    // Eight patients; P1–P7 registered long ago, P8 in the period.
    const names = ["Alcaraz", "Bautista", "Castillo", "Dimaculangan", "Evangelista", "Fernandez", "Gatchalian", "Hernandez"];
    const patients: string[] = [];
    for (const [i, familyName] of names.entries()) {
      const created = (
        await api(admin)
          .post("/patients", { familyName, givenName: `Pasyente${i}`, sex: "female", birthDate: `19${60 + i}-01-1${i}` })
          .expect(201)
      ).body;
      patients.push(created.id);
      secrets.push(familyName, created.id, created.patientNumber);
    }
    await q(`UPDATE patient SET created_at = now() - interval '200 days' WHERE id = ANY($1::uuid[])`, [patients.slice(0, 7)]);
    const [p1, p2, p3, p4, p5, p6, p7, p8] = patients as [string, string, string, string, string, string, string, string];

    // Completed consultations: P1–P6 120 days ago; P1–P5 and P7 45 days ago (the previous period); P1–P8 yesterday
    // with Dr. Reyes and P1–P2 two days ago with Dr. Santos (this period).
    const encounter = (patientId: string, completedAt: string, practitioner = doc, status = "completed") =>
      q(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, modality, status, started_at, completed_at,
                                signed_by_practitioner_id, started_by)
         VALUES ($1, $2, $3, $4, 'in_person', $6, $5::timestamptz - interval '20 minutes',
                 CASE WHEN $6 = 'completed' THEN $5::timestamptz END, CASE WHEN $6 = 'completed' THEN $4::uuid END, $7)
         RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, practitioner.practitionerId, completedAt, status, practitioner.userId],
      );
    for (const p of [p1, p2, p3, p4, p5, p6]) await encounter(p, at(-120, "10:00"));
    for (const p of [p1, p2, p3, p4, p5, p7]) await encounter(p, at(-45, "10:00"));
    for (const p of patients) await encounter(p, at(-1, "10:00"));
    for (const p of [p1, p2]) await encounter(p, at(-2, "10:00"), doc2);

    // Appointments with Dr. Reyes, 30 minutes each. This period: yesterday 3 completed + 1 no-show + 1 cancelled, and
    // four online consultations two days ago. Previous period: 2 completed + 2 no-shows.
    const visitType = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 30 }).expect(201)).body
      .id;
    const appointment = async (patientId: string, startsAt: string, status: string) =>
      (
        await q(
          `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, status, booking_channel,
                                    completed_at, no_show_at, cancelled_at, cancelled_by, cancellation_reason, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '30 minutes', $7, 'front_desk',
                   CASE WHEN $7 = 'completed' THEN $6::timestamptz END, CASE WHEN $7 = 'no_show' THEN $6::timestamptz END,
                   CASE WHEN $7 = 'cancelled' THEN now() END, CASE WHEN $7 = 'cancelled' THEN $8::uuid END,
                   CASE WHEN $7 = 'cancelled' THEN 'Patient asked' END, $8, $8)
           RETURNING id`,
          [tenant.organizationId, tenant.facilityId, patientId, doc.practitionerId, visitType, startsAt, status, adminUserId],
        )
      ).rows[0].id as string;
    await appointment(p1, at(-1, "09:00"), "completed");
    await appointment(p2, at(-1, "09:30"), "completed");
    await appointment(p3, at(-1, "10:00"), "completed");
    await appointment(p4, at(-1, "10:30"), "no_show");
    await appointment(p5, at(-1, "11:00"), "cancelled");
    await appointment(p1, at(-45, "09:00"), "completed");
    await appointment(p2, at(-45, "09:30"), "completed");
    await appointment(p3, at(-45, "10:00"), "no_show");
    await appointment(p4, at(-45, "10:30"), "no_show");

    // Online consultations two days ago: two ended, one escalated, one still in consultation (encounters left open).
    for (const [i, status] of ["ended", "ended", "escalated", "in_consultation"].entries()) {
      const patientId = patients[i]!;
      const startsAt = at(-2, `1${4 + i}:00`);
      const appointmentId = await appointment(patientId, startsAt, "completed");
      const visitId = (
        await q(
          `INSERT INTO visit (organization_id, facility_id, patient_id, appointment_id, visit_type_id, arrival_mode, queue_date, queue_number, status,
                              checked_in_at, checked_in_by, completed_at)
           VALUES ($1, $2, $3, $4, $5, 'appointment', $6::date, $7, 'completed', $8, $9, $8) RETURNING id`,
          [tenant.organizationId, tenant.facilityId, patientId, appointmentId, visitType, manilaDate(-2), 900 + i, startsAt, adminUserId],
        )
      ).rows[0].id;
      const encounterId = (await encounter(patientId, startsAt, doc, "in_progress")).rows[0].id;
      const finished = status === "ended" || status === "escalated";
      await q(
        `INSERT INTO telemedicine_session (organization_id, facility_id, patient_id, appointment_id, visit_id, encounter_id, room_name, status,
                                           patient_joined_at, started_at, started_by, ended_at, ended_by, escalation_reason)
         VALUES ($1, $2, $3, $4::uuid, $5, $6, 'tm-' || md5($4::text), $7, $8, $8, $9, $10, $11, $12)`,
        [
          tenant.organizationId,
          tenant.facilityId,
          patientId,
          appointmentId,
          visitId,
          encounterId,
          status,
          startsAt,
          doc.userId,
          finished ? startsAt : null,
          finished ? doc.userId : null,
          status === "escalated" ? "Needs examination in person" : null,
        ],
      );
    }

    // Dr. Reyes's schedule: 08:00–12:00 every day, with a day of leave three days ago (30 × 240 − 240 = 6,960 minutes).
    for (let dow = 0; dow < 7; dow++) {
      await q(
        `INSERT INTO practitioner_schedule (organization_id, practitioner_id, facility_id, day_of_week, start_time, end_time, slot_minutes, valid_from, created_by)
         VALUES ($1, $2, $3, $4, '08:00', '12:00', 30, $5::date, $6)`,
        [tenant.organizationId, doc.practitionerId, tenant.facilityId, dow, manilaDate(-90), adminUserId],
      );
    }
    await q(
      `INSERT INTO schedule_exception (organization_id, facility_id, practitioner_id, starts_at, ends_at, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Leave', $6)`,
      [tenant.organizationId, tenant.facilityId, doc.practitionerId, at(-3, "00:00"), at(-2, "00:00"), adminUserId],
    );

    // Dental: P8's procedure today.
    const dentalEncounter = (await api(dentist).post("/encounters", { patientId: p8 }).expect(201)).body.id;
    const prophylaxis = (await api(admin).post("/dental/procedure-types", { code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" }).expect(201)).body
      .id;
    await api(dentist).post(`/dental/patients/${p8}/procedures`, { encounterId: dentalEncounter, procedureTypeId: prophylaxis }).expect(201);

    // Laboratory: P1's test entered on an instrument (named like a spreadsheet formula) and released; P2's specimen
    // rejected. Two specimens collected, one rejected.
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const fbs = (await lab("/tests", { code: "fbs", name: "FBS", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body.id;
    const analyzer = (await lab("/instruments", { code: "chem-1", name: "=Analyzer One", departmentId: chem })).body.id;
    const order = (
      await api(medtech)
        .post("/laboratory/orders", { patientId: p1, source: "external", externalOrderer: "Dr. Cruz", testIds: [fbs] })
        .expect(201)
    ).body;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: serum, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 5.2, instrumentId: analyzer }).expect(201))
      .body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${order.id}/release`).expect(200);
    const order2 = (
      await api(medtech)
        .post("/laboratory/orders", { patientId: p2, source: "external", externalOrderer: "Dr. Cruz", testIds: [fbs] })
        .expect(201)
    ).body;
    const specimen2 = (
      await api(medtech)
        .post(`/laboratory/orders/${order2.id}/specimens`, { specimenTypeId: serum, itemIds: [order2.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen2}/reject`, { reason: "Hemolyzed sample" }).expect(200);

    // Billing: P1's consultation ₱500.00 issued, ₱200.00 paid in cash.
    const service = (
      await api(admin)
        .post("/billing/services", { code: "consult-fee", name: "Consultation", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await api(admin).post("/billing/charges", { patientId: p1, serviceId: service }).expect(201);
    const draft = (await api(admin).post("/billing/invoices", { patientId: p1 }).expect(201)).body;
    await api(admin).post(`/billing/invoices/${draft.id}/issue`, { version: draft.version }).expect(200);
    await api(admin).post(`/billing/invoices/${draft.id}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "mgmtx-pay-0001" }).expect(201);

    // Another organization with a patient seen yesterday.
    const other = await createTenant(ctx.pool, "mgmtx-other");
    await createStaff(ctx.pool, other, "admin@other-mgmtx.ph", ["org_admin"]);
    otherAdmin = (await login(ctx, "admin@other-mgmtx.ph")).accessToken;
    otherFacilityId = other.facilityId;
    const otherDoc = await createClinician(ctx, other, "doc@other-mgmtx.ph", ["physician"]);
    const otherPatient = (
      await ctx
        .http()
        .post("/api/v1/patients")
        .set(as(otherAdmin, other.facilityId))
        .send({ familyName: "Ibarra", givenName: "Crisostomo", sex: "male", birthDate: "1970-01-01" })
        .expect(201)
    ).body.id;
    secrets.push("Ibarra", otherPatient);
    await q(
      `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, modality, status, started_at, completed_at, signed_by_practitioner_id, started_by)
       VALUES ($1, $2, $3, $4, 'in_person', 'completed', $5::timestamptz - interval '20 minutes', $5, $4, $6)`,
      [other.organizationId, other.facilityId, otherPatient, otherDoc.practitionerId, at(-1, "10:00"), otherDoc.userId],
    );
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it("suppresses patient counts under five and the rates built on them", async () => {
    const body = await dashboard(admin);
    expect(body).toMatchObject({ suppressionThreshold: 5, withheld: [] });
    // 8 seen (P1–P8), 7 seen before the period, 1 first-time, 1 registered.
    expect(body.patients).toEqual({ registered: "<5", seen: 8, returning: 7, firstTime: "<5", returningRate: 0.875, returningRateSuppressed: false });
    expect(body.clinic.encounters).toEqual({ completed: 10, telemedicine: 0, patientsSeen: 8, returningPatients: 7 });
    const byName = (name: string) => body.clinic.providers.find((p: { displayName: string }) => p.displayName === name);
    expect(byName("Dr. reyes")).toMatchObject({ encounters: 8, patients: 8 });
    expect(byName("Dr. santos")).toMatchObject({ encounters: 2, patients: "<5" });
    expect(body.dental).toEqual({
      procedures: 1,
      patients: "<5",
      byProcedure: [{ code: "prophylaxis", name: "Oral prophylaxis", procedures: 1, patients: "<5" }],
    });
    expect(body.billing.topServices).toEqual([expect.objectContaining({ code: "consult-fee", quantity: 1, patients: "<5", net: 50_000 })]);
    const day = (d: number) => body.daily.find((r: { date: string }) => r.date === manilaDate(d));
    expect(day(-1)).toMatchObject({ patientsSeen: 8, encounters: 8, registered: 0 });
    expect(day(-2)).toMatchObject({ patientsSeen: "<5", encounters: 2 });
    expect(day(0)).toMatchObject({ patientsSeen: 0, registered: "<5", labReleased: 1, invoiced: 50_000, collected: 20_000 });

    // Returning rate is withheld when seen is a small cell (one facility's figures: the annex saw nobody → 0 shown).
    const oneDay = await dashboard(admin, `?from=${manilaDate(-2)}&to=${manilaDate(-2)}`);
    expect(oneDay.patients).toMatchObject({ seen: "<5", returning: "<5", returningRate: null, returningRateSuppressed: true });
    const annex = await dashboard(admin, `?facilityId=${tenant.otherFacilityId}`);
    expect(annex.patients).toMatchObject({ seen: 0, returningRate: null, returningRateSuppressed: false });
  });

  it("compares the headline figures with the previous equal period", async () => {
    const body = await dashboard(admin);
    expect(body.previous).toEqual({ from: manilaDate(-59), to: manilaDate(-30) });
    const figure = (key: string) => body.comparison.find((f: { key: string }) => f.key === key);
    // 8 patients now, 6 (P1–P5, P7) before.
    expect(figure("patientsSeen")).toEqual({
      key: "patientsSeen",
      unit: "patients",
      better: "up",
      current: 8,
      previous: 6,
      change: { absolute: 2, relative: 0.3333, direction: "up", assessment: "better" },
    });
    expect(figure("consultations")).toMatchObject({ current: 10, previous: 6, change: { direction: "up", assessment: "better" } });
    // No-shows: 1 of 8 booked now (4 in person + 4 online), 2 of 4 before — lower is better.
    expect(figure("noShowRate")).toMatchObject({
      better: "down",
      current: 0.125,
      previous: 0.5,
      change: { absolute: -0.375, relative: null, direction: "down", assessment: "better" },
    });
    // Nothing collected before: no rejection rate to compare; revenue compared from zero.
    expect(figure("specimenRejectionRate")).toMatchObject({ current: 0.5, previous: null, change: null });
    expect(figure("invoicedNet")).toMatchObject({ current: 50_000, previous: 0, change: { absolute: 50_000, relative: null, assessment: "better" } });
    // Retention now 7 of 8; before, 5 of 6 (P1–P5 seen 120 days ago; P7 not).
    expect(figure("retentionRate")).toMatchObject({ current: 0.875, previous: 0.833, change: { assessment: "better" } });

    const uncompared = await dashboard(admin, "?compare=false");
    expect(uncompared).toMatchObject({ previous: null, comparison: [] });
  });

  it("reports retention and return within 90 days", async () => {
    const body = await dashboard(admin);
    // Seen in the period: P1–P8; also seen in the 12 months before it: P1–P7. Nobody's first visit in the period is
    // more than 90 days ago, so the return cohort is empty.
    expect(body.retention).toEqual({
      lookbackMonths: 12,
      returnWindowDays: 90,
      seen: 8,
      retained: 7,
      retentionRate: 0.875,
      retentionRateSuppressed: false,
      returnCohort: 0,
      returned: 0,
      returnRate: null,
      returnRateSuppressed: false,
    });
    // 120 days ago: P1–P6 seen (none before); P1–P5 came back 75 days later, P6 only after 119 days.
    const past = await dashboard(admin, `?from=${manilaDate(-125)}&to=${manilaDate(-115)}`);
    expect(past.retention).toMatchObject({ seen: 6, retained: 0, retentionRate: 0, returnCohort: 6, returned: 5, returnRate: 0.833 });
  });

  it("counts online consultations, laboratory rejections and results per instrument", async () => {
    const body = await dashboard(admin);
    expect(body.telemedicine).toEqual({ started: 4, ended: 2, escalated: 1, inProgress: 1, escalationRate: 0.333 });
    expect(body.laboratory.specimens).toEqual({ collected: 2, rejected: 1, rejectionRate: 0.5 });
    expect(body.laboratory.specimensRejected).toBe(1);
    expect(body.laboratory.byInstrument).toEqual([{ instrumentId: expect.any(String), name: "=Analyzer One", results: 1 }]);
  });

  it("reports schedule utilization per practitioner", async () => {
    const body = await dashboard(admin);
    const reyes = body.clinic.providers.find((p: { displayName: string }) => p.displayName === "Dr. reyes");
    // 8 appointments not cancelled × 30 minutes (the no-show included) over 6,960 available minutes.
    expect(reyes).toMatchObject({ appointments: 8, noShows: 1, bookedMinutes: 240, availableMinutes: 6_960, utilization: 0.034 });
    const santos = body.clinic.providers.find((p: { displayName: string }) => p.displayName === "Dr. santos");
    expect(santos).toMatchObject({ bookedMinutes: 0, availableMinutes: 0, utilization: null });
    expect(body.clinic.utilization).toEqual({ bookedMinutes: 240, availableMinutes: 6_960, rate: 0.034 });
    // One day of leave: nothing available that day.
    const leave = await dashboard(admin, `?from=${manilaDate(-3)}&to=${manilaDate(-3)}`);
    expect(leave.clinic.utilization).toEqual({ bookedMinutes: 0, availableMinutes: 0, rate: null });
  });

  it("withholds revenue without billing.report.read on every facility in scope, and does not query billing", async () => {
    const body = await dashboard(noBilling);
    expect(body).toMatchObject({ withheld: ["billing"], billing: null });
    expect(body.patients.seen).toBe(8);
    expect(body.daily.at(-1)).toMatchObject({ invoiced: null, collected: null, labReleased: 1 });
    expect(body.comparison.map((f: { key: string }) => f.key)).not.toContain("invoicedNet");
    // A cashier grant at the annex covers the annex only.
    expect((await dashboard(annexBilling)).withheld).toEqual(["billing"]);
    const annex = await dashboard(annexBilling, `?facilityId=${tenant.otherFacilityId}`);
    expect(annex.withheld).toEqual([]);
    expect(annex.billing.invoices.issued).toBe(0);
    // The organization administrator (billing.report.read organization-wide) sees revenue.
    expect((await dashboard(admin)).billing.invoices).toMatchObject({ issued: 1, netTotal: 50_000 });
  });

  it("exports sections as CSV with the same rules", async () => {
    const summary = await csv(admin, "section=summary");
    expect(summary.headers["content-type"]).toMatch(/^text\/csv/);
    expect(summary.headers["content-disposition"]).toBe(`attachment; filename="management-summary-${manilaDate(-29)}-to-${manilaDate(0)}.csv"`);
    expect(summary.text).toContain(`Compared with,${manilaDate(-59)} to ${manilaDate(-30)}`);
    expect(summary.text).toContain("Patients seen,8,6,2,33.3,higher,better\r\n");
    expect(summary.text).toContain("No-show rate (%),12.5,50.0,-37.5,,lower,better\r\n");
    expect(summary.text).toContain("Invoiced net (PHP),500.00,0.00,500.00,,higher,better\r\n");

    const providers = (await csv(admin, "section=providers")).text;
    expect(providers).toContain("Dr. santos,2,<5,0,0,0,0,\r\n");
    expect(providers).toContain("Dr. reyes,8,8,8,1,240,6960,3.4\r\n");
    // Text a spreadsheet would run as a formula is prefixed.
    expect((await csv(admin, "section=lab-instruments")).text).toContain("'=Analyzer One,1\r\n");
    expect((await csv(admin, "section=dental-procedures")).text).toContain("prophylaxis,Oral prophylaxis,1,<5\r\n");
    expect((await csv(admin, "section=telemedicine")).text).toContain("4,2,1,1,33.3\r\n");
    expect((await csv(admin, "section=retention")).text).toContain("8,7,87.5,0,0,\r\n");
    expect((await csv(admin, "section=services")).text).toContain("consult-fee,Consultation,consultation,1,<5,500.00\r\n");
    expect((await csv(admin, "section=daily")).text).toContain(`${manilaDate(0)},<5,0,0,1,500.00,200.00\r\n`);

    // Without billing reports: revenue sections refused, revenue columns left out of the daily table.
    await csv(noBilling, "section=revenue", 403);
    await csv(noBilling, "section=services", 403);
    const daily = (await csv(noBilling, "section=daily")).text;
    expect(daily).toContain("Date,New patients,Patients seen,Consultations,Lab tests released\r\n");
    expect(daily).not.toContain("Invoiced");
    await csv(admin, "section=unknown", 400);
    await csv(admin, `section=summary&facilityId=00000000-0000-4000-8000-000000000000`, 404);
  });

  it("never names a patient, in JSON or CSV", async () => {
    const body = JSON.stringify(await dashboard(admin));
    const exports = await Promise.all(
      [
        "summary",
        "daily",
        "providers",
        "laboratory",
        "lab-tests",
        "lab-instruments",
        "dental-procedures",
        "telemedicine",
        "retention",
        "revenue",
        "services",
      ].map(async (section) => (await csv(admin, `section=${section}`)).text),
    );
    for (const text of [body, ...exports]) for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it("keeps organizations apart", async () => {
    const other = await dashboard(otherAdmin, "", 200, otherFacilityId);
    expect(other.patients).toMatchObject({ seen: "<5", returning: 0 });
    expect(other.clinic.encounters.completed).toBe(1);
    expect(other.telemedicine.started).toBe(0);
    expect(other.laboratory.specimens.collected).toBe(0);
    // Our facilities are unknown to the other organization.
    await dashboard(otherAdmin, `?facilityId=${tenant.facilityId}`, 404, otherFacilityId);
    // Ours still counts only our own patients.
    expect((await dashboard(admin)).clinic.encounters.completed).toBe(10);
  });

  it("audits JSON and CSV views with the format, section and what was withheld", async () => {
    const rows = await auditRows(ctx.pool, "action = 'management.dashboard.view' AND organization_id = $1", [tenant.organizationId]);
    const meta = rows.map((r) => r.metadata as { format: string; section?: string; withheld: string[] });
    expect(meta.some((m) => m.format === "json" && m.withheld.length === 0)).toBe(true);
    expect(meta.some((m) => m.format === "json" && m.withheld[0] === "billing")).toBe(true);
    expect(meta.some((m) => m.format === "csv" && m.section === "summary")).toBe(true);
    expect(meta.some((m) => m.format === "csv" && m.section === "daily" && m.withheld[0] === "billing")).toBe(true);
    // A refused revenue export is not recorded as a view.
    expect(meta.some((m) => m.format === "csv" && m.section === "revenue" && m.withheld.length > 0)).toBe(false);
    expect(rows.every((r) => r.patient_id === null)).toBe(true);
  });
});
