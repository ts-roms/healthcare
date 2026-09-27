import { randomBytes } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { type AppConfig, CoreModule, DATABASE, type Database, DomainEventPublisher, encryptSecret, systemActor } from "@healthcare/core";
import type { DohCasePackage, DohReportingGateway, ExchangeOutcome } from "@healthcare/interoperability";
import {
  canonicalJson,
  DOH_REPORTING_GATEWAY,
  DOH_REPORTING_SYSTEM,
  DohRescans,
  INTEGRATION_QUEUE,
  IntegrationExchangeProcessor,
  IntegrationExchanges,
  IntegrationWorkerModule,
  SUBMIT_CASE_REPORT,
} from "@healthcare/interoperability";
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

describe("DOH case reporting — checking earlier diagnoses against the rules", () => {
  let ctx: TestContext;
  let s: Setup;
  let rescans: DohRescans;
  const today = manilaDate(0);

  beforeAll(async () => {
    ctx = await createTestApp();
    rescans = ctx.app.get(DohRescans);
    s = await setup(ctx, "doh-rescan");
  });
  afterAll(() => ctx.close());

  it("opens nothing for diagnoses recorded before a rule exists", async () => {
    await s.diagnose(["A91.0", "Dengue haemorrhagic fever"], ["J06.9", "Acute upper respiratory infection"], ["B05.9", "Measles"]);
    await drainEvents(ctx);
    expect((await s.req(s.records).get("/doh/case-reports").expect(200)).body).toEqual([]);
  });

  it("is permission-gated and validated: rules first, a past range of at most 90 days", async () => {
    await s.req(s.records).post("/doh/rescans", { from: today, to: today }).expect(403);
    await s.req(s.records).get("/doh/rescans").expect(403);
    expect((await s.req(s.admin).post("/doh/rescans", { from: today, to: today }).expect(422)).body.error.code).toBe("no_active_rules");
    await s.req(s.admin).post("/doh/rules", { codePrefix: "A91", category: "Dengue" }).expect(201);
    await s.req(s.admin).post("/doh/rescans", { from: "2026-02-30", to: today }).expect(400);
    const tooLong = await s
      .req(s.admin)
      .post("/doh/rescans", { from: manilaDate(-90), to: today })
      .expect(422);
    expect(tooLong.body.error).toMatchObject({ code: "rescan_range", message: "A check covers at most 90 days; split the range" });
    expect(
      (
        await s
          .req(s.admin)
          .post("/doh/rescans", { from: today, to: manilaDate(1) })
          .expect(422)
      ).body.error.code,
    ).toBe("rescan_range");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM doh_rescan")).rows[0].n).toBe(0);
  });

  it("checks the range in the background and opens a case report per matching diagnosis", async () => {
    const queued = await s
      .req(s.admin)
      .post("/doh/rescans", { from: manilaDate(-89), to: today })
      .expect(202);
    expect(queued.body).toMatchObject({ status: "queued", fromDate: manilaDate(-89), toDate: today, timeZone: "Asia/Manila", scanned: 0 });
    expect(queued.body).not.toHaveProperty("organizationId");
    // One check at a time per organization.
    expect((await s.req(s.admin).post("/doh/rescans", { from: today, to: today }).expect(409)).body.error.code).toBe("rescan_in_progress");

    await expect(rescans.runPending()).resolves.toBe(1);
    const done = await s.req(s.admin).get(`/doh/rescans/${queued.body.id}`).expect(200);
    expect(done.body).toMatchObject({ status: "completed", scanned: 3, matched: 1, opened: 1, lastError: null });
    const cases = (await s.req(s.records).get("/doh/case-reports").expect(200)).body;
    expect(cases).toEqual([expect.objectContaining({ status: "pending_review", diagnosisCode: "A91.0", category: "Dengue", rescanId: queued.body.id })]);

    const audit = await auditRows(ctx.pool, "action LIKE 'doh.rescan.%' OR action = 'doh.case.detected'");
    expect(audit.map((a) => [a.action, a.actor_type])).toEqual([
      ["doh.rescan.request", "user"],
      ["doh.case.detected", "system"],
      ["doh.rescan.completed", "system"],
    ]);
    expect(audit[1]!.metadata).toMatchObject({ code: "A91.0", rescanId: queued.body.id });
    expect(audit[2]!.metadata).toMatchObject({ scanned: 3, matched: 1, opened: 1 });
  });

  it("is idempotent: a second check opens only what is new, and the range bounds what is read", async () => {
    await s.req(s.admin).post("/doh/rules", { codePrefix: "B05", category: "Measles" }).expect(201);
    const second = await s.req(s.admin).post("/doh/rescans", { from: today, to: today }).expect(202);
    await rescans.runPending();
    expect((await s.req(s.admin).get(`/doh/rescans/${second.body.id}`).expect(200)).body).toMatchObject({
      status: "completed",
      scanned: 3,
      matched: 2,
      opened: 1,
    });
    const codes = (await s.req(s.records).get("/doh/case-reports").expect(200)).body.map((c: { diagnosisCode: string }) => c.diagnosisCode);
    expect(codes.sort()).toEqual(["A91.0", "B05.9"]);

    // Nothing was recorded yesterday.
    const earlier = await s
      .req(s.admin)
      .post("/doh/rescans", { from: manilaDate(-1), to: manilaDate(-1) })
      .expect(202);
    await rescans.runPending();
    expect((await s.req(s.admin).get(`/doh/rescans/${earlier.body.id}`).expect(200)).body).toMatchObject({ status: "completed", scanned: 0, opened: 0 });
    const list = (await s.req(s.admin).get("/doh/rescans").expect(200)).body;
    expect(list.map((r: { id: string }) => r.id)).toEqual([earlier.body.id, second.body.id, expect.any(String)]);
  });

  it("resumes an interrupted check from its cursor without counting twice", async () => {
    await s.diagnose(["A91", "Dengue fever"]);
    await drainEvents(ctx); // opened as it was recorded
    await s.diagnose(["B05.3", "Measles complicated by otitis media"]);
    // The event is not dispatched: as if the rule had been added after this diagnosis.
    await ctx.pool.query("UPDATE domain_event SET published_at = now() WHERE published_at IS NULL");
    // An interrupted run: claimed, three diagnoses checked, then the API stopped (stale heartbeat).
    const ids = await ctx.pool.query<{ id: string; recorded_at: string }>(
      "SELECT id, recorded_at::text FROM diagnosis WHERE organization_id = $1 ORDER BY recorded_at, id",
      [s.tenant.organizationId],
    );
    const third = ids.rows[2]!;
    const admin = await ctx.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email = 'admin@doh-rescan.ph'");
    const interrupted = await ctx.pool.query<{ id: string }>(
      `INSERT INTO doh_rescan (organization_id, from_date, to_date, time_zone, status, scanned, matched, cursor_recorded_at, cursor_diagnosis_id,
         attempts, requested_by, started_at, heartbeat_at)
       VALUES ($1, $2, $2, 'Asia/Manila', 'running', 3, 2, $3, $4, 1, $5, now() - interval '20 minutes', now() - interval '10 minutes') RETURNING id`,
      [s.tenant.organizationId, today, third.recorded_at, third.id, admin.rows[0]!.id],
    );
    await expect(rescans.runPending()).resolves.toBe(1);
    expect((await s.req(s.admin).get(`/doh/rescans/${interrupted.rows[0]!.id}`).expect(200)).body).toMatchObject({
      status: "completed",
      scanned: 5,
      matched: 4,
      opened: 1,
    });
    const pending = (await s.req(s.records).get("/doh/case-reports?status=pending_review").expect(200)).body;
    expect(pending.map((c: { diagnosisCode: string }) => c.diagnosisCode).sort()).toEqual(["A91", "A91.0", "B05.3", "B05.9"]);
  });
});

