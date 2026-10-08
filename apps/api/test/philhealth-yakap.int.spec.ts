import { Test, type TestingModule } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import { type ExchangeOutcome, INTEGRATION_QUEUE, IntegrationExchangeProcessor, IntegrationWorkerModule } from "@healthcare/interoperability";
import type { PhilHealthYakapGateway, YakapEncounterPackage } from "@healthcare/philhealth";
import { PHILHEALTH_YAKAP_GATEWAY, philhealthExchangeHandlers } from "@healthcare/philhealth";
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
  underPlatform,
} from "./harness";

/** A test double standing in for a real YAKAP adapter (none exists: the specification is an integration dependency). */
class FakeYakapGateway implements PhilHealthYakapGateway {
  readonly specification = { system: "philhealth-yakap", name: "Test double", status: "implemented" as const, specificationVersion: "test", note: "test" };
  readonly received: Array<{ pkg: YakapEncounterPackage; key: string }> = [];
  next: ExchangeOutcome[] = [];

  submitEncounter(pkg: YakapEncounterPackage, key: string): Promise<ExchangeOutcome> {
    this.received.push({ pkg, key });
    return Promise.resolve(this.next.shift() ?? { outcome: "accepted", externalReference: `YK-TX-${this.received.length}` });
  }
}

type Req = {
  get: (url: string) => import("supertest").Test;
  post: (url: string, body?: object) => import("supertest").Test;
  put: (url: string, body?: object) => import("supertest").Test;
};

interface Setup {
  tenant: Tenant;
  admin: string;
  cashier: string;
  desk: string;
  nurse: string;
  doctor: string;
  patientId: string;
  encounterId: string;
  req: (token: string) => Req;
}

