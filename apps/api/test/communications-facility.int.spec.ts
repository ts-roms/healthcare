import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * The facility a message was sent from, and the communication log read per facility (migration 0106,
 * docs/domains/notification.md): a send records the actor's facility; a member whose `notification.read` is scoped
 * to facilities sees only those facilities' messages and never unrecorded ones; the CSV names the facility.
 */
describe("communication log per facility", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let annexDesk: string;
  let patientId: string;
  const today = new Date().toISOString().slice(0, 10);
  const period = `from=${today}&to=${today}`;
  const registered = { givenName: "Juan", organizationName: "Demo Health", patientNumber: "P00000001" };

  const send = (token: string, facilityId: string | undefined) =>
    ctx
      .http()
      .post("/api/v1/notifications")
      .set(as(token, facilityId))
      .send({ recipient: { type: "patient", patientId }, channel: "sms", templateKey: "patient.registered", variables: registered });
  // A facility-scoped member's permissions apply within that facility, so they read the log acting in it.
  const log = (token: string, query = "", facility?: string) => ctx.http().get(`/api/v1/communications?${period}${query}`).set(as(token, facility));
  const summary = (token: string, query = "", facility?: string) => ctx.http().get(`/api/v1/communications/summary?${period}${query}`).set(as(token, facility));

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "comm-facility-org");
    await createStaff(ctx.pool, tenant, "admin@commfac.ph", ["org_admin"]);
    // A receptionist whose role (and so notification.read) is scoped to the annex only.
    await createStaff(ctx.pool, tenant, "annex@commfac.ph", [{ role: "receptionist", facilityId: tenant.otherFacilityId }]);
    admin = (await login(ctx, "admin@commfac.ph")).accessToken;
    annexDesk = (await login(ctx, "annex@commfac.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("records the facility the request acted in, or none outside a facility", async () => {
    const main = (await send(admin, tenant.facilityId).expect(201)).body;
    const annex = (await send(admin, tenant.otherFacilityId).expect(201)).body;
    const nowhere = (await send(admin, undefined).expect(201)).body;
    const rows = await ctx.pool.query<{ id: string; facility_id: string | null }>("SELECT id, facility_id FROM notification WHERE id = ANY($1)", [
      [main.id, annex.id, nowhere.id],
    ]);
    const byId = new Map(rows.rows.map((r) => [r.id, r.facility_id]));
    expect(byId.get(main.id)).toBe(tenant.facilityId);
    expect(byId.get(annex.id)).toBe(tenant.otherFacilityId);
    expect(byId.get(nowhere.id)).toBeNull();
    const audit = await auditRows(ctx.pool, "action = 'notification.create' AND resource_id = $1", [annex.id]);
    expect(audit[0]!.metadata).toMatchObject({ facilityId: tenant.otherFacilityId });
  });

  it("shows an organization-wide reader everything, with the facility's name, and lets them filter one facility", async () => {
    const all = (await log(admin).expect(200)).body as { scope: null; items: Array<{ facilityId: string | null; facilityName: string | null }> };
    expect(all.scope).toBeNull();
    expect(all.items).toHaveLength(3);
    expect(all.items.map((i) => i.facilityName).sort()).toEqual([null, "Annex Clinic", "Main Clinic"].sort());
    const annexOnly = (await log(admin, `&facilityId=${tenant.otherFacilityId}`).expect(200)).body;
    expect(annexOnly.items).toHaveLength(1);
    expect(annexOnly.items[0]).toMatchObject({ facilityId: tenant.otherFacilityId, facilityName: "Annex Clinic" });
    expect((await summary(admin).expect(200)).body).toMatchObject({ total: 3, scope: null });
    expect((await summary(admin, `&facilityId=${tenant.facilityId}`).expect(200)).body.total).toBe(1);
    await log(admin, "&facilityId=11111111-1111-4111-8111-111111111111").expect(404);
    const csv = (await ctx.http().get(`/api/v1/communications/export?${period}`).set(as(admin)).expect(200)).text;
    expect(csv).toContain("Facility");
    expect(csv).toContain("Annex Clinic");
    expect(csv).toContain("Not recorded");
  });

  it("shows a facility-scoped reader only their facilities' messages, never unrecorded ones, and refuses another facility with an audited denial", async () => {
    const annex = tenant.otherFacilityId;
    const scoped = (await log(annexDesk, "", annex).expect(200)).body as { scope: string[]; items: Array<{ facilityId: string | null }> };
    expect(scoped.scope).toEqual([annex]);
    expect(scoped.items.map((i) => i.facilityId)).toEqual([annex]);
    expect((await summary(annexDesk, "", annex).expect(200)).body).toMatchObject({ total: 1, scope: [annex] });
    await log(annexDesk, `&facilityId=${tenant.facilityId}`, annex).expect(403);
    await summary(annexDesk, `&facilityId=${tenant.facilityId}`, annex).expect(403);
    await ctx.http().get(`/api/v1/communications/export?${period}&facilityId=${tenant.facilityId}`).set(as(annexDesk, annex)).expect(403);
    const denials = await auditRows(ctx.pool, "action IN ('notification.log.view', 'notification.log.export') AND outcome = 'denied'");
    expect(denials).toHaveLength(3);
    expect(denials[0]!.reason).toBe("facility_out_of_scope");
  });

  it("keeps the original's facility on a message sent again from the log", async () => {
    const [unsent] = (
      await ctx.pool.query<{ id: string }>("SELECT id FROM notification WHERE facility_id = $1 AND recipient_patient_id = $2 LIMIT 1", [
        tenant.otherFacilityId,
        patientId,
      ])
    ).rows;
    await ctx.pool.query("UPDATE notification SET status = 'failed', failed_at = now() WHERE id = $1", [unsent!.id]);
    const again = (
      await ctx.http().post(`/api/v1/communications/${unsent!.id}/resend`).set(as(admin, tenant.facilityId)).send({ reason: "Provider was down" }).expect(201)
    ).body;
    expect((await ctx.pool.query("SELECT facility_id FROM notification WHERE id = $1", [again.id])).rows[0]).toEqual({ facility_id: tenant.otherFacilityId });
  });
});