describe("Integration payload key rotation — queued DOH submissions through the worker", () => {
  let ctx: TestContext;
  let s: Setup;
  const gateway = new FakeDohGateway();
  const dohGateway = { provide: DOH_REPORTING_GATEWAY, useValue: gateway };
  const keyA = randomBytes(32).toString("base64");
  const keyB = randomBytes(32).toString("base64");
  const workers: TestingModule[] = [];

  /** A process configured with this key ring (INTEGRATION_PAYLOAD_KEYS / INTEGRATION_PAYLOAD_KEY_ID). */
  const withKeys = (keys: Record<string, string>, current: string): AppConfig => ({
    ...ctx.config,
    INTEGRATION_PAYLOAD_KEYS: keys,
    INTEGRATION_PAYLOAD_KEY_ID: current,
  });
  const worker = async (config: AppConfig) => {
    const module = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(config),
        IntegrationWorkerModule.forRoot({ autoStart: false, dohGateway, queue: { provide: INTEGRATION_QUEUE, useValue: ctx.integrations } }),
      ],
    }).compile();
    workers.push(module);
    return module.get(IntegrationExchangeProcessor);
  };
  const payloadRow = async (exchangeId: string) =>
    (
      await ctx.pool.query<{ key_id: string | null; ciphertext: string }>(
        "SELECT key_id, ciphertext FROM integration_exchange_payload WHERE exchange_id = $1",
        [exchangeId],
      )
    ).rows[0];
  const pendingCase = async () =>
    (await s.req(s.records).get("/doh/case-reports?status=pending_review").expect(200)).body[0] as { id: string; version: number };

  beforeAll(async () => {
    ctx = await createTestApp({ dohGateway }, { INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ "2026-a": keyA }), INTEGRATION_PAYLOAD_KEY_ID: "2026-a" });
    s = await setup(ctx, "doh-keys");
    await s.req(s.admin).post("/doh/rules", { codePrefix: "A9", category: "Dengue and other viral fevers" }).expect(201);
    await s.req(s.admin).put(`/doh/facilities/${s.tenant.facilityId}/facility-code`, { facilityCode: "NHFR-000777" }).expect(200);
  });
  afterAll(async () => {
    for (const w of workers) await w.close();
    await ctx.close();
  });

  it("opens payloads sealed with the old key, the new key and before key ids, while both keys are listed", async () => {
    // Before the rotation: the API seals with 2026-a.
    await s.diagnose(["A90", "Dengue fever"], ["A92.0", "Chikungunya virus disease"], ["A91", "Dengue haemorrhagic fever"]);
    await drainEvents(ctx);
    const first = await pendingCase();
    const queued = await s
      .req(s.records)
      .post(`/doh/case-reports/${first.id}/submissions`, { idempotencyKey: "rotation-1", version: first.version })
      .expect(202);
    const e1 = queued.body.submissions[0].id as string;
    expect(await payloadRow(e1)).toMatchObject({ key_id: "2026-a", ciphertext: expect.stringMatching(/^v2\.2026-a\./) });

    // Rotation: 2026-b is current, 2026-a still listed. An API instance already on the new ring seals with 2026-b.
    const rotated = withKeys({ "2026-a": keyA, "2026-b": keyB }, "2026-b");
    const second = await pendingCase();
    const report = (await s.req(s.records).get(`/doh/case-reports/${second.id}`).expect(200)).body.report as DohCasePackage;
    const adminId = (await ctx.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email = 'admin@doh-keys.ph'")).rows[0]!.id;
    const actor = { ...systemActor(s.tenant.organizationId, s.tenant.facilityId), kind: "user" as const, userId: adminId };
    const exchanges = new IntegrationExchanges(rotated, ctx.app.get(DomainEventPublisher));
    const request = (idempotencyKey: string) =>
      ctx.app.get<Database>(DATABASE).transaction((tx) =>
        exchanges.request(tx, actor, {
          system: DOH_REPORTING_SYSTEM,
          operation: SUBMIT_CASE_REPORT,
          idempotencyKey,
          patientId: s.patientId,
          resourceType: "doh_case_report",
          resourceId: second.id,
          payload: report,
        }),
      );
    const e2 = (await request("rotation-2")).id;
    expect(await payloadRow(e2)).toMatchObject({ key_id: "2026-b", ciphertext: expect.stringMatching(/^v2\.2026-b\./) });
    // A payload sealed before key ids existed ("v1", key_id NULL), with the old key.
    const e3 = (await request("rotation-3")).id;
    await ctx.pool.query("UPDATE integration_exchange_payload SET key_id = NULL, ciphertext = $2 WHERE exchange_id = $1", [
      e3,
      encryptSecret(canonicalJson(report), keyA),
    ]);
    // The table keeps the key id and the header consistent.
    await expect(ctx.pool.query("UPDATE integration_exchange_payload SET key_id = '2026-b' WHERE exchange_id = $1", [e1])).rejects.toThrow(
      /integration_exchange_payload_sealed_format/,
    );

    const during = await worker(rotated);
    await expect(during.unavailableKeyIds()).resolves.toEqual([]);
    for (const id of [e1, e2, e3]) await expect(during.process(id)).resolves.toBe("accepted");
    expect(gateway.received).toHaveLength(3);
    expect(gateway.received.map((r) => r.caseReportId)).toEqual([first.id, second.id, second.id]);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM integration_exchange_payload")).rows[0].n).toBe(0);
  });

  it("fails an exchange, sending nothing, when its key was removed too early", async () => {
    // Still sealed with 2026-a by this API instance; the worker has already dropped the old key.
    const c = await pendingCase();
    const queued = await s.req(s.records).post(`/doh/case-reports/${c.id}/submissions`, { idempotencyKey: "rotation-4", version: c.version }).expect(202);
    const exchangeId = queued.body.submissions[0].id as string;
    const after = await worker(withKeys({ "2026-b": keyB }, "2026-b"));
    await expect(after.unavailableKeyIds()).resolves.toEqual(["2026-a"]);
    await expect(after.process(exchangeId)).resolves.toBe("failed");
    expect(gateway.received).toHaveLength(3);
    const exchange = await ctx.pool.query("SELECT status, last_error FROM integration_exchange WHERE id = $1", [exchangeId]);
    expect(exchange.rows[0]).toMatchObject({
      status: "failed",
      last_error: 'Payload unusable: sealed with key "2026-a", which is not configured on the integration worker',
    });
    expect(await payloadRow(exchangeId)).toBeUndefined();
    await drainEvents(ctx);
    expect((await s.req(s.records).get(`/doh/case-reports/${c.id}`).expect(200)).body).toMatchObject({ status: "failed" });
  });
});
