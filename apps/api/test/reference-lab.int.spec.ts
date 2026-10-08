import { Test, type TestingModule } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import {
  type ExchangeOutcome,
  INTEGRATION_QUEUE,
  IntegrationExchangeProcessor,
  IntegrationWorkerModule,
  REFERENCE_LAB_GATEWAY,
  type ReferenceLabGateway,
  type ReferenceLabSendOutPackage,
} from "@healthcare/interoperability";
import { extractPdfText } from "@healthcare/pdf";
import {
  as,
  auditRows,
  binary,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  type Tenant,
  type TestContext,
  underPlatform,
} from "./harness";

/** A test double standing in for a reference laboratory adapter (none exists: no laboratory's interface is on record). */
class FakeReferenceLabGateway implements ReferenceLabGateway {
  readonly specification = { system: "reference-laboratory", name: "Test double", status: "implemented" as const, specificationVersion: "test", note: "test" };
  readonly received: Array<{ pkg: ReferenceLabSendOutPackage; key: string }> = [];
  next: ExchangeOutcome[] = [];

  submitSendOut(pkg: ReferenceLabSendOutPackage, idempotencyKey: string): Promise<ExchangeOutcome> {
    this.received.push({ pkg, key: idempotencyKey });
    return Promise.resolve(this.next.shift() ?? { outcome: "accepted", externalReference: `REF-${this.received.length}` });
  }
}

interface Setup {
  tenant: Tenant;
  admin: string;
  doctor: string;
  nurse: string;
  medtech: string;
  medtech2: string;
  pathologist: string;
  patientId: string;
  encounterId: string;
  catalog: { chem: string; serum: string; tsh: string; fbs: string };
  referenceLabId: string;
  lab: (token: string) => {
    get: (path: string) => import("supertest").Test;
    post: (path: string, body?: object) => import("supertest").Test;
    put: (path: string, body?: object) => import("supertest").Test;
    patch: (path: string, body?: object) => import("supertest").Test;
  };
  /** Orders the tests from the open encounter, collects one serum specimen and receives it. Returns ids. */
  receivedOrder: (tests: string[]) => Promise<{ orderId: string; items: Record<string, string>; specimenId: string; accession: string }>;
}

