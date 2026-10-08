import { Test, type TestingModule } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import { INTEGRATION_QUEUE, IntegrationExchangeProcessor, IntegrationWorkerModule } from "@healthcare/interoperability";
import type { EligibilityInquiry, EligibilityOutcome, PhilHealthEligibilityGateway } from "@healthcare/philhealth";
import { PHILHEALTH_ELIGIBILITY_GATEWAY, philhealthExchangeHandlers } from "@healthcare/philhealth";
import {
  as,
  auditRows,
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

/** A test double standing in for a real eligibility adapter (none exists: the specification is an integration dependency). */
class FakeEligibilityGateway implements PhilHealthEligibilityGateway {
  readonly specification = {
    system: "philhealth-eligibility",
    name: "Test double",
    status: "implemented" as const,
    specificationVersion: "test",
    note: "test",
  };
  readonly received: EligibilityInquiry[] = [];
  next: EligibilityOutcome[] = [];

  checkEligibility(inquiry: EligibilityInquiry): Promise<EligibilityOutcome> {
    this.received.push(inquiry);
    return Promise.resolve(this.next.shift() ?? { outcome: "answered", answer: "eligible", externalReference: `ELIG-${this.received.length}` });
  }
}

interface Setup {
  tenant: Tenant;
  admin: string;
  desk: string;
  nurse: string;
  patientId: string;
  req: (token: string) => { get: (url: string) => import("supertest").Test; post: (url: string, body?: object) => import("supertest").Test };
}

async function setup(ctx: TestContext, code: string): Promise<Setup> {
  const tenant = await createTenant(ctx.pool, code);
  await createStaff(ctx.pool, tenant, `admin@${code}.ph`, ["org_admin"]);
  await createStaff(ctx.pool, tenant, `desk@${code}.ph`, ["receptionist"]);
  await createStaff(ctx.pool, tenant, `nurse@${code}.ph`, ["nurse"]);
  const [admin, desk, nurse] = await Promise.all(
    [`admin@${code}.ph`, `desk@${code}.ph`, `nurse@${code}.ph`].map(async (e) => (await login(ctx, e)).accessToken),
  );
  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const patientId = (await req(admin!).post("/patients", juan).expect(201)).body.id;
  return { tenant, admin: admin!, desk: desk!, nurse: nurse!, patientId, req };
}

/**
 * PhilHealth eligibility adapter stubs (docs/interoperability/philhealth-eligibility.md): staff record what
 * PhilHealth's own channel answered; nothing is sent while the specification is an integration dependency.
 */
describe("PhilHealth eligibility — unconfigured (default)", () => {
  let ctx: TestContext;
  let s: Setup;

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await setup(ctx, "elig-default");
  });
  afterAll(() => ctx.close());

  it("records answers from PhilHealth's own channel as history, and refuses adapter checks while not connected", async () => {
    const today = manilaDate(0);
    const empty = await s.req(s.desk).get(`/philhealth/eligibility?patientId=${s.patientId}&serviceDate=${today}`).expect(200);
    expect(empty.body).toMatchObject({ integration: { system: "philhealth-eligibility", status: "dependency" }, checks: [] });
    expect(empty.body.readiness.filter((c: { ok: boolean }) => !c.ok).map((c: { code: string }) => c.code)).toEqual(["accreditation_missing"]);
    await s.req(s.nurse).get(`/philhealth/eligibility?patientId=${s.patientId}`).expect(403);

    await s.req(s.desk).post("/philhealth/eligibility/records", { patientId: s.patientId, serviceDate: today, answer: "eligible" }).expect(400); // reference required
    const recorded = await s
      .req(s.desk)
      .post("/philhealth/eligibility/records", {
        patientId: s.patientId,
        serviceDate: today,
        answer: "eligible",
        reference: "PBEF-2026-0001",
        note: "Checked at the PhilHealth desk",
      })
      .expect(201);
    expect(recorded.body).toMatchObject({ status: "eligible", source: "external_channel", externalReference: "PBEF-2026-0001", serviceDate: today });

    // Answers never change.
    await expect(ctx.pool.query("UPDATE philhealth_eligibility_check SET status = 'not_eligible' WHERE id = $1", [recorded.body.id])).rejects.toThrow(
      /cannot change/,
    );
    await expect(ctx.pool.query("DELETE FROM philhealth_eligibility_check WHERE id = $1", [recorded.body.id])).rejects.toThrow(/not deleted/);

    const refused = await s
      .req(s.desk)
      .post("/philhealth/eligibility/checks", { patientId: s.patientId, serviceDate: today, idempotencyKey: "elig-attempt-1" })
      .expect(422);
    expect(refused.body.error.code).toBe("integration_not_configured");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM integration_exchange")).rows[0].n).toBe(0);

    const list = await s.req(s.desk).get(`/philhealth/eligibility?patientId=${s.patientId}`).expect(200);
    expect(list.body.checks).toEqual([expect.objectContaining({ id: recorded.body.id, status: "eligible" })]);
    const audit = await auditRows(ctx.pool, "action LIKE 'philhealth.eligibility.%' AND patient_id = $1", [s.patientId]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["philhealth.eligibility.list", "philhealth.eligibility.record"]));
  });
});