/** A signed consultation with an ICD-10 diagnosis, a prescription and a laboratory order. */
async function signedConsultation(ctx: TestContext, code: string): Promise<Setup> {
  const tenant = await createTenant(ctx.pool, code);
  await createStaff(ctx.pool, tenant, `admin@${code}.ph`, ["org_admin"]);
  await createClinician(ctx, tenant, `cruz@${code}.ph`, ["physician"]);
  await createStaff(ctx.pool, tenant, `cashier@${code}.ph`, ["cashier"]);
  await createStaff(ctx.pool, tenant, `desk@${code}.ph`, ["receptionist"]);
  await createStaff(ctx.pool, tenant, `nurse@${code}.ph`, ["nurse"]);
  const [admin, doctor, cashier, desk, nurse] = await Promise.all(
    ["admin", "cruz", "cashier", "desk", "nurse"].map(async (u) => (await login(ctx, `${u}@${code}.ph`)).accessToken),
  );
  const req = (token: string): Req => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  const visitTypeId = (
    await req(admin!).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
  ).body.id;
  await req(admin!).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
  const lab = (path: string, body: object) => req(admin!).post(`/laboratory${path}`, body).expect(201);
  const departmentId = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
  const specimenTypeId = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
  const testId = (await lab("/tests", { code: "hba1c", name: "HbA1c", departmentId, specimenTypeId, resultType: "numeric", unit: "%", loincCode: "4548-4" }))
    .body.id;
  const patientId = (await req(admin!).post("/patients", juan).expect(201)).body.id;

  const visit = await req(admin!).post("/queue/walk-ins", { patientId, visitTypeId }).expect(201);
  const encounterId = (await req(doctor!).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id;
  await req(doctor!)
    .post(`/encounters/${encounterId}/diagnoses`, { codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", rank: "primary" })
    .expect(201);
  await req(doctor!)
    .post("/prescriptions", {
      encounterId,
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
          instructions: "Take with meals",
        },
      ],
    })
    .expect(201);
  await req(doctor!)
    .post("/laboratory/orders", { patientId, encounterId, testIds: [testId] })
    .expect(201);
  await req(doctor!).put(`/encounters/${encounterId}/note`, { assessment: "Controlled", plan: "Continue", basedOnRevision: 0 }).expect(200);
  const current = await req(doctor!).get(`/encounters/${encounterId}`).expect(200);
  await req(doctor!).post(`/encounters/${encounterId}/sign`, { version: current.body.version }).expect(200);
  await drainEvents(ctx);
  return { tenant, admin: admin!, cashier: cashier!, desk: desk!, nurse: nurse!, doctor: doctor!, patientId, encounterId, req };
}

const failingCodes = (checks: Array<{ code: string; ok: boolean }>) => checks.filter((c) => !c.ok).map((c) => c.code);

/**
 * PhilHealth YAKAP adapter stubs (docs/interoperability/philhealth-yakap.md): the facility's participation reference,
 * PhilHealth's registration answers recorded as history, a format-neutral encounter package with readiness checks of
 * the platform's own data; nothing is transmitted while the specification is an integration dependency.
 */
describe("PhilHealth YAKAP — unconfigured (default)", () => {
  let ctx: TestContext;
  let s: Setup;

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await signedConsultation(ctx, "yakap-default");
  });
  afterAll(() => ctx.close());

  it("records the facility's participation reference (settings permission, versioned, audited)", async () => {
    const url = `/philhealth/facilities/${s.tenant.facilityId}/yakap-participation`;
    expect((await s.req(s.admin).get(url).expect(200)).body).toEqual({ participation: null });
    await s.req(s.cashier).put(url, { participationReference: "YK-0001" }).expect(403);
    await s.req(s.desk).get(url).expect(403);
    const created = await s
      .req(s.admin)
      .put(url, { participationReference: "YK-0001", validFrom: manilaDate(-365) })
      .expect(200);
    expect(created.body).toMatchObject({ participationReference: "YK-0001", version: 1 });
    await s.req(s.admin).put(url, { participationReference: "YK-0002" }).expect(409); // version required to replace
    const updated = await s
      .req(s.admin)
      .put(url, { participationReference: "YK-0002", validFrom: manilaDate(-365), version: 1 })
      .expect(200);
    expect(updated.body.version).toBe(2);
    expect((await s.req(s.admin).get(url).expect(200)).body).toMatchObject({ participation: { participationReference: "YK-0002", version: 2 } });
    const other = await createTenant(ctx.pool, "yakap-other");
    await s.req(s.admin).put(`/philhealth/facilities/${other.facilityId}/yakap-participation`, { participationReference: "X1" }).expect(422);
    const audit = await auditRows(ctx.pool, "action = 'philhealth.yakap.participation.record'");
    expect(audit).toHaveLength(2);
  });

  it("records PhilHealth's registration answers as append-only history (eligibility permission)", async () => {
    const list = () => s.req(s.desk).get(`/philhealth/yakap/registrations?patientId=${s.patientId}`);
    const empty = await list().expect(200);
    expect(empty.body).toMatchObject({
      integration: { system: "philhealth-yakap", status: "dependency" },
      participation: { participationReference: "YK-0002" },
      registrations: [],
    });
    await s.req(s.nurse).get(`/philhealth/yakap/registrations?patientId=${s.patientId}`).expect(403);
    await s.req(s.nurse).post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "unknown" }).expect(403);

    // A reference is required unless PhilHealth's channel gave no clear answer; the vocabulary is the platform's own.
    await s.req(s.desk).post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "pending" }).expect(400);
    await s.req(s.desk).post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "capitated", reference: "R" }).expect(400);
    const unknown = await s
      .req(s.desk)
      .post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "unknown", note: "PhilHealth's line was down" })
      .expect(201);
    expect(unknown.body).toMatchObject({ status: "unknown", externalReference: null, facilityId: s.tenant.facilityId });
    const registered = await s
      .req(s.desk)
      .post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "registered", effectiveDate: manilaDate(-30), reference: "REG-2026-0001" })
      .expect(201);
    expect(registered.body).toMatchObject({ status: "registered", effectiveDate: manilaDate(-30), externalReference: "REG-2026-0001" });

    await expect(ctx.pool.query("UPDATE philhealth_yakap_registration SET status = 'not_registered' WHERE id = $1", [registered.body.id])).rejects.toThrow(
      /cannot change/,
    );
    await expect(ctx.pool.query("DELETE FROM philhealth_yakap_registration WHERE id = $1", [unknown.body.id])).rejects.toThrow(/not deleted/);
    await expect(
      ctx.pool.query(
        `INSERT INTO philhealth_yakap_registration (organization_id, facility_id, patient_id, status, recorded_by)
         SELECT organization_id, facility_id, patient_id, 'registered', recorded_by FROM philhealth_yakap_registration WHERE id = $1`,
        [unknown.body.id],
      ),
    ).rejects.toThrow(/check/);

    const history = await list().expect(200);
    expect(history.body.registrations.map((r: { status: string }) => r.status)).toEqual(["registered", "unknown"]);
    const audit = await auditRows(ctx.pool, "action LIKE 'philhealth.yakap.registration.%' AND patient_id = $1", [s.patientId]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["philhealth.yakap.registration.list", "philhealth.yakap.registration.record"]));
  });

  it("prepares the encounter package from the platform's records (PIN masked), and refuses to submit while not connected", async () => {
    await s.req(s.doctor).get(`/philhealth/yakap/encounters/${s.encounterId}`).expect(403);
    await s.req(s.desk).get(`/philhealth/yakap/encounters/${s.encounterId}`).expect(403);

    const consultations = await s.req(s.cashier).get(`/philhealth/yakap/patients/${s.patientId}/consultations`).expect(200);
    expect(consultations.body.consultations).toEqual([
      expect.objectContaining({
        encounterId: s.encounterId,
        status: "completed",
        modality: "in_person",
        visitTypeName: "Consultation",
        latestSubmission: null,
      }),
    ]);

    const res = await s.req(s.cashier).get(`/philhealth/yakap/encounters/${s.encounterId}`).expect(200);
    expect(failingCodes(res.body.checks)).toEqual([]);
    expect(res.body).toMatchObject({ ready: true, integration: { status: "dependency" }, registration: { status: "registered" }, submissions: [] });
    expect(res.body.package).toMatchObject({
      model: "platform-yakap-1",
      facility: { id: s.tenant.facilityId, participationReference: "YK-0002" },
      patient: { patientNumber: "P00000001", philhealthPin: "•••• 9012" },
      registration: { status: "registered", reference: "REG-2026-0001" },
      encounter: { id: s.encounterId, modality: "in_person", visitType: "Consultation", clinician: { profession: "physician" } },
      diagnoses: [{ codeSystem: "icd-10", code: "E11.9", primary: true }],
      prescriptions: [{ items: [{ genericName: "Metformin", quantity: 60 }] }],
      labOrders: [{ tests: [{ code: "hba1c", name: "HbA1c", loincCode: "4548-4" }] }],
    });
    expect(JSON.stringify(res.body)).not.toContain("345678901");

    const refused = await s.req(s.cashier).post(`/philhealth/yakap/encounters/${s.encounterId}/submissions`, { idempotencyKey: "yakap-attempt-1" }).expect(422);
    expect(refused.body.error.code).toBe("integration_not_configured");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM integration_exchange")).rows[0].n).toBe(0);

    const audit = await auditRows(ctx.pool, "action IN ('philhealth.yakap.package.view', 'philhealth.yakap.consultation.list') AND patient_id = $1", [
      s.patientId,
    ]);
    expect(audit.map((a) => a.action).sort()).toEqual(["philhealth.yakap.consultation.list", "philhealth.yakap.package.view"]);
  });

  it("does not reach consultations or patients of another organization", async () => {
    const other = await createTenant(ctx.pool, "yakap-elsewhere");
    await createStaff(ctx.pool, other, "cashier@yakap-elsewhere.ph", ["cashier"]);
    const token = (await login(ctx, "cashier@yakap-elsewhere.ph")).accessToken;
    const get = (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, other.facilityId));
    await get(`/philhealth/yakap/encounters/${s.encounterId}`).expect(404);
    await get(`/philhealth/yakap/patients/${s.patientId}/consultations`).expect(404);
  });
});