async function setup(ctx: TestContext, code: string): Promise<Setup> {
  const tenant = await createTenant(ctx.pool, code);
  await createStaff(ctx.pool, tenant, `admin@${code}.ph`, ["org_admin"]);
  const { practitionerId } = await createClinician(ctx, tenant, `santos@${code}.ph`, ["physician"]);
  await createStaff(ctx.pool, tenant, `nurse@${code}.ph`, ["nurse"]);
  await createStaff(ctx.pool, tenant, `medtech@${code}.ph`, [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
  await createStaff(ctx.pool, tenant, `medtech2@${code}.ph`, [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
  await createStaff(ctx.pool, tenant, `patho@${code}.ph`, ["pathologist"]);
  const token = async (who: string) => (await login(ctx, `${who}@${code}.ph`)).accessToken;
  const s = {
    tenant,
    admin: await token("admin"),
    doctor: await token("santos"),
    nurse: await token("nurse"),
    medtech: await token("medtech"),
    medtech2: await token("medtech2"),
    pathologist: await token("patho"),
  };
  const lab = (t: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set(as(t, tenant.facilityId)),
    post: (path: string, body: object = {}) => ctx.http().post(`/api/v1${path}`).set(as(t, tenant.facilityId)).send(body),
    put: (path: string, body: object = {}) => ctx.http().put(`/api/v1${path}`).set(as(t, tenant.facilityId)).send(body),
    patch: (path: string, body: object = {}) => ctx.http().patch(`/api/v1${path}`).set(as(t, tenant.facilityId)).send(body),
  });
  const patientId = (await lab(s.admin).post("/patients", juan).expect(201)).body.id;
  const encounter = await ctx.pool.query<{ id: string }>(
    `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by)
     SELECT $1, $2, $3, $4, user_id FROM practitioner WHERE id = $4 RETURNING id`,
    [tenant.organizationId, tenant.facilityId, patientId, practitionerId],
  );
  const chem = (await lab(s.pathologist).post("/laboratory/departments", { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
  const serum = (await lab(s.pathologist).post("/laboratory/specimen-types", { code: "serum", name: "Serum", container: "Red-top tube" }).expect(201)).body.id;
  const numeric = { departmentId: chem, specimenTypeId: serum, resultType: "numeric", decimalPlaces: 2 };
  const tsh = (
    await lab(s.pathologist)
      .post("/laboratory/tests", { ...numeric, code: "tsh", name: "Thyroid stimulating hormone", unit: "mIU/L", turnaroundMinutes: 240 })
      .expect(201)
  ).body.id;
  const fbs = (
    await lab(s.pathologist)
      .post("/laboratory/tests", { ...numeric, code: "fbs", name: "Fasting blood sugar", unit: "mmol/L" })
      .expect(201)
  ).body.id;
  await lab(s.pathologist).post(`/laboratory/tests/${tsh}/reference-ranges`, { low: 0.4, high: 4.0 }).expect(201);

  const receivedOrder = async (tests: string[]) => {
    const order = await lab(s.doctor).post("/laboratory/orders", { patientId, encounterId: encounter.rows[0]!.id, testIds: tests }).expect(201);
    const items = Object.fromEntries(order.body.items.map((i: { testCode: string; id: string }) => [i.testCode, i.id])) as Record<string, string>;
    const collected = await lab(s.medtech)
      .post(`/laboratory/orders/${order.body.id}/specimens`, { specimenTypeId: serum, itemIds: Object.values(items) })
      .expect(201);
    const specimen = collected.body.specimens.at(-1) as { id: string; accessionNumber: string };
    await lab(s.medtech).post(`/laboratory/specimens/${specimen.id}/receive`).expect(200);
    return { orderId: order.body.id as string, items, specimenId: specimen.id, accession: specimen.accessionNumber };
  };

  return { ...s, patientId, encounterId: encounter.rows[0]!.id, catalog: { chem, serum, tsh, fbs }, referenceLabId: "", lab, receivedOrder };
}

/**
 * Send-out tests (Phase 8, external systems): configuration → order → collection → receipt → send-out prepared →
 * dispatch with a manifest → results back → entry attributed to the reference laboratory → verify / approve / release →
 * correction. The electronic interface is an integration dependency: submissions are refused.
 */
describe("send-out tests to a reference laboratory", () => {
  let ctx: TestContext;
  let s: Setup;
  let first: Awaited<ReturnType<Setup["receivedOrder"]>>;
  let sendOutId: string;
  let dispatchId: string;
  let manifestNumber: string;
  let resultId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await setup(ctx, "refl");
  });
  afterAll(() => ctx.close());

  it("configures reference laboratories (lab.catalog.manage, audited; accreditation as recorded)", async () => {
    const body = { code: "metro-ref", name: "Metro Reference Laboratory", accreditationReference: "DOH-LIC-TEST-001", phone: "02 8123 4567" };
    await s.lab(s.medtech).post("/laboratory/reference-labs", body).expect(403);
    const created = await s.lab(s.pathologist).post("/laboratory/reference-labs", body).expect(201);
    s.referenceLabId = created.body.id;
    expect(created.body).toMatchObject({ code: "metro-ref", status: "active", accreditationReference: "DOH-LIC-TEST-001", version: 1 });
    expect(created.body).not.toHaveProperty("organizationId");
    await s.lab(s.pathologist).post("/laboratory/reference-labs", body).expect(409);
    await s.lab(s.pathologist).patch(`/laboratory/reference-labs/${s.referenceLabId}`, { contactName: "Receiving desk", version: 2 }).expect(409);
    const updated = await s
      .lab(s.pathologist)
      .patch(`/laboratory/reference-labs/${s.referenceLabId}`, { contactName: "Receiving desk", version: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ contactName: "Receiving desk", version: 2 });
    const listed = await s.lab(s.doctor).get("/laboratory/reference-labs").expect(200);
    expect(listed.body.map((l: { id: string }) => l.id)).toEqual([s.referenceLabId]);
    const audit = await auditRows(ctx.pool, "action LIKE 'lab.reference-lab.%'");
    expect(audit.map((a) => a.action)).toEqual(["lab.reference-lab.create", "lab.reference-lab.update"]);
  });

  it("refers a test out from the selected facility", async () => {
    await s.lab(s.medtech).put(`/laboratory/referrals/${s.catalog.tsh}`, { referenceLaboratoryId: s.referenceLabId }).expect(403);
    await s
      .lab(s.pathologist)
      .put(`/laboratory/referrals/${s.catalog.tsh}`, { referenceLaboratoryId: s.referenceLabId, turnaroundMinutes: 2 * 24 * 60 })
      .expect(200);
    const referrals = await s.lab(s.medtech).get("/laboratory/referrals").expect(200);
    expect(referrals.body).toEqual([
      expect.objectContaining({
        testId: s.catalog.tsh,
        testCode: "tsh",
        referenceLaboratoryId: s.referenceLabId,
        turnaroundMinutes: 2880,
        referenceLaboratoryName: "Metro Reference Laboratory",
      }),
    ]);
    // The other facility performs everything itself.
    const annex = await ctx.http().get("/api/v1/laboratory/referrals").set(as(s.pathologist, s.tenant.otherFacilityId)).expect(200);
    expect(annex.body).toEqual([]);
    expect(await auditRows(ctx.pool, "action = 'lab.referral.set'")).toHaveLength(1);
  });

  it("prepares a send-out on receipt for referred tests only, and keeps them out of in-house result entry", async () => {
    first = await s.receivedOrder([s.catalog.tsh, s.catalog.fbs]);
    const toDispatch = await s.lab(s.medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200);
    expect(toDispatch.body).toHaveLength(1);
    expect(toDispatch.body[0]).toMatchObject({
      status: "prepared",
      testCode: "tsh",
      accessionNumber: first.accession,
      referenceLaboratoryName: "Metro Reference Laboratory",
      turnaroundMinutes: 2880,
      patient: { patientNumber: expect.any(String) },
      dueAt: null,
    });
    sendOutId = toDispatch.body[0].id;

    const enter = await s.lab(s.medtech).get("/laboratory/worklist?stage=enter").expect(200);
    expect(enter.body.flatMap((r: { items: Array<{ testCode: string }> }) => r.items.map((i) => i.testCode))).toEqual(["fbs"]);
    const refused = await s.lab(s.medtech).post(`/laboratory/order-items/${first.items.tsh}/results`, { valueNumeric: 2.1 }).expect(422);
    expect(refused.body.error.code).toBe("awaiting_reference_laboratory");

    const order = await s.lab(s.doctor).get(`/laboratory/orders/${first.orderId}`).expect(200);
    const tshItem = order.body.items.find((i: { testCode: string }) => i.testCode === "tsh");
    expect(tshItem.sendOut).toMatchObject({ status: "prepared", referenceLaboratoryName: "Metro Reference Laboratory" });
    expect(order.body.items.find((i: { testCode: string }) => i.testCode === "fbs").sendOut).toBeNull();

    const audit = await auditRows(ctx.pool, "action = 'lab.send-out.prepare'");
    expect(audit).toEqual([
      expect.objectContaining({ patient_id: s.patientId, metadata: expect.objectContaining({ orderId: first.orderId, testCode: "tsh" }) }),
    ]);
    const dashboard = await s.lab(s.medtech).get("/laboratory/dashboard").expect(200);
    expect(dashboard.body).toMatchObject({ awaitingEntry: 1, sendOutsToDispatch: 1, sendOutsAwaitingResults: 0 });
  });

  it("dispatches with a manifest (idempotent), logs the specimen as routed, and prints the manifest", async () => {
    await s
      .lab(s.nurse)
      .post("/laboratory/send-out-dispatches", { sendOutIds: [sendOutId], courier: "Lab rider" })
      .expect(403);
    const request = () =>
      ctx
        .http()
        .post("/api/v1/laboratory/send-out-dispatches")
        .set({ ...as(s.medtech, s.tenant.facilityId), "idempotency-key": "dispatch-refl-1" })
        .send({ sendOutIds: [sendOutId], courier: "Lab rider", courierReference: "WB-0001" });
    const dispatched = await request().expect(201);
    dispatchId = dispatched.body.id;
    manifestNumber = dispatched.body.manifestNumber;
    expect(manifestNumber).toBe("SM00000001");
    expect(dispatched.body).toMatchObject({ courier: "Lab rider", courierReference: "WB-0001", referenceLaboratoryName: "Metro Reference Laboratory" });
    expect(dispatched.body.sendOuts).toEqual([
      expect.objectContaining({ id: sendOutId, status: "dispatched", manifestNumber, dueAt: expect.any(String), overdue: false }),
    ]);
    // Same key: the same dispatch; another key: the send-out is no longer prepared.
    expect((await request().expect(201)).body.id).toBe(dispatchId);
    const again = await s
      .lab(s.medtech)
      .post("/laboratory/send-out-dispatches", { sendOutIds: [sendOutId], courier: "Lab rider" })
      .expect(422);
    expect(again.body.error.code).toBe("send_out_not_prepared");

    const events = await s.lab(s.medtech).get(`/laboratory/specimens/${first.specimenId}/events`).expect(200);
    expect(events.body.map((e: { event: string }) => e.event)).toEqual(["collected", "received", "routed"]);
    expect(events.body[2].reason).toBe(`Sent to Metro Reference Laboratory (manifest ${manifestNumber})`);

    const pdf = await ctx
      .http()
      .get(`/api/v1/laboratory/send-out-dispatches/${dispatchId}/manifest.pdf`)
      .set(as(s.medtech, s.tenant.facilityId))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const text = extractPdfText(pdf.body as Buffer);
    expect(text).toContain("Send-out Manifest");
    expect(text).toContain(manifestNumber);
    expect(text).toContain(first.accession);
    expect(text).toContain("TSH");
    expect(text).toContain("DOH-LIC-TEST-001");
    // Minimal identification: no birth date, no indication.
    expect(text).not.toContain("1980");
    await ctx.http().get(`/api/v1/laboratory/send-out-dispatches/${dispatchId}/manifest.pdf`).set(as(s.nurse, s.tenant.facilityId)).expect(403);

    const awaiting = await s.lab(s.medtech).get("/laboratory/send-outs?view=awaiting").expect(200);
    expect(awaiting.body).toEqual([expect.objectContaining({ id: sendOutId, status: "dispatched", minutesOut: expect.any(Number), overdue: false })]);
    const dashboard = await s.lab(s.medtech).get("/laboratory/dashboard").expect(200);
    expect(dashboard.body).toMatchObject({ sendOutsToDispatch: 0, sendOutsAwaitingResults: 1, sendOutsOverdue: 0 });
    const audit = await auditRows(ctx.pool, "action IN ('lab.send-out.dispatch', 'lab.send-out.manifest-print')");
    expect(audit.map((a) => [a.action, a.patient_id])).toEqual([
      ["lab.send-out.dispatch", s.patientId],
      ["lab.send-out.manifest-print", s.patientId],
    ]);
  });

  it("refuses an electronic submission while the reference laboratory interface is an integration dependency", async () => {
    const status = await s.lab(s.medtech).get(`/integrations/reference-laboratories/dispatches/${dispatchId}/submissions`).expect(200);
    expect(status.body).toMatchObject({ integration: { status: "dependency" }, ready: true, submissions: [] });
    const refused = await s
      .lab(s.medtech)
      .post(`/integrations/reference-laboratories/dispatches/${dispatchId}/submissions`, { idempotencyKey: "submit-refl-1" })
      .expect(422);
    expect(refused.body.error.code).toBe("integration_not_configured");
    await s.lab(s.nurse).post(`/integrations/reference-laboratories/dispatches/${dispatchId}/submissions`, { idempotencyKey: "submit-refl-2" }).expect(403);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM integration_exchange`);
    expect(rows[0].n).toBe(0);
  });

  it("records the results back and enters them as the reference laboratory's, through verify / approve / release", async () => {
    await s.lab(s.medtech).post(`/laboratory/send-outs/${sendOutId}/results-received`, {}).expect(400);
    const back = await s.lab(s.medtech).post(`/laboratory/send-outs/${sendOutId}/results-received`, { referenceAccession: "MRL-26-0001" }).expect(200);
    expect(back.body).toMatchObject({ status: "results_received", referenceAccession: "MRL-26-0001", resultsReceivedByName: expect.any(String) });
    const twice = await s.lab(s.medtech).post(`/laboratory/send-outs/${sendOutId}/results-received`, { referenceAccession: "MRL-26-0001" }).expect(409);
    expect(twice.body.error.code).toBe("send_out_state");

    const entered = await s
      .lab(s.medtech)
      .post(`/laboratory/order-items/${first.items.tsh}/results`, { valueNumeric: 5.2, comment: "As reported" })
      .expect(201);
    resultId = entered.body.id;
    expect(entered.body).toMatchObject({
      status: "entered",
      flag: "high",
      performingLaboratory: "Metro Reference Laboratory",
      referenceLaboratoryId: s.referenceLabId,
      sendOutId,
    });
    // The same rules as in-house results: separation of duties, sign-offs by permission.
    await s.lab(s.medtech).post(`/laboratory/results/${resultId}/verify`).expect(403);
    await s.lab(s.medtech2).post(`/laboratory/results/${resultId}/verify`).expect(200);
    await s.lab(s.medtech2).post(`/laboratory/results/${resultId}/approve`).expect(403);
    await s.lab(s.pathologist).post(`/laboratory/results/${resultId}/approve`).expect(200);
    const released = await s.lab(s.pathologist).post(`/laboratory/results/${resultId}/release`).expect(200);
    expect(released.body).toMatchObject({ status: "released", performingLaboratory: "Metro Reference Laboratory" });

    const results = await s.lab(s.doctor).get(`/laboratory/patients/${s.patientId}/results`).expect(200);
    expect(results.body).toEqual([expect.objectContaining({ testCode: "tsh", performingLaboratory: "Metro Reference Laboratory" })]);
    const report = await ctx.http().get(`/api/v1/laboratory/orders/${first.orderId}/report.pdf`).set(as(s.doctor)).buffer(true).parse(binary).expect(200);
    const text = extractPdfText(report.body as Buffer);
    expect(text).toContain("Performed by Metro Reference Laboratory (reference laboratory): Thyroid stimulating hormone");

    const audit = await auditRows(ctx.pool, "action IN ('lab.send-out.results-received', 'lab.result.enter')");
    expect(audit).toEqual([
      expect.objectContaining({
        action: "lab.send-out.results-received",
        patient_id: s.patientId,
        metadata: expect.objectContaining({ orderId: first.orderId }),
      }),
      expect.objectContaining({ action: "lab.result.enter", metadata: expect.objectContaining({ referenceLaboratoryId: s.referenceLabId, sendOutId }) }),
    ]);
    const events = await ctx.pool.query(`SELECT event_type AS type, payload FROM domain_event WHERE aggregate_type = 'lab_send_out' ORDER BY position`);
    expect(events.rows.map((e) => e.type)).toEqual(["LaboratorySendOutPrepared", "LaboratorySendOutDispatched", "LaboratorySendOutResultsReceived"]);
    // Ids only: no test names, values or references in the payloads.
    expect(JSON.stringify(events.rows.map((e) => e.payload))).not.toMatch(/Thyroid|MRL-26|5\.2/);
  });

  it("corrects a released reference result by a new version that keeps the attribution; history is never overwritten", async () => {
    const corrected = await s
      .lab(s.pathologist)
      .post(`/laboratory/results/${resultId}/correct`, { valueNumeric: 3.9, reason: "Amended report from the reference laboratory" })
      .expect(201);
    expect(corrected.body).toMatchObject({ versionNumber: 2, performingLaboratory: "Metro Reference Laboratory", referenceLaboratoryId: s.referenceLabId });
    await s.lab(s.medtech2).post(`/laboratory/results/${corrected.body.id}/verify`).expect(200);
    await s.lab(s.pathologist).post(`/laboratory/results/${corrected.body.id}/approve`).expect(403); // the pathologist entered it
    await ctx.pool.query(
      `INSERT INTO lab_facility_policy (facility_id, organization_id, allow_self_approval, updated_by)
      SELECT $1, $2, true, id FROM app_user WHERE email = 'patho@refl.ph'`,
      [s.tenant.facilityId, s.tenant.organizationId],
    );
    await s.lab(s.pathologist).post(`/laboratory/results/${corrected.body.id}/approve`).expect(200);
    await s.lab(s.pathologist).post(`/laboratory/results/${corrected.body.id}/release`).expect(200);
    const history = await s.lab(s.doctor).get(`/laboratory/order-items/${first.items.tsh}/results`).expect(200);
    expect(
      history.body.map((r: { versionNumber: number; status: string; performingLaboratory: string }) => [r.versionNumber, r.status, r.performingLaboratory]),
    ).toEqual([
      [2, "released", "Metro Reference Laboratory"],
      [1, "superseded", "Metro Reference Laboratory"],
    ]);

    await expect(ctx.pool.query(`UPDATE lab_result SET performing_laboratory = 'Other' WHERE id = $1`, [resultId])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`UPDATE lab_send_out SET status = 'cancelled' WHERE id = $1`, [sendOutId])).rejects.toThrow(
      /cannot move from results_received/,
    );
    await expect(ctx.pool.query(`DELETE FROM lab_send_out WHERE id = $1`, [sendOutId])).rejects.toThrow(/not deleted/);
    await expect(ctx.pool.query(`UPDATE lab_send_out_dispatch SET courier = 'Other' WHERE id = $1`, [dispatchId])).rejects.toThrow(/cannot change/);
  });

  it("handles a rejection by the reference laboratory, a manual re-send, cancellation and in-house testing", async () => {
    const second = await s.receivedOrder([s.catalog.tsh]);
    const [prepared] = (await s.lab(s.medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200)).body;
    const dispatch = await s
      .lab(s.medtech)
      .post("/laboratory/send-out-dispatches", { sendOutIds: [prepared.id], courier: "Courier Co." })
      .expect(201);
    expect(dispatch.body.manifestNumber).toBe("SM00000002");
    await s.lab(s.nurse).post(`/laboratory/send-outs/${prepared.id}/reject`, { reason: "Haemolysed on arrival" }).expect(403);
    const rejected = await s
      .lab(s.medtech)
      .post(`/laboratory/send-outs/${prepared.id}/reject`, { reason: "Haemolysed on arrival", referenceAccession: "MRL-26-0002" })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: "rejected", rejectionReason: "Haemolysed on arrival" });
    expect((await auditRows(ctx.pool, "action = 'lab.send-out.reference-rejected'"))[0]).toMatchObject({
      reason: "Haemolysed on arrival",
      patient_id: s.patientId,
    });

    // Sent again by hand (a second aliquot); then cancelled to test in-house.
    await s
      .lab(s.medtech)
      .post("/laboratory/send-outs", { orderItemIds: [second.items.tsh], referenceLaboratoryId: s.referenceLabId })
      .expect(201);
    const inFlight = await s
      .lab(s.medtech)
      .post("/laboratory/send-outs", { orderItemIds: [second.items.tsh], referenceLaboratoryId: s.referenceLabId })
      .expect(409);
    expect(inFlight.body.error.code).toBe("send_out_in_flight");
    const [resend] = (await s.lab(s.medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200)).body;
    await s.lab(s.medtech).post(`/laboratory/send-outs/${resend.id}/cancel`, { reason: "x" }).expect(400);
    await s.lab(s.medtech).post(`/laboratory/send-outs/${resend.id}/cancel`, { reason: "Analyser available in-house" }).expect(200);
    const inHouse = await s.lab(s.medtech).post(`/laboratory/order-items/${second.items.tsh}/results`, { valueNumeric: 1.5 }).expect(201);
    expect(inHouse.body).toMatchObject({ performingLaboratory: null, referenceLaboratoryId: null });
    const closed = await s.lab(s.medtech).get("/laboratory/send-outs?view=closed").expect(200);
    expect(closed.body.map((r: { status: string }) => r.status).sort()).toEqual(["cancelled", "rejected", "results_received"]);
  });

  it("cancels a pending send-out with its test, and refuses tests that are not received", async () => {
    const third = await s.receivedOrder([s.catalog.tsh, s.catalog.fbs]);
    const [pending] = (await s.lab(s.medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200)).body;
    await s.lab(s.doctor).post(`/laboratory/orders/${third.orderId}/items/${third.items.tsh}/cancel`, { reason: "Not needed after all" }).expect(200);
    const all = await s.lab(s.medtech).get("/laboratory/send-outs?view=all").expect(200);
    expect(all.body.find((r: { id: string }) => r.id === pending.id)).toMatchObject({ status: "cancelled", cancellationReason: "Not needed after all" });
    const refused = await s
      .lab(s.medtech)
      .post("/laboratory/send-outs", { orderItemIds: [third.items.tsh], referenceLaboratoryId: s.referenceLabId })
      .expect(422);
    expect(refused.body.error.code).toBe("item_not_received");
    // Other facility: its laboratory cannot handle this facility's send-outs.
    const fbsOut = await s
      .lab(s.medtech)
      .post("/laboratory/send-outs", { orderItemIds: [third.items.fbs], referenceLaboratoryId: s.referenceLabId })
      .expect(201);
    const annex = await ctx
      .http()
      .post(`/api/v1/laboratory/send-outs/${fbsOut.body[0].id}/cancel`)
      .set(as(s.admin, s.tenant.otherFacilityId))
      .send({ reason: "Wrong place" })
      .expect(422);
    expect(annex.body.error.code).toBe("wrong_facility");
  });
});

describe("send-out tests — electronic submission through an adapter (test double) and the integration worker", () => {
  let ctx: TestContext;
  let s: Setup;
  let worker: TestingModule;
  let processor: IntegrationExchangeProcessor;
  const gateway = new FakeReferenceLabGateway();

  beforeAll(async () => {
    const referenceLabGateway = { provide: REFERENCE_LAB_GATEWAY, useValue: gateway };
    ctx = await createTestApp({ referenceLabGateway });
    worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        IntegrationWorkerModule.forRoot({ autoStart: false, referenceLabGateway, queue: { provide: INTEGRATION_QUEUE, useValue: ctx.integrations } }),
      ],
    }).compile();
    processor = underPlatform(worker.get(IntegrationExchangeProcessor));
    s = await setup(ctx, "refw");
    s.referenceLabId = (await s.lab(s.pathologist).post("/laboratory/reference-labs", { code: "ref", name: "Partner Reference Lab" }).expect(201)).body.id;
    await s.lab(s.pathologist).put(`/laboratory/referrals/${s.catalog.tsh}`, { referenceLaboratoryId: s.referenceLabId }).expect(200);
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it("queues the dispatch, sends it through the worker and records the acknowledgement on the dispatch", async () => {
    const order = await s.receivedOrder([s.catalog.tsh]);
    const [prepared] = (await s.lab(s.medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200)).body;
    const dispatch = await s
      .lab(s.medtech)
      .post("/laboratory/send-out-dispatches", { sendOutIds: [prepared.id], courier: "Rider" })
      .expect(201);
    const path = `/integrations/reference-laboratories/dispatches/${dispatch.body.id}/submissions`;

    const queued = await s.lab(s.medtech).post(path, { idempotencyKey: "send-out-attempt-1" }).expect(202);
    expect(queued.body).toMatchObject({ integration: { status: "implemented" }, submissions: [expect.objectContaining({ status: "queued" })] });
    // Same key: the same exchange; another key while one is queued: refused.
    await s.lab(s.medtech).post(path, { idempotencyKey: "send-out-attempt-1" }).expect(202);
    const again = await s.lab(s.medtech).post(path, { idempotencyKey: "send-out-attempt-2" }).expect(422);
    expect(again.body.error.code).toBe("already_submitted");

    await drainEvents(ctx);
    expect(ctx.integrations.enqueued).toHaveLength(1);
    // The job carries only the exchange id; the payload is sealed in the database, not in Redis.
    const sealed = await ctx.pool.query(`SELECT ciphertext FROM integration_exchange_payload`);
    expect(sealed.rows[0].ciphertext).not.toContain(order.accession);
    await expect(processor.process(ctx.integrations.enqueued[0]!)).resolves.toBe("accepted");
    expect(gateway.received).toHaveLength(1);
    expect(gateway.received[0]!.key).toBe("send-out-attempt-1");
    expect(gateway.received[0]!.pkg).toMatchObject({
      manifestNumber: dispatch.body.manifestNumber,
      courier: { name: "Rider" },
      referenceLaboratory: { code: "ref", name: "Partner Reference Lab" },
      specimens: [
        expect.objectContaining({
          accessionNumber: order.accession,
          patient: expect.objectContaining({ familyName: "Dela Cruz", birthDate: "1980-03-04" }),
          tests: [expect.objectContaining({ code: "tsh", sendOutId: prepared.id })],
        }),
      ],
    });
    expect(gateway.received[0]!.pkg.specimens[0]!.patient).not.toHaveProperty("philhealthPin");

    await drainEvents(ctx);
    const detail = await s.lab(s.medtech).get(`/laboratory/send-out-dispatches/${dispatch.body.id}`).expect(200);
    expect(detail.body).toMatchObject({ electronicReference: "REF-1", electronicAcknowledgedAt: expect.any(String) });
    // At-least-once outbox: a replayed outcome changes nothing.
    await drainEvents(ctx);
    const audit = await auditRows(
      ctx.pool,
      "action IN ('lab.send-out.submit-request', 'integration.exchange.completed', 'lab.send-out.electronic-acknowledged')",
    );
    expect(audit.map((a) => a.action)).toEqual(["lab.send-out.submit-request", "integration.exchange.completed", "lab.send-out.electronic-acknowledged"]);
    expect(audit[0]).toMatchObject({ patient_id: s.patientId });
    const status = await s.lab(s.medtech).get(path).expect(200);
    expect(status.body.submissions).toEqual([expect.objectContaining({ status: "accepted", externalReference: "REF-1" })]);
  });
});
