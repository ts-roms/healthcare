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

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";

/**
 * CLAUDE.md §31 critical journey, last step: the patient sees their own
 * appointments, prescriptions, care plan and released results in the portal —
 * only what is meant for them — and is told (without clinical detail) when
 * results are ready.
 */
describe("patient portal records", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let medtech: string;
  let practitionerId: string;
  let patientId: string;
  let otherPatientId: string;
  let encounterId: string;
  let patientToken: string;
  const tests: Record<string, string> = {};
  const results: Record<string, string> = {};
  let orderId: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
  });
  const portal = (url: string, token = patientToken) =>
    ctx
      .http()
      .get(`/api/v1/portal${url}`)
      .set({ authorization: `Bearer ${token}` });
  const notices = async (id = patientId) =>
    (
      await ctx.pool.query<{ channel: string; status: string; template_key: string }>(
        `SELECT channel, status, template_key FROM notification WHERE recipient_patient_id = $1 AND template_key = 'lab.results-available' ORDER BY created_at`,
        [id],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "records-org");
    await createStaff(ctx.pool, tenant, "admin@records.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@records.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "medtech@records.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@records.ph")).accessToken;
    doctor = (await login(ctx, "santos@records.ph")).accessToken;
    medtech = (await login(ctx, "medtech@records.ph")).accessToken;

    patientId = (await staff(admin).post("/api/v1/patients").send(juan).expect(201)).body.id;
    otherPatientId = (
      await staff(admin).post("/api/v1/patients").send({ familyName: "Reyes", givenName: "Ana", sex: "female", birthDate: "1995-12-21" }).expect(201)
    ).body.id;

    // Portal account for Juan: consent, invitation, activation, sign-in.
    await staff(admin)
      .post(`/api/v1/patients/${patientId}/consents`)
      .send({ consentType: "portal_access", decision: "granted", capturedVia: "paper" })
      .expect(201);
    const code = (await staff(admin).post(`/api/v1/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "records-org",
        patientNumber: "P00000001",
        birthDate: juan.birthDate,
        activationCode: code,
        email: "juan@records.ph",
        password: PATIENT_PASSWORD,
      })
      .expect(200);
    patientToken = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "records-org", email: "juan@records.ph", password: PATIENT_PASSWORD })
        .expect(200)
    ).body.accessToken;

    const encounter = await ctx.pool.query<{ id: string }>(
      `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by)
       SELECT $1, $2, $3, $4, user_id FROM practitioner WHERE id = $4 RETURNING id`,
      [tenant.organizationId, tenant.facilityId, patientId, practitionerId],
    );
    encounterId = encounter.rows[0]!.id;

    // Laboratory catalog: a releasable test, one the laboratory keeps from patients, and one that will be critical.
    const post = (path: string, body: object) => staff(admin).post(`/api/v1/laboratory${path}`).send(body).expect(201);
    const chem = (await post("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await post("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const test = async (code: string, extra: object) =>
      (
        await post("/tests", {
          code,
          name: code.toUpperCase(),
          departmentId: chem,
          specimenTypeId: serum,
          resultType: "numeric",
          unit: "mmol/L",
          decimalPlaces: 1,
          ...extra,
        })
      ).body.id;
    tests.fbs = await test("fbs", { loincCode: "1558-6" });
    tests.k = await test("potassium", {});
    tests.hiv = await test("hiv-screen", { patientReleasable: false });
    await post(`/tests/${tests.fbs}/reference-ranges`, { low: 3.9, high: 5.5 });
    await post(`/tests/${tests.k}/reference-ranges`, { low: 3.5, high: 5.1, criticalHigh: 6.5 });
  });

  afterAll(() => ctx.close());

  it("refuses staff tokens and shows an empty record to a new patient", async () => {
    await portal("/results", doctor).expect(401);
    await portal("/results", "not-a-token").expect(401);
    expect((await portal("/results").expect(200)).body).toEqual([]);
    expect((await portal("/appointments").expect(200)).body).toEqual({ upcoming: [], past: [] });
  });

  it("shows the patient's appointments, prescriptions and care plan", async () => {
    const visitType = (
      await staff(admin).post("/api/v1/clinic/visit-types").send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)
    ).body.id;
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await staff(admin)
      .post("/api/v1/appointments")
      .send({ patientId, practitionerId, facilityId: tenant.facilityId, visitTypeId: visitType, startsAt, outsideSchedule: true, reason: "Diabetes review" })
      .expect(201);
    await staff(doctor)
      .post("/api/v1/prescriptions")
      .send({
        encounterId,
        items: [
          {
            genericName: "Metformin",
            strength: "500 mg",
            dosageForm: "tablet",
            route: "oral",
            frequency: "twice_daily",
            quantity: 60,
            quantityUnit: "tablets",
            instructions: "Take with meals",
          },
        ],
      })
      .expect(201);
    await staff(doctor)
      .post("/api/v1/care-plans")
      .send({
        patientId,
        title: "Diabetes care plan",
        category: "chronic_disease",
        startDate: manilaDate(0),
        authorPractitionerId: practitionerId,
        goals: [{ description: "Glycemic control", targetMeasure: "HbA1c", targetValue: "< 7.0 %" }],
        activities: [
          { kind: "lifestyle", description: "Walk 30 minutes a day", assignee: "patient" },
          { kind: "follow_up_appointment", description: "Diabetes follow-up", assignee: "care_team", dueDate: manilaDate(28) },
        ],
      })
      .expect(201);

    const appointments = await portal("/appointments").expect(200);
    expect(appointments.body.upcoming).toEqual([
      expect.objectContaining({
        visitType: "Consultation",
        practitionerName: "Dr. santos",
        facilityName: "Main Clinic",
        status: "booked",
        timeZone: "Asia/Manila",
      }),
    ]);
    const prescriptions = await portal("/prescriptions").expect(200);
    expect(prescriptions.body).toEqual([
      expect.objectContaining({
        prescriberName: "Dr. santos",
        items: [expect.objectContaining({ genericName: "Metformin", instructions: "Take with meals" })],
      }),
    ]);
    expect(JSON.stringify(prescriptions.body)).not.toMatch(/allergyWarnings|issuedBy|prescriberPractitionerId/);
    const plans = await portal("/care-plans").expect(200);
    expect(plans.body[0]).toMatchObject({ title: "Diabetes care plan", goals: [expect.objectContaining({ description: "Glycemic control" })] });
    expect(plans.body[0].activities.map((a: { description: string }) => a.description)).toEqual(["Diabetes follow-up", "Walk 30 minutes a day"]);

    const audit = await auditRows(ctx.pool, "action LIKE 'portal.%-view' AND patient_id = $1", [patientId]);
    expect(audit.every((a) => a.actor_type === "patient")).toBe(true);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["portal.appointments-view", "portal.prescriptions-view", "portal.care-plans-view"]));
  });

  it("shows only released, patient-releasable results, and holds critical values until the care team acknowledges them", async () => {
    const order = await staff(doctor)
      .post("/api/v1/laboratory/orders")
      .send({ patientId, encounterId, testIds: [tests.fbs, tests.k, tests.hiv] })
      .expect(201);
    orderId = order.body.id;
    const items = Object.fromEntries(order.body.items.map((i: { testCode: string; id: string }) => [i.testCode, i.id]));
    const specimen = (
      await staff(medtech)
        .post(`/api/v1/laboratory/orders/${orderId}/specimens`)
        .send({ specimenTypeId: order.body.items[0].specimenTypeId, itemIds: Object.values(items) })
        .expect(201)
    ).body.specimens[0].id;
    await staff(medtech).post(`/api/v1/laboratory/specimens/${specimen}/receive`).expect(200);
    for (const [code, value] of [
      ["fbs", 7.2],
      ["potassium", 6.8],
      ["hiv-screen", 0.1],
    ] as const) {
      results[code] = (await staff(medtech).post(`/api/v1/laboratory/order-items/${items[code]}/results`).send({ valueNumeric: value }).expect(201)).body.id;
    }
    // Before release the patient sees nothing.
    expect((await portal("/results").expect(200)).body).toEqual([]);

    for (const id of Object.values(results)) {
      await staff(admin).post(`/api/v1/laboratory/results/${id}/verify`).expect(200);
      await staff(admin).post(`/api/v1/laboratory/results/${id}/approve`).expect(200);
    }
    await staff(admin).post(`/api/v1/laboratory/orders/${orderId}/release`).expect(200);
    await drainEvents(ctx);

    const visible = await portal("/results").expect(200);
    expect(visible.body).toEqual([expect.objectContaining({ testName: "FBS", valueNumeric: 7.2, flag: "high", refLow: 3.9, refHigh: 5.5, corrected: false })]);
    expect(JSON.stringify(visible.body)).not.toMatch(/enteredBy|verifiedBy|comment|instrument/);

    // One SMS (the patient has a mobile number) pointing to the portal; no test name or value.
    expect(await notices()).toEqual([{ channel: "sms", status: "queued", template_key: "lab.results-available" }]);
    const sent = await ctx.pool.query<{ variables: Record<string, unknown> }>(
      `SELECT variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'lab.results-available'`,
      [patientId],
    );
    expect(JSON.stringify(sent.rows)).not.toMatch(/7\.2|FBS|potassium/i);

    // The ordering doctor acknowledges the critical potassium; now the patient sees it too.
    const alerts = await staff(admin).get("/api/v1/laboratory/critical-results").expect(200);
    await staff(doctor).post(`/api/v1/laboratory/critical-results/${alerts.body[0].id}/acknowledge`).expect(200);
    await drainEvents(ctx);
    const after = await portal("/results").expect(200);
    expect(after.body.map((r: { testName: string }) => r.testName).sort()).toEqual(["FBS", "POTASSIUM"]);
    // Same order, same day: no second message.
    expect(await notices()).toHaveLength(1);
  });

  it("tells the patient when a result they can see is corrected, and keeps trends to visible results", async () => {
    const corrected = await staff(admin)
      .post(`/api/v1/laboratory/results/${results.fbs}/correct`)
      .send({ valueNumeric: 6.2, reason: "Transcription error" })
      .expect(201);
    await staff(medtech).post(`/api/v1/laboratory/results/${corrected.body.id}/verify`).expect(200);
    // While the correction is signed off, the patient no longer sees the superseded value.
    expect((await portal("/results").expect(200)).body.map((r: { testName: string }) => r.testName)).toEqual(["POTASSIUM"]);
    // The admin entered the correction; the facility allows self-approval and releases on approval.
    await ctx
      .http()
      .put("/api/v1/laboratory/policy")
      .set(as(admin, tenant.facilityId))
      .send({ allowSelfVerification: false, allowSelfApproval: true, releaseOnApproval: true, reason: "Single pathologist on duty" })
      .expect(200);
    await staff(admin).post(`/api/v1/laboratory/results/${corrected.body.id}/approve`).expect(200);
    await drainEvents(ctx);

    const visible = await portal("/results").expect(200);
    expect(visible.body.find((r: { testName: string }) => r.testName === "FBS")).toMatchObject({ valueNumeric: 6.2, corrected: true });
    expect((await notices()).length).toBe(2);

    const trend = await portal(`/results/trend?testId=${tests.fbs}`).expect(200);
    expect(trend.body).toMatchObject({ analyte: "loinc:1558-6", points: [expect.objectContaining({ valueNumeric: 6.2 })] });
    expect((await portal(`/results/trend?testId=${tests.hiv}`).expect(200)).body.points).toEqual([]);
  });

  it("never shows another patient's records", async () => {
    const other = await staff(doctor)
      .post("/api/v1/laboratory/orders")
      .send({ patientId: otherPatientId, testIds: [tests.fbs] });
    expect([201, 403, 422]).toContain(other.status);
    const visible = await portal("/results").expect(200);
    expect(visible.body.every((r: { orderNumber: string }) => r.orderNumber === "LO00000001")).toBe(true);
  });
});