describe("PhilHealth YAKAP — through an adapter (test double) and the integration worker", () => {
  let ctx: TestContext;
  let s: Setup;
  let worker: TestingModule;
  let processor: IntegrationExchangeProcessor;
  const gateway = new FakeYakapGateway();
  const submit = (key: string) => s.req(s.cashier).post(`/philhealth/yakap/encounters/${s.encounterId}/submissions`, { idempotencyKey: key });

  beforeAll(async () => {
    const provider = { provide: PHILHEALTH_YAKAP_GATEWAY, useValue: gateway };
    ctx = await createTestApp({ philhealthYakapGateway: provider });
    worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        IntegrationWorkerModule.forRoot({
          autoStart: false,
          handlerSets: [philhealthExchangeHandlers({ yakapGateway: provider })],
          queue: { provide: INTEGRATION_QUEUE, useValue: ctx.integrations },
        }),
      ],
    }).compile();
    processor = underPlatform(worker.get(IntegrationExchangeProcessor));
    s = await signedConsultation(ctx, "yakap-adapter");
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it("refuses an incomplete package, then sends it once through the worker", async () => {
    const notReady = await submit("yakap-attempt-1").expect(422);
    expect(notReady.body.error.code).toBe("yakap_package_not_ready");
    expect(notReady.body.error.details.map((c: { code: string }) => c.code)).toEqual(["participation_missing", "registration_missing"]);

    await s.req(s.admin).put(`/philhealth/facilities/${s.tenant.facilityId}/yakap-participation`, { participationReference: "YK-0100" }).expect(200);
    await s.req(s.desk).post("/philhealth/yakap/registrations", { patientId: s.patientId, status: "pending", reference: "REG-P-1" }).expect(201);

    const queued = await submit("yakap-attempt-1").expect(202);
    expect(queued.body).toMatchObject({ status: "queued" });
    expect((await submit("yakap-attempt-1").expect(202)).body.id).toBe(queued.body.id); // same key, same exchange
    expect((await submit("yakap-attempt-2").expect(409)).body.error.code).toBe("yakap_already_submitted");

    await drainEvents(ctx);
    await expect(processor.process(ctx.integrations.enqueued[0]!)).resolves.toBe("accepted");
    expect(gateway.received).toHaveLength(1);
    expect(gateway.received[0]!.key).toBe("yakap-attempt-1");
    expect(gateway.received[0]!.pkg).toMatchObject({
      model: "platform-yakap-1",
      facility: { participationReference: "YK-0100" },
      patient: { philhealthPin: "12-345678901-2" }, // the sealed package carries the PIN; only the preview masks it
      registration: { status: "pending", reference: "REG-P-1" },
      diagnoses: [{ code: "E11.9" }],
    });
    await drainEvents(ctx);

    const preview = await s.req(s.cashier).get(`/philhealth/yakap/encounters/${s.encounterId}`).expect(200);
    expect(preview.body.submissions).toEqual([expect.objectContaining({ status: "accepted", externalReference: "YK-TX-1" })]);
    const consultations = await s.req(s.cashier).get(`/philhealth/yakap/patients/${s.patientId}/consultations`).expect(200);
    expect(consultations.body.consultations[0].latestSubmission).toMatchObject({ status: "accepted", externalReference: "YK-TX-1" });
    expect((await submit("yakap-attempt-3").expect(409)).body.error.code).toBe("yakap_already_submitted");

    const exchange = (await ctx.pool.query("SELECT * FROM integration_exchange WHERE idempotency_key = 'yakap-attempt-1'")).rows[0];
    expect(exchange).toMatchObject({ system: "philhealth-yakap", operation: "submit_encounter", resource_type: "encounter", resource_id: s.encounterId });
    const audit = await auditRows(ctx.pool, "action = 'philhealth.yakap.submit-request'");
    expect(audit).toHaveLength(1);
  });
});
