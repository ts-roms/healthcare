import { CrmCampaignRuns } from "@healthcare/crm";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Outreach (docs/domains/crm.md): segments from non-clinical criteria, campaigns approved by a second person, sent
 * through the notification service under each patient's outreach opt-in, and the opt-out link.
 */
describe("outreach segments and campaigns", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let adminId: string;
  let approver: string;
  let auditor: string;
  let runs: CrmCampaignRuns;
  let optedIn: string;
  let notOptedIn: string;
  let segmentId: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: "https://myhealth.test.invalid" });
    tenant = await createTenant(ctx.pool, "crm-org");
    adminId = await createStaff(ctx.pool, tenant, "admin@crm.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "second@crm.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "auditor@crm.ph", ["auditor"]);
    admin = (await login(ctx, "admin@crm.ph")).accessToken;
    approver = (await login(ctx, "second@crm.ph")).accessToken;
    auditor = (await login(ctx, "auditor@crm.ph")).accessToken;
    runs = ctx.app.get(CrmCampaignRuns);
    // Two women over 50 in Makati: one opted in to text-message outreach, one who never answered.
    optedIn = (
      await api(admin)
        .post("/patients", {
          ...juan,
          identifiers: [],
          familyName: "Reyes",
          givenName: "Maria",
          sex: "female",
          birthDate: "1965-05-05",
          contacts: [{ system: "mobile", value: "0917 111 2222" }],
        })
        .expect(201)
    ).body.id;
    notOptedIn = (
      await api(admin)
        .post("/patients", {
          ...juan,
          identifiers: [],
          familyName: "Santos",
          givenName: "Ana",
          sex: "female",
          birthDate: "1970-01-01",
          contacts: [{ system: "mobile", value: "0917 333 4444" }],
        })
        .expect(201)
    ).body.id;
    // A man, left out by the segment.
    await api(admin)
      .post("/patients", { ...juan, identifiers: [], contacts: [{ system: "mobile", value: "0917 555 6666" }] })
      .expect(201);
    await api(admin)
      .put(`/patients/${optedIn}/communication-preferences`, { preferences: [{ channel: "sms", category: "outreach", optedIn: true }] })
      .expect(200);
  });
  afterAll(() => ctx.close());

  it("defines a segment from non-clinical criteria and previews who matches (audited)", async () => {
    await api(admin).post("/outreach/segments", { name: "Women 50+", criteria: {} }).expect(400); // at least one criterion
    await api(admin)
      .post("/outreach/segments", { name: "By diagnosis", criteria: { diagnosisCode: "E11" } })
      .expect(400);
    const segment = (
      await api(admin)
        .post("/outreach/segments", { name: "Women 50+ in Makati", criteria: { ageMin: 50, sex: "female", cityMunicipality: "makati city" } })
        .expect(201)
    ).body;
    segmentId = segment.id;
    const preview = (await api(admin).get(`/outreach/segments/${segmentId}/preview`).expect(200)).body;
    expect(preview.total).toBe(2);
    expect(preview.members.map((m: { displayName: string }) => m.displayName)).toEqual(["REYES, Maria Santos", "SANTOS, Ana Santos"]);
    expect(Object.keys(preview.members[0])).toEqual(["patientId", "patientNumber", "displayName", "sex", "age"]);
    expect(await auditRows(ctx.pool, `action = 'crm.segment.preview' AND resource_id = $1`, [segmentId])).toHaveLength(1);
    // Only those opted in to text messages.
    const narrow = (
      await api(admin)
        .post("/outreach/segments", { name: "Opted in", criteria: { optedInChannel: "sms" } })
        .expect(201)
    ).body;
    expect((await api(admin).get(`/outreach/segments/${narrow.id}/preview`).expect(200)).body.total).toBe(1);
    await api(auditor).get("/outreach/segments").expect(403);
  });

  it("needs a second person to approve, then sends under each patient's opt-in and records every outcome", async () => {
    const draft = (
      await api(admin)
        .post("/outreach/campaigns", {
          segmentId,
          name: "Flu shots",
          channels: ["sms"],
          body: "Flu vaccines are available at the clinic this month. Call us to book.",
        })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({ status: "draft", createdBy: adminId, version: 1 });
    // Wording that does not fit the channel is refused.
    await api(admin)
      .post("/outreach/campaigns", { segmentId, name: "Too long", channels: ["sms"], body: "x".repeat(400) })
      .expect(422);
    const submitted = (await api(admin).post(`/outreach/campaigns/${draft.id}/submit`, { version: draft.version }).expect(201)).body;
    expect(submitted.status).toBe("submitted");
    const own = await api(admin).post(`/outreach/campaigns/${draft.id}/approve`, { version: submitted.version }).expect(403);
    expect(own.body.error.code).toBe("approver_is_author");
    const approved = (await api(approver).post(`/outreach/campaigns/${draft.id}/approve`, { version: submitted.version }).expect(201)).body;
    expect(approved).toMatchObject({ status: "approved" });
    // A draft cannot change once approved.
    await api(admin)
      .put(`/outreach/campaigns/${draft.id}`, {
        segmentId,
        name: "Flu shots",
        channels: ["sms"],
        body: "Changed wording after approval, not allowed.",
        version: approved.version,
      })
      .expect(422);

    const first = await runs.tick();
    expect(first).toEqual({ campaigns: 1, deliveries: 2 });
    expect(await runs.tick()).toEqual({ campaigns: 0, deliveries: 0 });

    const done = (await api(admin).get(`/outreach/campaigns/${draft.id}`).expect(200)).body;
    expect(done.status).toBe("completed");
    expect(done.summary).toEqual({
      patients: 2,
      byChannel: [{ channel: "sms", queued: 1, delivered: 0, suppressed: 1, failed: 0 }],
      suppressedByReason: [{ reason: "no_outreach_opt_in", total: 1 }],
    });
    const notices = await ctx.pool.query<{ recipient_patient_id: string; status: string; suppression_reason: string | null; category: string }>(
      "SELECT recipient_patient_id, status, suppression_reason, category FROM notification WHERE template_key = 'outreach.campaign' ORDER BY status",
    );
    expect(notices.rows).toEqual([
      { recipient_patient_id: optedIn, status: "queued", suppression_reason: null, category: "outreach" },
      { recipient_patient_id: notOptedIn, status: "suppressed", suppression_reason: "no_outreach_opt_in", category: "outreach" },
    ]);
    expect(await auditRows(ctx.pool, `action = 'crm.campaign.run' AND resource_id = $1`, [draft.id])).toHaveLength(1);
    expect(await auditRows(ctx.pool, `action = 'crm.campaign.approve' AND resource_id = $1`, [draft.id])).toHaveLength(1);
    // The delivery record is append-only.
    await expect(ctx.pool.query("DELETE FROM crm_campaign_delivery WHERE campaign_id = $1", [draft.id])).rejects.toThrow(/append-only/);
  });

  it("puts a single-use opt-out link in outreach emails and records the opt-out", async () => {
    await ctx.pool.query(`UPDATE patient_contact_point SET is_primary = true WHERE patient_id = $1`, [optedIn]);
    await ctx.pool.query(
      `INSERT INTO patient_contact_point (organization_id, patient_id, system, value, value_normalized, is_primary, created_by) VALUES ($1, $2, 'email', 'maria@example.ph', 'maria@example.ph', true, $3)`,
      [tenant.organizationId, optedIn, adminId],
    );
    await api(admin)
      .put(`/patients/${optedIn}/communication-preferences`, { preferences: [{ channel: "email", category: "outreach", optedIn: true }] })
      .expect(200);
    const draftRes = await api(admin).post("/outreach/campaigns", {
      segmentId,
      name: "Newsletter",
      channels: ["email"],
      subject: "News from the clinic",
      body: "Our new annex opens on Monday. Read more on our website.",
    });
    const draft = draftRes.body;
    const submittedRes = await api(admin).post(`/outreach/campaigns/${draft.id}/submit`, { version: draft.version });
    const submitted = submittedRes.body;
    await api(approver).post(`/outreach/campaigns/${draft.id}/approve`, { version: submitted.version }).expect(201);
    await runs.tick();
    const [notice] = (
      await ctx.pool.query<{ variables: { optOutLink?: string; body: string } }>(
        "SELECT variables FROM notification WHERE template_key = 'outreach.campaign' AND channel = 'email' AND recipient_patient_id = $1",
        [optedIn],
      )
    ).rows;
    expect(notice!.variables.optOutLink).toMatch(/^https:\/\/myhealth\.test\.invalid\/outreach\/opt-out\?token=/);
    const token = new URL(notice!.variables.optOutLink!).searchParams.get("token")!;
    const first = await ctx.http().post("/api/v1/outreach/opt-out").send({ token }).expect(201);
    expect(first.body).toEqual({ recorded: true, channel: "email" });
    const again = await ctx.http().post("/api/v1/outreach/opt-out").send({ token }).expect(201);
    expect(again.body).toEqual({ recorded: false });
    const prefs = await ctx.pool.query<{ opted_in: boolean }>(
      "SELECT opted_in FROM patient_communication_preference WHERE patient_id = $1 AND channel = 'email' AND category = 'outreach'",
      [optedIn],
    );
    expect(prefs.rows[0]).toEqual({ opted_in: false });
    expect(await auditRows(ctx.pool, `action = 'patient.communication-preferences' AND patient_id = $1`, [optedIn])).toHaveLength(3);
  });

  it("cancels with a reason, archives only unused segments and refuses the auditor", async () => {
    const draft = (
      await api(admin)
        .post("/outreach/campaigns", { segmentId, name: "Later", channels: ["sms"], body: "A message we will not send after all." })
        .expect(201)
    ).body;
    await api(admin).post(`/outreach/segments/${segmentId}/archive`, { version: 1 }).expect(422);
    await api(admin).post(`/outreach/campaigns/${draft.id}/cancel`, { version: draft.version, reason: "Not needed" }).expect(201);
    const archived = (await api(admin).post(`/outreach/segments/${segmentId}/archive`, { version: 1 }).expect(201)).body;
    expect(archived.status).toBe("archived");
    await api(auditor)
      .post("/outreach/campaigns", { segmentId, name: "x", channels: ["sms"], body: "Nobody may send this message." })
      .expect(403);
  });
});
