import { Test, type TestingModule } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import type { DohCasePackage, DohReportingGateway, ExchangeOutcome } from "@healthcare/interoperability";
import { DOH_REPORTING_GATEWAY, INTEGRATION_QUEUE, IntegrationExchangeProcessor, IntegrationWorkerModule } from "@healthcare/interoperability";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

/** A test double standing in for a real DOH adapter (none exists: the specification is an integration dependency). */
class FakeDohGateway implements DohReportingGateway {
  readonly specification = { system: "doh-reporting", name: "Test double", status: "implemented" as const, specificationVersion: "test", note: "test" };
  readonly received: DohCasePackage[] = [];
  next: ExchangeOutcome[] = [];

  submitCaseReport(report: DohCasePackage): Promise<ExchangeOutcome> {
    this.received.push(report);
    return Promise.resolve(this.next.shift() ?? { outcome: "accepted", externalReference: `DOH-${this.received.length}` });
  }
}

interface Setup {
  tenant: Tenant;
  admin: string;
  doctor: string;
  records: string;
  cashier: string;
  patientId: string;
  req: (token: string) => {
    get: (url: string) => import("supertest").Test;
    post: (url: string, body?: object) => import("supertest").Test;
    put: (url: string, body?: object) => import("supertest").Test;
  };
  /** Records the diagnoses in the patient's open consultation; returns the encounter id. */
  diagnose: (...codes: Array<[string, string]>) => Promise<string>;
}

