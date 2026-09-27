import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * CLAUDE.md §31 critical journey (laboratory part):
 * consultation → lab order → specimen collection → receipt → result → verification
 * → approval → release → correction, with separation of duties and critical values.
 */
describe("laboratory journey", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let medtech: string;
  let medtech2: string;
  let pathologist: string;
  let patientId: string;
  let encounterId: string;
  let practitionerId: string;
  const catalog: Record<string, string> = {};
  let orderId: string;
  let items: Record<string, string>;
  let specimenId: string;
  let accession: string;
  const results: Record<string, string> = {};
  let alertId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@example.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "nurse@example.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "medtech2@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@example.ph", ["pathologist"]);
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    doctor = (await login(ctx, "santos@example.ph")).accessToken;
    nurse = (await login(ctx, "nurse@example.ph")).accessToken;
    medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    medtech2 = (await login(ctx, "medtech2@example.ph")).accessToken;
    pathologist = (await login(ctx, "patho@example.ph")).accessToken;

    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
    const encounter = await ctx.pool.query<{ id: string }>(
      `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by)
       SELECT $1, $2, $3, $4, user_id FROM practitioner WHERE id = $4 RETURNING id`,
      [tenant.organizationId, tenant.facilityId, patientId, practitionerId],
    );
    encounterId = encounter.rows[0]!.id;
  });

  afterAll(() => ctx.close());

  const at = (token: string) => as(token, tenant.facilityId);
  const post = (path: string, token: string, body: object = {}) => ctx.http().post(`/api/v1/laboratory${path}`).set(at(token)).send(body);
  const get = (path: string, token: string) => ctx.http().get(`/api/v1/laboratory${path}`).set(at(token));

  it("builds the catalog: departments, specimen types, tests, reference ranges and a panel", async () => {
    await post("/departments", doctor, { code: "chem", name: "Clinical Chemistry" }).expect(403);
    catalog.chem = (await post("/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    catalog.sero = (await post("/departments", admin, { code: "sero", name: "Immunology / Serology" }).expect(201)).body.id;
    await post("/departments", admin, { code: "chem", name: "Duplicate" }).expect(409);
    catalog.serum = (await post("/specimen-types", admin, { code: "serum", name: "Serum", container: "Red-top tube" }).expect(201)).body.id;
    catalog.blood = (await post("/specimen-types", admin, { code: "wb-edta", name: "Whole blood (EDTA)", container: "Lavender-top tube" }).expect(201)).body.id;

    const fbs = await post("/tests", pathologist, {
      code: "fbs",
      name: "Fasting blood sugar",
      departmentId: catalog.chem,
      specimenTypeId: catalog.serum,
      resultType: "numeric",
      unit: "mmol/L",
      decimalPlaces: 1,
      requiresFasting: true,
      turnaroundMinutes: 120,
      loincCode: "1558-6",
    }).expect(201);
    catalog.fbs = fbs.body.id;
    catalog.k = (
      await post("/tests", pathologist, {
        code: "potassium",
        name: "Potassium",
        departmentId: catalog.chem,
        specimenTypeId: catalog.serum,
        resultType: "numeric",
        unit: "mmol/L",
        decimalPlaces: 1,
      }).expect(201)
    ).body.id;
    catalog.hbsag = (
      await post("/tests", pathologist, {
        code: "hbsag",
        name: "Hepatitis B surface antigen",
        departmentId: catalog.sero,
        specimenTypeId: catalog.serum,
        resultType: "coded",
        codedValues: ["Reactive", "Nonreactive"],
        abnormalCodedValues: ["Reactive"],
        patientReleasable: false,
      }).expect(201)
    ).body.id;
    catalog.hba1c = (
      await post("/tests", pathologist, {
        code: "hba1c",
        name: "HbA1c",
        departmentId: catalog.chem,
        specimenTypeId: catalog.blood,
        resultType: "numeric",
        unit: "%",
        decimalPlaces: 1,
      }).expect(201)
    ).body.id;

    await post(`/tests/${catalog.fbs}/reference-ranges`, pathologist, { low: 3.9, high: 5.5, criticalLow: 2.2, criticalHigh: 22.2 }).expect(201);
    await post(`/tests/${catalog.k}/reference-ranges`, pathologist, { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 }).expect(201);
    // Sex-specific range beats the any-sex one; overlapping ranges are refused.
    await post(`/tests/${catalog.hba1c}/reference-ranges`, pathologist, { high: 5.6 }).expect(201);
    await post(`/tests/${catalog.hba1c}/reference-ranges`, pathologist, { sex: "male", high: 5.7 }).expect(201);
    await post(`/tests/${catalog.hba1c}/reference-ranges`, pathologist, { sex: "male", ageMinDays: 0, ageMaxDays: 6570, high: 5.5 })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("range_overlap"));
    await post(`/tests/${catalog.hbsag}/reference-ranges`, pathologist, { low: 1 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("range_not_numeric"));

    catalog.panel = (
      await post("/panels", pathologist, { code: "renal-lite", name: "Glucose and potassium", testIds: [catalog.fbs, catalog.k] }).expect(201)
    ).body.id;
    const tests = await get("/tests", doctor).expect(200);
    expect(tests.body.find((t: { code: string }) => t.code === "hba1c").referenceRanges).toHaveLength(2);
  });

  it("replaces a reference range without rewriting history", async () => {
    const replaced = await post(`/tests/${catalog.k}/reference-ranges`, pathologist, { low: 3.5, high: 5.0, criticalLow: 2.5, criticalHigh: 6.5 }).expect(201);
    const history = await get(`/tests/${catalog.k}`, doctor).expect(200);
    expect(history.body.referenceRanges).toHaveLength(2);
    expect(history.body.referenceRanges.filter((r: { effectiveTo: string | null }) => r.effectiveTo === null)).toEqual([
      expect.objectContaining({ id: replaced.body.id, high: 5 }),
    ]);
    await expect(ctx.pool.query(`UPDATE lab_reference_range SET high = 9 WHERE id = $1`, [replaced.body.id])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`DELETE FROM lab_reference_range WHERE id = $1`, [replaced.body.id])).rejects.toThrow(/cannot be deleted/);
  });

  it("orders tests from an open encounter, expanding the panel and noting fasting", async () => {
    await post("/orders", nurse, { patientId, encounterId, testIds: [catalog.hbsag] }).expect(403);
    const order = await ctx
      .http()
      .post("/api/v1/laboratory/orders")
      .set({ ...at(doctor), "idempotency-key": "lab-order-1" })
      .send({ patientId, encounterId, panelIds: [catalog.panel], testIds: [catalog.hbsag, catalog.fbs], priority: "stat", clinicalIndication: "Weakness" })
      .expect(201);
    orderId = order.body.id;
    expect(order.body).toMatchObject({
      orderNumber: "LO00000001",
      source: "clinic",
      priority: "stat",
      fastingRequired: true,
      status: "active",
      orderingPractitionerName: "Dr. santos",
      patient: { patientNumber: expect.any(String), displayName: expect.stringMatching(/DELA CRUZ/i) },
    });
    expect(order.body.items.map((i: { testCode: string }) => i.testCode).sort()).toEqual(["fbs", "hbsag", "potassium"]);
    items = Object.fromEntries(order.body.items.map((i: { testCode: string; id: string }) => [i.testCode, i.id]));
    expect(order.body.items.every((i: { status: string }) => i.status === "pending_collection")).toBe(true);

    // The same idempotency key replays the order instead of creating another.
    const replay = await ctx
      .http()
      .post("/api/v1/laboratory/orders")
      .set({ ...at(doctor), "idempotency-key": "lab-order-1" })
      .send({ patientId, encounterId, panelIds: [catalog.panel], testIds: [catalog.hbsag, catalog.fbs], priority: "stat", clinicalIndication: "Weakness" });
    expect(replay.body.id).toBe(orderId);

    const listed = await ctx.http().get(`/api/v1/laboratory/orders?patientId=${patientId}`).set(as(doctor)).expect(200);
    expect(listed.body).toHaveLength(1);
  });

  it("collects a specimen, assigns an accession number, and shows it on the worklists", async () => {
    const pending = await get("/worklist?stage=collect", medtech).expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].items).toHaveLength(3);

    await post(`/orders/${orderId}/specimens`, medtech, { specimenTypeId: catalog.blood, itemIds: [items.fbs] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("specimen_type_mismatch"));
    const collected = await post(`/orders/${orderId}/specimens`, medtech, {
      specimenTypeId: catalog.serum,
      itemIds: [items.fbs, items.potassium, items.hbsag],
    }).expect(201);
    expect(collected.body.specimens).toHaveLength(1);
    specimenId = collected.body.specimens[0].id;
    accession = collected.body.specimens[0].accessionNumber;
    expect(accession).toMatch(/^\d{6}0001$/);
    expect(collected.body.specimens[0].collectedByName).toBe("medtech@example.ph");
    await post(`/orders/${orderId}/specimens`, medtech, { specimenTypeId: catalog.serum, itemIds: [items.fbs] }).expect(409);

    const scanned = await get(`/specimens/by-accession/${accession}`, medtech).expect(200);
    expect(scanned.body.order.id).toBe(orderId);
    await ctx.http().get(`/api/v1/laboratory/specimens/by-accession/${accession}`).set(as(medtech, tenant.otherFacilityId)).expect(403);

    await post(`/order-items/${items.fbs}/results`, medtech, { valueNumeric: 5 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("specimen_not_received"));
    const receive = await get("/worklist?stage=receive", medtech).expect(200);
    expect(receive.body[0].specimen.accessionNumber).toBe(accession);
    await post(`/specimens/${specimenId}/receive`, medtech).expect(200);
    await post(`/specimens/${specimenId}/receive`, medtech).expect(409);
    const enter = await get("/worklist?stage=enter", medtech).expect(200);
    expect(enter.body[0].items).toHaveLength(3);
  });

  it("enters results, snapshotting and flagging against the reference range", async () => {
    await post(`/order-items/${items.fbs}/results`, doctor, { valueNumeric: 5 }).expect(403);
    await post(`/order-items/${items.fbs}/results`, medtech, { valueNumeric: 5.55 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_result_value"));
    const fbs = await post(`/order-items/${items.fbs}/results`, medtech, { valueNumeric: 7.2, comment: "Non-fasting per patient" }).expect(201);
    expect(fbs.body).toMatchObject({ status: "entered", versionNumber: 1, flag: "high", critical: false, refLow: 3.9, refHigh: 5.5, unit: "mmol/L" });
    results.fbs = fbs.body.id;
    const k = await post(`/order-items/${items.potassium}/results`, medtech, { valueNumeric: 6.8 }).expect(201);
    expect(k.body).toMatchObject({ flag: "critical_high", critical: true, refHigh: 5 });
    results.k = k.body.id;
    await post(`/order-items/${items.hbsag}/results`, medtech, { valueCoded: "Positive" }).expect(422);
    const hbsag = await post(`/order-items/${items.hbsag}/results`, medtech, { valueCoded: "Reactive" }).expect(201);
    expect(hbsag.body).toMatchObject({ flag: "abnormal", patientReleasable: false });
    results.hbsag = hbsag.body.id;
    await post(`/order-items/${items.fbs}/results`, medtech, { valueNumeric: 5 }).expect(409);

    // Values are immutable at the database level.
    await expect(ctx.pool.query(`UPDATE lab_result SET value_numeric = 5 WHERE id = $1`, [results.fbs])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`UPDATE lab_result SET status = 'released' WHERE id = $1`, [results.fbs])).rejects.toThrow(/cannot move/);
    await expect(ctx.pool.query(`DELETE FROM lab_result WHERE id = $1`, [results.fbs])).rejects.toThrow(/cannot be deleted/);
  });

  it("does not show unreleased results to clinicians", async () => {
    const order = await ctx.http().get(`/api/v1/laboratory/orders/${orderId}`).set(as(doctor)).expect(200);
    expect(order.body.items.every((i: { result: unknown }) => i.result === null)).toBe(true);
    const lab = await get(`/orders/${orderId}`, medtech).expect(200);
    expect(lab.body.items.every((i: { result: unknown }) => i.result !== null)).toBe(true);
  });

  it("enforces separation of duties unless the facility policy allows self-verification", async () => {
    await post(`/results/${results.fbs}/verify`, medtech)
      .expect(403)
      .expect((r) => expect(r.body.error.message).toMatch(/separation of duties/));
    await post(`/results/${results.fbs}/approve`, pathologist)
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("invalid_result_status"));

    const verified = await post(`/results/${results.fbs}/verify`, medtech2).expect(200);
    expect(verified.body).toMatchObject({ status: "verified", selfVerified: false, verifiedByName: "medtech2@example.ph" });

    await ctx
      .http()
      .put("/api/v1/laboratory/policy")
      .set(at(medtech))
      .send({ allowSelfVerification: true, allowSelfApproval: false, releaseOnApproval: false, reason: "x" })
      .expect(403);
    await ctx
      .http()
      .put("/api/v1/laboratory/policy")
      .set(at(pathologist))
      .send({ allowSelfVerification: true, allowSelfApproval: false, releaseOnApproval: false, reason: "Single medtech on night shift" })
      .expect(200);
    const self = await post(`/results/${results.hbsag}/verify`, medtech).expect(200);
    expect(self.body).toMatchObject({ status: "verified", selfVerified: true });
    const policyAudit = await auditRows(ctx.pool, "action = 'lab.policy.update'");
    expect(policyAudit[0]).toMatchObject({ reason: "Single medtech on night shift" });
  });

  it("raises a critical result on verification and tracks communication and acknowledgement", async () => {
    await post(`/results/${results.k}/verify`, medtech2).expect(200);
    const open = await get("/critical-results", medtech).expect(200);
    expect(open.body).toHaveLength(1);
    expect(open.body[0]).toMatchObject({ status: "open", testName: "Potassium", orderingPractitionerName: "Dr. santos" });
    alertId = open.body[0].id;

    await post(`/critical-results/${alertId}/communicate`, doctor, { communicatedTo: "Dr. Santos", method: "phone", readBackConfirmed: true }).expect(403);
    const told = await post(`/critical-results/${alertId}/communicate`, medtech, {
      communicatedTo: "Dr. Santos (attending)",
      method: "phone",
      readBackConfirmed: true,
    }).expect(200);
    expect(told.body).toMatchObject({ status: "communicated", readBackConfirmed: true, communicatedByName: "medtech@example.ph" });
    const acknowledged = await post(`/critical-results/${alertId}/acknowledge`, doctor).expect(200);
    expect(acknowledged.body).toMatchObject({ status: "acknowledged", acknowledgedByName: "santos@example.ph" });
    expect((await get("/critical-results", medtech).expect(200)).body).toHaveLength(0);
  });

  it("approves and releases; clinicians then see released results and the order completes", async () => {
    for (const id of [results.fbs, results.k, results.hbsag]) await post(`/results/${id}/approve`, pathologist).expect(200);
    await post(`/results/${results.fbs}/release`, medtech).expect(403);
    const released = await post(`/orders/${orderId}/release`, pathologist).expect(200);
    expect(released.body).toHaveLength(3);
    expect(released.body.every((r: { status: string }) => r.status === "released")).toBe(true);

    const order = await ctx.http().get(`/api/v1/laboratory/orders/${orderId}`).set(as(doctor)).expect(200);
    expect(order.body.status).toBe("completed");
    expect(order.body.items.find((i: { testCode: string }) => i.testCode === "fbs").result).toMatchObject({ valueNumeric: 7.2, flag: "high" });

    await drainEvents(ctx);
    const events = await ctx.pool.query<{ event_type: string }>(`SELECT event_type FROM domain_event WHERE aggregate_type LIKE 'lab_%' ORDER BY occurred_at`);
    expect(events.rows.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([
        "LaboratoryOrderCreated",
        "SpecimenCollected",
        "SpecimenReceived",
        "LaboratoryResultEntered",
        "LaboratoryResultVerified",
        "CriticalResultRaised",
        "CriticalResultAcknowledged",
        "LaboratoryResultApproved",
        "LaboratoryResultReleased",
        "LaboratoryOrderCompleted",
      ]),
    );
    const payloads = await ctx.pool.query(`SELECT payload::text AS p FROM domain_event WHERE aggregate_type LIKE 'lab_%'`);
    expect(payloads.rows.map((r) => r.p).join(" ")).not.toMatch(/7\.2|Reactive|Weakness/);
  });

  it("corrects a released result as a new version; the old one stays readable", async () => {
    await post(`/results/${results.fbs}/cancel`, medtech, { reason: "Wrong" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("result_not_cancellable"));
    // Correcting a released result needs lab.result.amend (pathologist), not just lab.result.enter.
    await post(`/results/${results.fbs}/correct`, medtech, { valueNumeric: 6.2, reason: "Transcription error" }).expect(403);
    const corrected = await post(`/results/${results.fbs}/correct`, pathologist, { valueNumeric: 6.2, reason: "Transcription error" }).expect(201);
    expect(corrected.body).toMatchObject({ versionNumber: 2, status: "entered", supersedesResultId: results.fbs, correctionReason: "Transcription error" });

    const reopened = await ctx.http().get(`/api/v1/laboratory/orders/${orderId}`).set(as(doctor)).expect(200);
    expect(reopened.body.status).toBe("active");

    await post(`/results/${corrected.body.id}/verify`, medtech2).expect(200);
    // The pathologist entered the correction, so another authorized person approves it.
    await post(`/results/${corrected.body.id}/approve`, pathologist).expect(403);
    await post(`/results/${corrected.body.id}/approve`, admin).expect(200);
    await post(`/results/${corrected.body.id}/release`, pathologist).expect(200);

    const history = await ctx.http().get(`/api/v1/laboratory/order-items/${items.fbs}/results`).set(as(doctor)).expect(200);
    expect(history.body.map((r: { versionNumber: number; status: string; valueNumeric: number }) => [r.versionNumber, r.status, r.valueNumeric])).toEqual([
      [2, "released", 6.2],
      [1, "superseded", 7.2],
    ]);
    const amended = await ctx.pool.query(`SELECT 1 FROM domain_event WHERE event_type = 'LaboratoryResultAmended'`);
    expect(amended.rowCount).toBe(1);

    // The ordering practitioner is told in the app about the critical value and the correction — no values in the message.
    await drainEvents(ctx);
    await drainEvents(ctx);
    const inbox = await ctx.http().get("/api/v1/me/notifications").set(as(doctor)).expect(200);
    const notices = inbox.body.filter((n: { templateKey: string }) => n.templateKey === "lab.result-notice");
    expect(notices.map((n: { subject: string }) => n.subject).sort()).toEqual([expect.stringMatching(/^Corrected/), expect.stringMatching(/^Critical/)]);
    expect(JSON.stringify(notices)).not.toMatch(/6\.8|6\.2|7\.2|Potassium/);
  });

  it("lists a patient's released results and trends one analyte", async () => {
    const released = await ctx.http().get(`/api/v1/laboratory/patients/${patientId}/results`).set(as(doctor)).expect(200);
    expect(released.body.map((r: { testCode: string }) => r.testCode).sort()).toEqual(["fbs", "hbsag", "potassium"]);
    const trend = await ctx.http().get(`/api/v1/laboratory/patients/${patientId}/trends?testId=${catalog.fbs}`).set(as(doctor)).expect(200);
    expect(trend.body).toMatchObject({ analyte: "loinc:1558-6", unit: "mmol/L" });
    expect(trend.body.points).toEqual([expect.objectContaining({ valueNumeric: 6.2, corrected: true, refHigh: 5.5 })]);
    // Facility-scoped laboratory staff read results at their facility.
    await get(`/patients/${patientId}/results`, medtech2).expect(200);
    const audit = await auditRows(ctx.pool, "action IN ('lab.result.list', 'lab.result.trend') AND patient_id = $1", [patientId]);
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a specimen and puts its tests back for recollection", async () => {
    const order = await post("/orders", doctor, { patientId, encounterId, testIds: [catalog.hba1c] }).expect(201);
    const item = order.body.items[0].id;
    const collected = await post(`/orders/${order.body.id}/specimens`, medtech, { specimenTypeId: catalog.blood, itemIds: [item] }).expect(201);
    const specimen = collected.body.specimens[0];
    expect(Number(specimen.accessionNumber)).toBe(Number(accession) + 1);
    await post(`/specimens/${specimen.id}/reject`, medtech, { reason: "Clotted" }).expect(200);
    const after = await get(`/orders/${order.body.id}`, medtech).expect(200);
    expect(after.body.items[0]).toMatchObject({ status: "pending_collection", specimenId: null });
    const events = await get(`/specimens/${specimen.id}/events`, medtech).expect(200);
    expect(events.body.map((e: { event: string }) => e.event)).toEqual(["collected", "rejected", "recollection_requested"]);

    await post(`/orders/${order.body.id}/cancel`, doctor, { reason: "Patient declined" }).expect(200);
    const cancelled = await get(`/orders/${order.body.id}`, doctor).expect(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled", cancellationReason: "Patient declined" });
  });

  it("takes external orders at the laboratory without an encounter", async () => {
    await post("/orders", medtech, { patientId, source: "external", testIds: [catalog.fbs] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("external_orderer_required"));
    const external = await post("/orders", medtech, { patientId, source: "external", externalOrderer: "Dr. Reyes, St. Luke's", testIds: [catalog.fbs] }).expect(
      201,
    );
    expect(external.body).toMatchObject({ source: "external", orderingPractitionerId: null, externalOrderer: "Dr. Reyes, St. Luke's" });
    const dashboard = await get("/dashboard", medtech).expect(200);
    // Current released results (the superseded first version no longer counts).
    expect(dashboard.body).toMatchObject({ pendingCollection: 1, releasedToday: 3, criticalUnacknowledged: 0 });
  });
});
