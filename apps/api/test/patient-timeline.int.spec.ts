import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Entry {
  id: string;
  kind: string;
  occurredAt: string;
  facility: { id: string; name: string } | null;
  title: string;
  detail: string | null;
  status: string | null;
  marker: string | null;
  flag: string | null;
  link: { type: string; id: string } | null;
  sourceIds: Record<string, string>;
}
interface Page {
  items: Entry[];
  nextCursor: string | null;
  withheld: string[];
  timeZone: string;
}

/**
 * Patient 360 timeline (docs/domains/patient-timeline.md): one chronological list composed from every domain's read
 * query — ordered, linked, free of notes, values and message bodies, gated per kind by the domain's read permission,
 * cursor-paged without duplicates or gaps, filterable, organization-scoped and audited.
 */
describe("patient timeline", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let dentist: string;
  let cashier: string;
  let medtech: string;
  let otherOrgAdmin: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const timeline = async (token: string, query = "", status = 200): Promise<Page> =>
    (await api(token).get(`/patients/${patientId}/timeline${query}`).expect(status)).body;
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "timeline-org");
    await createStaff(ctx.pool, tenant, "admin@timeline.ph", ["org_admin"]);
    const doc = await createClinician(ctx, tenant, "reyes@timeline.ph", ["physician"]);
    await createClinician(ctx, tenant, "santos@timeline.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "cashier@timeline.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "medtech@timeline.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@timeline.ph")).accessToken;
    doctor = (await login(ctx, "reyes@timeline.ph")).accessToken;
    dentist = (await login(ctx, "santos@timeline.ph")).accessToken;
    cashier = (await login(ctx, "cashier@timeline.ph")).accessToken;
    medtech = (await login(ctx, "medtech@timeline.ph")).accessToken;
    const other = await createTenant(ctx.pool, "timeline-other");
    await createStaff(ctx.pool, other, "admin@other.ph", ["org_admin"]);
    otherOrgAdmin = (await login(ctx, "admin@other.ph")).accessToken;

    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const userOf = async (email: string) => (await q(`SELECT id FROM app_user WHERE email = $1`, [email])).rows[0].id as string;
    const adminUserId = await userOf("admin@timeline.ph");

    // 1. Appointments: one attended yesterday, one cancelled the day before (its reason must never appear).
    const visitTypeId = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 15 }).expect(201))
      .body.id;
    ids.appointment = (
      await q(
        `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, status, booking_channel, completed_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, now() - interval '1 day', now() - interval '1 day' + interval '15 minutes', 'completed', 'front_desk', now() - interval '1 day', $6, $6)
         RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, doc.practitionerId, visitTypeId, adminUserId],
      )
    ).rows[0].id;
    ids.cancelled = (
      await q(
        `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, status, booking_channel,
                                  cancelled_at, cancellation_reason, reason, created_by, updated_by, cancelled_by)
         VALUES ($1, $2, $3, $4, $5, now() - interval '2 days', now() - interval '2 days' + interval '15 minutes', 'cancelled', 'phone',
                 now() - interval '3 days', 'SECRET-CANCEL-REASON', 'SECRET-VISIT-REASON', $6, $6, $6) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, doc.practitionerId, visitTypeId, adminUserId],
      )
    ).rows[0].id;

    // 2. Consultation with a coded diagnosis (text and notes must never appear) and triage vitals.
    ids.encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "SECRET-COMPLAINT" }).expect(201)).body.id;
    await q(
      `INSERT INTO diagnosis (organization_id, patient_id, encounter_id, code_system_key, code, display, rank, certainty, notes, recorded_by, updated_by)
       VALUES ($1, $2, $3, 'icd-10', 'E11.9', 'SECRET-DIAGNOSIS-TEXT', 'primary', 'confirmed', 'SECRET-DIAGNOSIS-NOTE', $4, $4)`,
      [tenant.organizationId, patientId, ids.encounter, doc.userId],
    );
    ids.vitals = (
      await q(
        `INSERT INTO vital_sign_set (organization_id, facility_id, patient_id, encounter_id, measured_at, measured_by, systolic_mmhg, diastolic_mmhg)
         VALUES ($1, $2, $3, $4, now(), $5, 187, 99) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, ids.encounter, doc.userId],
      )
    ).rows[0].id;

    // 3. Prescription (instructions must never appear).
    ids.prescription = (
      await api(doctor)
        .post("/prescriptions", {
          encounterId: ids.encounter,
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
              instructions: "SECRET-INSTRUCTIONS",
            },
          ],
        })
        .expect(201)
    ).body.id;

    // 4. Care plan (its description must never appear).
    ids.carePlan = (
      await api(doctor)
        .post("/care-plans", {
          patientId,
          title: "Diabetes care plan",
          category: "chronic_disease",
          description: "SECRET-PLAN-DESCRIPTION",
          startDate: manilaDate(0),
          authorPractitionerId: doc.practitionerId,
        })
        .expect(201)
    ).body.id;

    // 5. Laboratory order, released with an abnormal value (the value must never appear).
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const fbs = (await lab("/tests", { code: "fbs", name: "FBS", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body.id;
    await lab(`/tests/${fbs}/reference-ranges`, { low: 3.9, high: 5.5 });
    const order = (
      await api(doctor)
        .post("/laboratory/orders", { patientId, encounterId: ids.encounter, testIds: [fbs], notes: "SECRET-ORDER-NOTE" })
        .expect(201)
    ).body;
    ids.labOrder = order.id;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 12.34 }).expect(201)).body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${order.id}/release`).expect(200);
    ids.labResult = result;

    // 6. Dental visit with a procedure (its notes must never appear).
    ids.dentalEncounter = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "SECRET-TOOTHACHE" }).expect(201)).body.id;
    const prophylaxis = (await api(admin).post("/dental/procedure-types", { code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" }).expect(201)).body
      .id;
    ids.dentalProcedure = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/procedures`, { encounterId: ids.dentalEncounter, procedureTypeId: prophylaxis, notes: "SECRET-DENTAL-NOTE" })
        .expect(201)
    ).body.id;

    // 7. Invoice issued and a payment.
    const service = (
      await api(admin)
        .post("/billing/services", { code: "cert", name: "Medical certificate", category: "other", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await api(cashier).post("/billing/charges", { patientId, serviceId: service }).expect(201);
    const draft = (await api(cashier).post("/billing/invoices", { patientId }).expect(201)).body;
    ids.invoice = draft.id;
    await api(cashier).post(`/billing/invoices/${draft.id}/issue`, { version: draft.version }).expect(200);
    ids.payment = (
      await api(cashier).post(`/billing/invoices/${draft.id}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "timeline-pay-0001" }).expect(201)
    ).body.id;

    // 8. A message to the patient (its body must never appear).
    ids.notification = (
      await q(
        `INSERT INTO notification (organization_id, recipient_type, recipient_patient_id, channel, category, template_key, template_version, destination, variables, status, created_by)
         VALUES ($1, 'patient', $2, 'sms', 'administrative', 'appointment.reminder', 1, '+639171234567', '{"body": "SECRET-MESSAGE-BODY"}', 'sent', $3) RETURNING id`,
        [tenant.organizationId, patientId, adminUserId],
      )
    ).rows[0].id;

    // Pagination fixtures on 15 January 2026 (Manila): rows sharing one instant across two sources, and one a microsecond later.
    const instant = "2026-01-15 03:00:00.123456+00";
    for (let i = 0; i < 6; i++) {
      await q(
        `INSERT INTO vital_sign_set (organization_id, facility_id, patient_id, measured_at, measured_by, heart_rate_bpm) VALUES ($1, $2, $3, $4, $5, 70)`,
        [tenant.organizationId, i === 0 ? tenant.otherFacilityId : tenant.facilityId, patientId, instant, adminUserId],
      );
      await q(
        `INSERT INTO notification (organization_id, recipient_type, recipient_patient_id, channel, category, template_key, template_version, variables, status, created_at)
         VALUES ($1, 'patient', $2, 'in_app', 'outreach', 'care-plan.follow-up-due', 1, '{}', 'delivered', $3)`,
        [tenant.organizationId, patientId, instant],
      );
    }
    await q(
      `INSERT INTO vital_sign_set (organization_id, facility_id, patient_id, measured_at, measured_by, heart_rate_bpm) VALUES ($1, $2, $3, '2026-01-15 03:00:00.123457+00', $4, 71)`,
      [tenant.organizationId, tenant.facilityId, patientId, adminUserId],
    );
  });

  afterAll(() => ctx.close());

  it("lists the patient's care in one chronological order, each entry linked to its record", async () => {
    const page = await timeline(admin, "?limit=100");
    expect(page.withheld).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.timeZone).toBe("Asia/Manila");
    const recent = page.items.filter((e) => e.occurredAt > "2026-06-01");
    expect(recent.map((e) => e.kind)).toEqual([
      "communication",
      "payment",
      "invoice",
      "dental",
      "encounter",
      "lab_result_release",
      "lab_order",
      "care_plan",
      "prescription",
      "vitals",
      "encounter",
      "appointment",
      "appointment",
    ]);
    const occurred = page.items.map((e) => e.occurredAt);
    expect(occurred).toEqual([...occurred].sort().reverse());

    const byId = new Map(page.items.map((e) => [e.id, e]));
    expect(byId.get(`encounter:${ids.encounter}`)).toMatchObject({
      title: "Consultation",
      detail: expect.stringContaining("Diagnoses: E11.9"),
      status: "in_progress",
      marker: null,
      facility: { id: tenant.facilityId, name: "Main Clinic" },
      link: { type: "encounter", id: ids.encounter },
    });
    expect(byId.get(`appointment:${ids.appointment}`)).toMatchObject({
      title: "Appointment: General consult",
      status: "completed",
      link: { type: "appointment", id: ids.appointment },
    });
    expect(byId.get(`appointment:${ids.cancelled}`)).toMatchObject({ status: "cancelled", marker: "cancelled" });
    expect(byId.get(`vitals:${ids.vitals}`)).toMatchObject({ title: "Vital signs recorded", detail: null, link: { type: "encounter", id: ids.encounter } });
    expect(byId.get(`prescription:${ids.prescription}`)).toMatchObject({
      detail: "Metformin",
      status: "active",
      link: { type: "encounter", id: ids.encounter },
      sourceIds: { prescriptionId: ids.prescription, encounterId: ids.encounter },
    });
    expect(byId.get(`care_plan:${ids.carePlan}`)).toMatchObject({
      title: "Care plan created: Diabetes care plan",
      link: { type: "care_plan", id: ids.carePlan },
    });
    expect(byId.get(`lab_order:${ids.labOrder}`)).toMatchObject({ detail: "FBS (1 test)", link: { type: "encounter", id: ids.encounter } });
    expect(byId.get(`lab_result_release:${ids.labResult}`)).toMatchObject({
      title: "Results released: FBS (1 test)",
      status: "released",
      flag: "abnormal",
      link: { type: "patient_laboratory", id: patientId },
    });
    expect(byId.get(`dental_procedure:${ids.dentalProcedure}`)).toMatchObject({
      title: "Dental procedure: Oral prophylaxis",
      detail: "Code prophylaxis",
      link: { type: "dental_record", id: patientId },
    });
    expect(byId.get(`invoice:${ids.invoice}`)).toMatchObject({ status: "issued", detail: "Total ₱500.00", link: { type: "invoice", id: ids.invoice } });
    expect(byId.get(`payment:${ids.payment}`)).toMatchObject({ title: "Payment ₱200.00", link: { type: "invoice", id: ids.invoice } });
    expect(byId.get(`communication:${ids.notification}`)).toMatchObject({
      title: "SMS: Appointment reminder",
      detail: "Administrative message",
      status: "sent",
      facility: null,
      link: null,
    });
  });

  it("never carries notes, reasons, complaints, diagnosis text, result values, vital values or message bodies", async () => {
    const body = JSON.stringify(await timeline(admin, "?limit=100"));
    expect(body).not.toMatch(/SECRET/);
    expect(body).not.toContain("12.34");
    expect(body).not.toContain("187");
    expect(body).not.toContain("+639171234567");
  });

  it("shows each kind only to callers with that domain's read permission and says which were withheld", async () => {
    const forCashier = await timeline(cashier, "?limit=100");
    expect(new Set(forCashier.items.map((e) => e.kind))).toEqual(new Set(["invoice", "payment"]));
    expect(forCashier.withheld).toEqual(
      expect.arrayContaining(["appointment", "encounter", "vitals", "prescription", "lab_order", "lab_result_release", "dental"]),
    );
    expect(forCashier.withheld).not.toContain("invoice");

    const forMedtech = await timeline(medtech, "?limit=100");
    expect(new Set(forMedtech.items.map((e) => e.kind))).toEqual(new Set(["lab_order", "lab_result_release"]));
    expect(forMedtech.withheld).toEqual(expect.arrayContaining(["dental", "encounter", "invoice", "communication"]));

    const forDoctor = await timeline(doctor, "?limit=100");
    expect(forDoctor.withheld).toEqual(["invoice", "payment"]);
    expect(forDoctor.items.some((e) => e.kind === "dental")).toBe(true);

    // Asking only for withheld kinds returns nothing and names them — without counts.
    const onlyClinical = await timeline(cashier, "?kinds=encounter,dental");
    expect(onlyClinical).toMatchObject({ items: [], withheld: ["encounter", "dental"], nextCursor: null });
  });

  it("pages through entries sharing one timestamp without duplicates or gaps", async () => {
    const filter = "kinds=vitals,communication&from=2026-01-15&to=2026-01-15";
    const all = await timeline(admin, `?${filter}&limit=100`);
    expect(all.items).toHaveLength(13);
    expect(all.items[0]).toMatchObject({ kind: "vitals", occurredAt: "2026-01-15T03:00:00.123457Z" });

    const seen: Entry[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Page = await timeline(admin, `?${filter}&limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.items.length).toBeLessThanOrEqual(4);
      seen.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.map((e) => e.id)).toEqual(all.items.map((e) => e.id));
    expect(new Set(seen.map((e) => e.id)).size).toBe(13);

    await api(admin).get(`/patients/${patientId}/timeline?cursor=not-a-cursor`).expect(400);
  });

  it("filters by kind, date range (facility time zone) and facility", async () => {
    const onlyOrders = await timeline(admin, "?kinds=prescription,lab_order");
    expect(onlyOrders.items.map((e) => e.kind).sort()).toEqual(["lab_order", "prescription"]);

    const januaryOnly = await timeline(admin, "?from=2026-01-15&to=2026-01-15&limit=100");
    expect(januaryOnly.items.every((e) => e.occurredAt.startsWith("2026-01-15"))).toBe(true);
    expect(januaryOnly.items).toHaveLength(13);
    // 03:00 UTC on 15 January is 11:00 in Manila: the day after holds none of them.
    const nextDay = await timeline(admin, "?from=2026-01-16&to=2026-01-16");
    expect(nextDay.items).toEqual([]);

    const annex = await timeline(admin, `?facilityId=${tenant.otherFacilityId}&limit=100`);
    expect(annex.items).toHaveLength(1);
    expect(annex.items[0]).toMatchObject({ kind: "vitals", facility: { id: tenant.otherFacilityId, name: "Annex Clinic" } });

    await api(admin).get(`/patients/${patientId}/timeline?kinds=gossip`).expect(400);
    await api(admin).get(`/patients/${patientId}/timeline?from=2026-02-30`).expect(400);
    await api(admin).get(`/patients/${patientId}/timeline?from=2026-02-02&to=2026-02-01`).expect(400);
    await api(admin).get(`/patients/${patientId}/timeline?facilityId=00000000-0000-4000-8000-000000000000`).expect(404);
  });

  it("is scoped to the caller's organization", async () => {
    await ctx.http().get(`/api/v1/patients/${patientId}/timeline`).set(as(otherOrgAdmin)).expect(404);
  });

  it("audits each view with its filters and counts, never content", async () => {
    await timeline(cashier, "?kinds=invoice,payment,encounter");
    const rows = await auditRows(ctx.pool, `action = 'patient.timeline.view' AND patient_id = $1`, [patientId]);
    const last = rows[rows.length - 1]!;
    expect(last.outcome).toBe("success");
    expect(last.metadata).toEqual({
      filters: { kinds: ["invoice", "payment", "encounter"], from: null, to: null, facilityId: null, page: "first" },
      counts: { invoice: 1, payment: 1 },
      withheld: ["encounter"],
    });
    expect(JSON.stringify(rows)).not.toMatch(/Metformin|Diabetes|SECRET/);
  });
});