async function setup(ctx: TestContext, code: string): Promise<Setup> {
  const tenant = await createTenant(ctx.pool, code);
  await createStaff(ctx.pool, tenant, `admin@${code}.ph`, ["org_admin"]);
  await createClinician(ctx, tenant, `reyes@${code}.ph`, ["physician"]);
  await createStaff(ctx.pool, tenant, `records@${code}.ph`, ["records_officer"]);
  await createStaff(ctx.pool, tenant, `cashier@${code}.ph`, ["cashier"]);
  const [admin, doctor, records, cashier] = await Promise.all(
    [`admin@${code}.ph`, `reyes@${code}.ph`, `records@${code}.ph`, `cashier@${code}.ph`].map(async (e) => (await login(ctx, e)).accessToken),
  );
  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const visitTypeId = (
    await req(admin!).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
  ).body.id;
  await req(admin!).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
  const patientId = (await req(admin!).post("/patients", juan).expect(201)).body.id;
  // One open consultation; later diagnoses are added to it (a second walk-in would be refused while it is open).
  let encounterId: string | undefined;
  const diagnose = async (...codes: Array<[string, string]>) => {
    if (!encounterId) {
      const visit = await req(admin!).post("/queue/walk-ins", { patientId, visitTypeId }).expect(201);
      encounterId = (await req(doctor!).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id as string;
    }
    for (const [dx, display] of codes)
      await req(doctor!).post(`/encounters/${encounterId}/diagnoses`, { codeSystemKey: "icd-10", code: dx, display }).expect(201);
    return encounterId;
  };
  return { tenant, admin: admin!, doctor: doctor!, records: records!, cashier: cashier!, patientId, req, diagnose };
}

/**
 * DOH reporting adapter stubs (docs/interoperability/doh-reporting.md): the
 * organization configures which diagnoses are reportable; matching diagnoses
 * open case reports for review; nothing is transmitted while the official
 * specification is an integration dependency.
 */
describe("DOH case reporting — unconfigured (default)", () => {
  let ctx: TestContext;
  let s: Setup;
  const cases = async () =>
    (await s.req(s.records).get("/doh/case-reports").expect(200)).body as Array<Record<string, unknown> & { id: string; version: number }>;

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await setup(ctx, "doh-default");
  });
  afterAll(() => ctx.close());

  it("keeps reportable conditions as the organization's own configuration", async () => {
    expect((await s.req(s.records).get("/doh/rules").expect(200)).body).toEqual([]); // nothing is reportable unless configured
    await s.req(s.records).post("/doh/rules", { codePrefix: "A91", category: "Dengue" }).expect(403);
    await s.req(s.admin).post("/doh/rules", { codePrefix: "dengue", category: "Dengue" }).expect(400);
    const rule = await s
      .req(s.admin)
      .post("/doh/rules", { codePrefix: " a91 ", category: "Dengue", sourceNote: "Per the issuance our facility follows" })
      .expect(201);
    expect(rule.body).toMatchObject({ codePrefix: "A91", category: "Dengue", status: "active" });
    expect((await s.req(s.admin).post("/doh/rules", { codePrefix: "A91", category: "Again" }).expect(409)).body.error.code).toBe("rule_exists");
    const measles = await s.req(s.admin).post("/doh/rules", { codePrefix: "B05", category: "Measles" }).expect(201);
    await s.req(s.admin).post(`/doh/rules/${measles.body.id}/deactivate`).expect(200);
    await s.req(s.cashier).get("/doh/rules").expect(403);
    expect((await s.req(s.records).get("/doh/integration").expect(200)).body).toMatchObject({ system: "doh-reporting", status: "dependency" });
  });

  it("opens a case report when a matching diagnosis is recorded (once), and only then", async () => {
    await s.diagnose(["A91.0", "Dengue haemorrhagic fever"], ["J06.9", "Acute upper respiratory infection"], ["B05.9", "Measles"]);
    await drainEvents(ctx);
    await drainEvents(ctx);
    const list = await cases();
    expect(list).toEqual([
      expect.objectContaining({
        status: "pending_review",
        category: "Dengue",
        diagnosisCode: "A91.0",
        diagnosisDisplay: "Dengue haemorrhagic fever",
        patient: expect.objectContaining({ patientNumber: "P00000001" }),
      }),
    ]);
    const audit = await auditRows(ctx.pool, "action = 'doh.case.detected'");
    expect(audit).toEqual([expect.objectContaining({ actor_type: "system", patient_id: s.patientId })]);
  });

  it("prepares the report, names what is missing, and refuses to submit while DOH reporting is a dependency", async () => {
    const [c] = await cases();
    let detail = await s.req(s.records).get(`/doh/case-reports/${c!.id}`).expect(200);
    expect(detail.body.ready).toBe(false);
    expect(detail.body.checks.filter((x: { ok: boolean }) => !x.ok).map((x: { code: string }) => x.code)).toEqual(["facility_code_missing"]);

    await s.req(s.records).put(`/doh/facilities/${s.tenant.facilityId}/facility-code`, { facilityCode: "DOH-0001" }).expect(403);
    await s.req(s.admin).put(`/doh/facilities/${s.tenant.facilityId}/facility-code`, { facilityCode: "NHFR-000123" }).expect(200);
    expect((await s.req(s.admin).get(`/doh/facilities/${s.tenant.facilityId}/facility-code`).expect(200)).body.facilityCode).toMatchObject({
      facilityCode: "NHFR-000123",
    });

    detail = await s.req(s.records).get(`/doh/case-reports/${c!.id}`).expect(200);
    expect(detail.body).toMatchObject({
      ready: true,
      integration: { status: "dependency" },
      report: {
        model: "platform-case-1",
        category: "Dengue",
        facility: { facilityCode: "NHFR-000123", name: "Main Clinic" },
        patient: { familyName: "Dela Cruz", address: { barangay: "Poblacion", cityMunicipality: "Makati City" } },
        diagnosis: { codeSystem: "icd-10", code: "A91.0", certainty: "provisional" },
      },
    });
    const refused = await s
      .req(s.records)
      .post(`/doh/case-reports/${c!.id}/submissions`, { idempotencyKey: "case-attempt-1", version: c!.version })
      .expect(422);
    expect(refused.body.error.code).toBe("integration_not_configured");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM integration_exchange")).rows[0].n).toBe(0);
  });

  it("records a case reported through DOH's own channel, and dismisses others with a reason", async () => {
    const [c] = await cases();
    await s
      .req(s.records)
      .post(`/doh/case-reports/${c!.id}/reported`, { reference: "PIDSR-2026-0042", version: c!.version + 5 })
      .expect(409);
    const reported = await s.req(s.records).post(`/doh/case-reports/${c!.id}/reported`, { reference: "PIDSR-2026-0042", version: c!.version }).expect(200);
    expect(reported.body).toMatchObject({ status: "reported", reportedVia: "external_channel", externalReference: "PIDSR-2026-0042" });
    expect(
      (await s.req(s.records).post(`/doh/case-reports/${c!.id}/dismiss`, { reason: "Duplicate", version: reported.body.version }).expect(422)).body.error.code,
    ).toBe("case_report_state");

    await s.diagnose(["A91", "Dengue fever (to be confirmed)"]);
    await drainEvents(ctx);
    const pending = (await s.req(s.records).get("/doh/case-reports?status=pending_review").expect(200)).body;
    expect(pending).toHaveLength(1);
    await s.req(s.records).post(`/doh/case-reports/${pending[0].id}/dismiss`, { reason: "x", version: pending[0].version }).expect(400);
    const dismissed = await s
      .req(s.doctor)
      .post(`/doh/case-reports/${pending[0].id}/dismiss`, { reason: "Ruled out after NS1 test", version: pending[0].version })
      .expect(200);
    expect(dismissed.body).toMatchObject({ status: "dismissed", statusReason: "Ruled out after NS1 test" });

    const audit = await auditRows(ctx.pool, "action IN ('doh.case.reported', 'doh.case.dismissed')");
    expect(audit.map((a) => [a.action, a.actor_type, a.reason])).toEqual([
      ["doh.case.reported", "user", null],
      ["doh.case.dismissed", "user", "Ruled out after NS1 test"],
    ]);
    await s.req(s.cashier).get("/doh/case-reports").expect(403);
  });
});

