import { Test, type TestingModule } from "@nestjs/testing";
import { CoreModule } from "@healthcare/core";
import { INTEGRATION_QUEUE, IntegrationExchangeProcessor, IntegrationWorkerModule } from "@healthcare/interoperability";
import type { EligibilityOutcome, PhilHealthEligibilityGateway } from "@healthcare/philhealth";
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

class FakeEligibilityGateway implements PhilHealthEligibilityGateway {
  readonly specification = {
    system: "philhealth-eligibility",
    name: "Test double",
    status: "implemented" as const,
    specificationVersion: "test",
    note: "test",
  };
  next: EligibilityOutcome[] = [];
  checkEligibility(): Promise<EligibilityOutcome> {
    return Promise.resolve(this.next.shift() ?? { outcome: "answered", answer: "eligible", externalReference: "ELIG-OK" });
  }
}

/**
 * Operator review of outbound exchanges (docs/architecture/integration-worker.md): what failed, was rejected or looks
 * stalled; re-queue a stalled exchange; record a resolution. The outcome itself never changes; payloads never show.
 */
describe("integration exchange review", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let patientId: string;
  let worker: TestingModule;
  let processor: IntegrationExchangeProcessor;
  const gateway = new FakeEligibilityGateway();
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const exchangeOf = async (checkId: string) =>
    (await ctx.pool.query<{ exchange_id: string }>("SELECT exchange_id FROM philhealth_eligibility_check WHERE id = $1", [checkId])).rows[0]!.exchange_id;

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
    tenant = await createTenant(ctx.pool, "exchange-review");
    await createStaff(ctx.pool, tenant, "admin@review.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@review.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@review.ph")).accessToken;
    desk = (await login(ctx, "desk@review.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    await ctx
      .http()
      .put(`/api/v1/philhealth/facilities/${tenant.facilityId}/accreditation`)
      .set(as(admin, tenant.facilityId))
      .send({ accreditationNumber: "H91000700" })
      .expect(200);

    // Four exchanges: accepted, rejected, failed on its last attempt, and one left queued.
    const ask = async (key: string) =>
      exchangeOf(
        (
          await api(desk)
            .post("/philhealth/eligibility/checks", { patientId, serviceDate: manilaDate(0), idempotencyKey: key })
            .expect(202)
        ).body.id,
      );
    ids.accepted = await ask("review-accepted");
    ids.rejected = await ask("review-rejected");
    ids.failed = await ask("review-failed");
    ids.queued = await ask("review-queued");
    await drainEvents(ctx);
    await processor.process(ids.accepted);
    gateway.next = [{ outcome: "rejected", reasons: [{ code: "R-TEST", message: "Rejected by the test double" }] }];
    await processor.process(ids.rejected);
    gateway.next = [{ outcome: "failed", retryable: true, error: "gateway unavailable" }];
    await processor.process(ids.failed, { finalAttempt: true });
    await drainEvents(ctx);
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it("lists what needs attention: unsuccessful and unresolved, and stalled queued exchanges", async () => {
    await api(desk).get("/integrations/exchanges").expect(403);
    let list = await api(admin).get("/integrations/exchanges").expect(200);
    expect(list.body.exchanges.map((e: { id: string }) => e.id).sort()).toEqual([ids.rejected, ids.failed].sort());
    expect(list.body.summary).toEqual({ needsReview: 2, stalled: 0, queued: 1 });

    // The queued one's job was lost 15 minutes ago: it is stalled now.
    await ctx.pool.query("UPDATE integration_exchange SET requested_at = now() - interval '15 minutes' WHERE id = $1", [ids.queued]);
    list = await api(admin).get("/integrations/exchanges").expect(200);
    expect(list.body.summary).toEqual({ needsReview: 2, stalled: 1, queued: 1 });
    const stalled = list.body.exchanges.find((e: { id: string }) => e.id === ids.queued);
    expect(stalled).toMatchObject({ status: "queued", stalled: true, payloadSealed: true, system: "philhealth-eligibility", resourceType: "patient" });
    const rejected = list.body.exchanges.find((e: { id: string }) => e.id === ids.rejected);
    expect(rejected).toMatchObject({
      status: "rejected",
      payloadSealed: false,
      outcomeDetail: { reasons: [{ code: "R-TEST" }] },
      patient: { patientNumber: "P00000001" },
    });
    // Never the payload: no PIN, no names beyond the patient brief.
    expect(JSON.stringify(list.body)).not.toMatch(/345678901/);

    const all = await api(admin).get("/integrations/exchanges?view=all").expect(200);
    expect(all.body.exchanges).toHaveLength(4);
    expect((await api(admin).get("/integrations/exchanges?view=all&status=accepted").expect(200)).body.exchanges).toEqual([
      expect.objectContaining({ id: ids.accepted, externalReference: "ELIG-OK" }),
    ]);
  });

  it("re-queues a stalled exchange whose payload is still sealed", async () => {
    const before = ctx.integrations.enqueued.filter((id) => id === ids.queued).length;
    await api(admin).post(`/integrations/exchanges/${ids.queued}/requeue`).expect(200);
    expect(ctx.integrations.enqueued.filter((id) => id === ids.queued)).toHaveLength(before + 1);
    expect((await api(admin).post(`/integrations/exchanges/${ids.failed}/requeue`).expect(422)).body.error.code).toBe("exchange_not_queued");
    await expect(processor.process(ids.queued)).resolves.toBe("accepted");
  });

  it("records a resolution on an unsuccessful exchange without changing its outcome", async () => {
    await api(admin).post(`/integrations/exchanges/${ids.failed}/resolve`, { note: "x" }).expect(400);
    const resolved = await api(admin)
      .post(`/integrations/exchanges/${ids.failed}/resolve`, { note: "PhilHealth outage; checked through PhilHealth's own channel instead" })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: "failed", resolutionNote: "PhilHealth outage; checked through PhilHealth's own channel instead" });
    expect((await api(admin).post(`/integrations/exchanges/${ids.failed}/resolve`, { note: "again" }).expect(422)).body.error.code).toBe("exchange_resolved");
    expect((await api(admin).post(`/integrations/exchanges/${ids.accepted}/resolve`, { note: "nothing" }).expect(422)).body.error.code).toBe(
      "exchange_not_unsuccessful",
    );
    const list = await api(admin).get("/integrations/exchanges").expect(200);
    expect(list.body.exchanges.map((e: { id: string }) => e.id)).toEqual([ids.rejected]);
    expect(list.body.summary).toMatchObject({ needsReview: 1, stalled: 0 });

    const audit = await auditRows(ctx.pool, "action IN ('integration.exchange.requeue', 'integration.exchange.resolve')");
    expect(audit.map((a) => [a.action, a.actor_type])).toEqual([
      ["integration.exchange.requeue", "user"],
      ["integration.exchange.resolve", "user"],
    ]);
    expect(audit[1]!.reason).toMatch(/PhilHealth outage/);
  });
});