describe("PhilHealth eligibility — through an adapter (test double) and the integration worker", () => {
  let ctx: TestContext;
  let s: Setup;
  let worker: TestingModule;
  let processor: IntegrationExchangeProcessor;
  const gateway = new FakeEligibilityGateway();

  beforeAll(async () => {
    const provider = { provide: PHILHEALTH_ELIGIBILITY_GATEWAY, useValue: gateway };
    ctx = await createTestApp({ philhealthEligibilityGateway: provider });
    worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        IntegrationWorkerModule.forRoot({
          autoStart: false,
          handlerSets: [philhealthExchangeHandlers({ eligibilityGateway: provider })],
          queue: { provide: INTEGRATION_QUEUE, useValue: ctx.integrations },
        }),
      ],
    }).compile();
    processor = underPlatform(worker.get(IntegrationExchangeProcessor));
    s = await setup(ctx, "elig-adapter");
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it("asks through the worker and records the answer", async () => {
    const today = manilaDate(0);
    const ask = (key: string) => s.req(s.desk).post("/philhealth/eligibility/checks", { patientId: s.patientId, serviceDate: today, idempotencyKey: key });
    expect((await ask("elig-attempt-1").expect(422)).body.error.code).toBe("eligibility_not_ready"); // no accreditation yet
    await ctx
      .http()
      .put(`/api/v1/philhealth/facilities/${s.tenant.facilityId}/accreditation`)
      .set(as(s.admin, s.tenant.facilityId))
      .send({ accreditationNumber: "H91000500" })
      .expect(200);

    const queued = await ask("elig-attempt-1").expect(202);
    expect(queued.body).toMatchObject({ status: "queued", source: "adapter" });
    expect((await ask("elig-attempt-1").expect(202)).body.id).toBe(queued.body.id); // same key, same check
    await drainEvents(ctx);
    await expect(processor.process(ctx.integrations.enqueued[0]!)).resolves.toBe("accepted");
    expect(gateway.received[0]).toMatchObject({
      model: "platform-eligibility-1",
      serviceDate: today,
      patient: { philhealthPin: "12-345678901-2" },
      facility: { accreditationNumber: "H91000500" },
    });
    await drainEvents(ctx);

    gateway.next = [{ outcome: "rejected", reasons: [{ code: "R-TEST", message: "Rejected by the test double" }] }];
    await ask("elig-attempt-2").expect(202);
    await drainEvents(ctx);
    await expect(processor.process(ctx.integrations.enqueued[1]!)).resolves.toBe("rejected");
    await drainEvents(ctx);

    const list = await s.req(s.desk).get(`/philhealth/eligibility?patientId=${s.patientId}`).expect(200);
    expect(list.body.checks.map((c: { status: string; externalReference: string | null }) => [c.status, c.externalReference])).toEqual([
      ["failed", null],
      ["eligible", "ELIG-1"],
    ]);
    const audit = await auditRows(ctx.pool, "action = 'philhealth.eligibility.answer'");
    expect(audit.map((a) => a.actor_type)).toEqual(["system", "system"]);
  });
});