describe("DOH case reporting — through an adapter (test double) and the integration worker", () => {
  let ctx: TestContext;
  let s: Setup;
  let worker: TestingModule;
  let processor: IntegrationExchangeProcessor;
  const gateway = new FakeDohGateway();

  beforeAll(async () => {
    const dohGateway = { provide: DOH_REPORTING_GATEWAY, useValue: gateway };
    ctx = await createTestApp({ dohGateway });
    worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        IntegrationWorkerModule.forRoot({ autoStart: false, dohGateway, queue: { provide: INTEGRATION_QUEUE, useValue: ctx.integrations } }),
      ],
    }).compile();
    processor = worker.get(IntegrationExchangeProcessor);
    s = await setup(ctx, "doh-adapter");
    await s.req(s.admin).post("/doh/rules", { codePrefix: "A9", category: "Dengue and other viral fevers" }).expect(201);
    await s.req(s.admin).put(`/doh/facilities/${s.tenant.facilityId}/facility-code`, { facilityCode: "NHFR-000999" }).expect(200);
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it("submits through the worker and records the outcome on the case report", async () => {
    await s.diagnose(["A90", "Dengue fever"]);
    await drainEvents(ctx);
    const [c] = (await s.req(s.records).get("/doh/case-reports").expect(200)).body;
    const queued = await s.req(s.records).post(`/doh/case-reports/${c.id}/submissions`, { idempotencyKey: "case-attempt-1", version: c.version }).expect(202);
    expect(queued.body).toMatchObject({ status: "queued", submissions: [expect.objectContaining({ status: "queued" })] });
    // Same key: the same exchange. The case is no longer open for another submission.
    await s.req(s.records).post(`/doh/case-reports/${c.id}/submissions`, { idempotencyKey: "case-attempt-1", version: c.version }).expect(202);
    const again = await s
      .req(s.records)
      .post(`/doh/case-reports/${c.id}/submissions`, { idempotencyKey: "case-attempt-2", version: queued.body.version })
      .expect(422);
    expect(again.body.error.code).toBe("case_report_state");

    await drainEvents(ctx);
    expect(ctx.integrations.enqueued).toHaveLength(1);
    await expect(processor.process(ctx.integrations.enqueued[0]!)).resolves.toBe("accepted");
    expect(gateway.received[0]).toMatchObject({
      category: "Dengue and other viral fevers",
      diagnosis: { code: "A90" },
      facility: { facilityCode: "NHFR-000999" },
    });
    await drainEvents(ctx);
    const done = await s.req(s.records).get(`/doh/case-reports/${c.id}`).expect(200);
    expect(done.body).toMatchObject({ status: "reported", reportedVia: "adapter", externalReference: "DOH-1" });

    // A rejection leaves the case open: staff may report through DOH's channel or dismiss.
    gateway.next = [{ outcome: "rejected", reasons: [{ code: "R-TEST", message: "Rejected by the test double" }] }];
    await s.diagnose(["A92.0", "Chikungunya virus disease"]);
    await drainEvents(ctx);
    const second = (await s.req(s.records).get("/doh/case-reports?status=pending_review").expect(200)).body[0];
    await s.req(s.records).post(`/doh/case-reports/${second.id}/submissions`, { idempotencyKey: "case-attempt-3", version: second.version }).expect(202);
    await drainEvents(ctx);
    await expect(processor.process(ctx.integrations.enqueued[1]!)).resolves.toBe("rejected");
    await drainEvents(ctx);
    const rejected = await s.req(s.records).get(`/doh/case-reports/${second.id}`).expect(200);
    expect(rejected.body).toMatchObject({ status: "rejected", submissions: [expect.objectContaining({ status: "rejected" })] });
    await s.req(s.records).post(`/doh/case-reports/${second.id}/reported`, { reference: "MANUAL-7", version: rejected.body.version }).expect(200);
  });
});
