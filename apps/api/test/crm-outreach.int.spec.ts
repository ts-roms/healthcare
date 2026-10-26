import { CrmCampaignRuns } from "@healthcare/crm";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

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
    runs = underPlatform(ctx.app.get(CrmCampaignRuns));
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
      heldForQuietHours: 0,
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

  /** A campaign from draft to sent: drafted by one administrator, approved by the other, then the runner's pass. */
  const sendCampaign = async (body: object, now?: Date) => {
    const draft = (await api(admin).post("/outreach/campaigns", body).expect(201)).body;
    const submitted = (await api(admin).post(`/outreach/campaigns/${draft.id}/submit`, { version: draft.version }).expect(201)).body;
    await api(approver).post(`/outreach/campaigns/${draft.id}/approve`, { version: submitted.version }).expect(201);
    await runs.tick(now);
    return (await api(admin).get(`/outreach/campaigns/${draft.id}`).expect(200)).body as {
      id: string;
      includeBookingLink: boolean;
      summary: { patients: number; heldForQuietHours: number; suppressedByReason: Array<{ reason: string; total: number }> };
    };
  };
  const deliveries = async (campaignId: string) =>
    (
      await ctx.pool.query<{ patient_id: string; channel: string; outcome: string; reason: string | null; notification_id: string | null }>(
        "SELECT patient_id, channel, outcome, reason, notification_id FROM crm_campaign_delivery WHERE campaign_id = $1 ORDER BY patient_id",
        [campaignId],
      )
    ).rows;
  let reachSegment: string;

  it("shows, before anything is sent, who can actually be messaged on each channel and why the others cannot", async () => {
    reachSegment = (
      await api(admin)
        .post("/outreach/segments", { name: "Women 50+ (reach)", criteria: { ageMin: 50, sex: "female" } })
        .expect(201)
    ).body.id;
    const before = (await ctx.pool.query("SELECT count(*)::int AS n FROM crm_campaign_delivery")).rows[0].n;
    const preview = (await api(admin).get(`/outreach/segments/${reachSegment}/preview`).expect(200)).body;
    expect(preview.total).toBe(2);
    expect(preview.reach).toMatchObject({ evaluated: 2, sampled: false, reachableOnAny: 1, unreachable: 1 });
    const byChannel = Object.fromEntries(preview.reach.byChannel.map((c: { channel: string }) => [c.channel, c]));
    // Only Maria opted in to text messages; Ana never answered.
    expect(byChannel["sms"]).toEqual({ channel: "sms", reachable: 1, notReached: [{ reason: "no_outreach_opt_in", total: 1 }] });
    // Maria turned email off through the opt-out link; nobody has push or MyHealth.
    expect(byChannel["email"]).toEqual({
      channel: "email",
      reachable: 0,
      notReached: [
        { reason: "no_outreach_opt_in", total: 1 },
        { reason: "opted_out", total: 1 },
      ],
    });
    expect(byChannel["push"].reachable).toBe(0);
    expect(byChannel["in_app"].reachable).toBe(0);
    // The reach check changes nothing: no message, no delivery row.
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM crm_campaign_delivery")).rows[0].n).toBe(before);
  });

  it("answers the same for a campaign on its own channels, and says what the organization's limits would do", async () => {
    const draft = (
      await api(admin)
        .post("/outreach/campaigns", {
          segmentId: reachSegment,
          name: "Reach check",
          channels: ["sms", "email"],
          subject: "Hello",
          body: "A short message about our opening hours.",
        })
        .expect(201)
    ).body;
    expect(draft.includeBookingLink).toBe(false);
    const reach = (await api(admin).get(`/outreach/campaigns/${draft.id}/reach`).expect(200)).body;
    expect(reach.byChannel.map((c: { channel: string }) => c.channel)).toEqual(["sms", "email"]);
    expect(reach).toMatchObject({ reachableOnAny: 1, frequencyCap: null, quietHours: null, includeBookingLink: false });
    expect(await auditRows(ctx.pool, `action = 'crm.campaign.reach' AND resource_id = $1`, [draft.id])).toHaveLength(1);
    await api(auditor).get(`/outreach/campaigns/${draft.id}/reach`).expect(403);
  });

  it("keeps the organization's frequency cap and quiet hours, changed only by those who approve campaigns", async () => {
    const defaults = (await api(admin).get("/outreach/settings").expect(200)).body;
    expect(defaults).toEqual({
      frequencyCap: null,
      quietHours: { enabled: false, start: null, end: null, channels: ["sms", "push"] },
      version: 0,
      updatedAt: null,
    });
    const settings = {
      frequencyCap: { maxCampaigns: 1, windowDays: 30 },
      quietHours: { enabled: true, start: "22:00", end: "07:00", channels: ["sms", "push"] },
      version: 0,
    };
    await api(auditor).put("/outreach/settings", settings).expect(403);
    await api(admin)
      .put("/outreach/settings", { ...settings, quietHours: { ...settings.quietHours, end: "22:00" } })
      .expect(400);
    await api(admin)
      .put("/outreach/settings", { ...settings, frequencyCap: { maxCampaigns: 0, windowDays: 30 } })
      .expect(400);
    const saved = (await api(admin).put("/outreach/settings", settings).expect(200)).body;
    expect(saved).toMatchObject({ frequencyCap: { maxCampaigns: 1, windowDays: 30 }, quietHours: { enabled: true, start: "22:00", end: "07:00" }, version: 1 });
    await api(admin).put("/outreach/settings", settings).expect(409); // a stale version
    expect(await auditRows(ctx.pool, "action = 'crm.settings.update' AND organization_id = $1", [tenant.organizationId])).toHaveLength(1);
    // The same limits now show in a campaign's reach: Maria already received two campaigns, so one patient would be held back.
    const draft = (
      await api(admin)
        .post("/outreach/campaigns", { segmentId: reachSegment, name: "With limits", channels: ["sms"], body: "A short message about our opening hours." })
        .expect(201)
    ).body;
    const reach = (await api(admin).get(`/outreach/campaigns/${draft.id}/reach`).expect(200)).body;
    expect(reach.frequencyCap).toEqual({ maxCampaigns: 1, windowDays: 30, heldBack: 1 });
    expect(reach.quietHours).toMatchObject({ start: "22:00", end: "07:00", channels: ["sms"] });
  });

  it("does not message a patient who is already at the frequency cap, and records why", async () => {
    const campaign = await sendCampaign({
      segmentId: reachSegment,
      name: "Second notice",
      channels: ["sms"],
      body: "A second message from the clinic this month.",
    });
    const rows = await deliveries(campaign.id);
    // Maria got two earlier campaigns: held back, no message created. Ana never received one: the opt-in check decides.
    const maria = rows.find((r) => r.patient_id === optedIn);
    expect(maria).toEqual({ patient_id: optedIn, channel: "sms", outcome: "suppressed", reason: "frequency_cap", notification_id: null });
    expect(rows.find((r) => r.patient_id === notOptedIn)).toMatchObject({ outcome: "suppressed", reason: "no_outreach_opt_in" });
    expect(campaign.summary.suppressedByReason).toEqual(
      expect.arrayContaining([
        { reason: "frequency_cap", total: 1 },
        { reason: "no_outreach_opt_in", total: 1 },
      ]),
    );
    expect(
      (await ctx.pool.query("SELECT count(*)::int AS n FROM notification WHERE idempotency_key = $1", [`crm:${campaign.id}:${optedIn}:sms`])).rows[0].n,
    ).toBe(0);
  });

  it("holds text messages and push notices that fall in quiet hours until they end, and sends in the daytime at once", async () => {
    // Lift the cap so this is only about the hour: 23:00 in Manila is inside 22:00-07:00.
    const current = (await api(admin).get("/outreach/settings").expect(200)).body;
    await api(admin)
      .put("/outreach/settings", { ...current, frequencyCap: null })
      .expect(200);
    const night = await sendCampaign(
      { segmentId: reachSegment, name: "Evening notice", channels: ["sms"], body: "An evening message from the clinic." },
      new Date("2026-10-26T15:00:00Z"),
    );
    const held = (await deliveries(night.id)).find((r) => r.patient_id === optedIn)!;
    expect(held).toMatchObject({ outcome: "queued", reason: "held_for_quiet_hours" });
    const scheduled = await ctx.pool.query<{ scheduled_for: Date }>("SELECT scheduled_for FROM notification WHERE id = $1", [held.notification_id]);
    expect(scheduled.rows[0]!.scheduled_for.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(night.summary.heldForQuietHours).toBe(1);

    // 10:00 in Manila: no hold.
    const day = await sendCampaign(
      { segmentId: reachSegment, name: "Morning notice", channels: ["sms"], body: "A morning message from the clinic." },
      new Date("2026-10-27T02:00:00Z"),
    );
    const sent = (await deliveries(day.id)).find((r) => r.patient_id === optedIn)!;
    expect(sent).toMatchObject({ outcome: "queued", reason: null });
    expect((await ctx.pool.query("SELECT scheduled_for FROM notification WHERE id = $1", [sent.notification_id])).rows[0].scheduled_for).toBeNull();
    expect(day.summary.heldForQuietHours).toBe(0);
  });

  it("can end a message with a link to book a visit in MyHealth, counted against the length, and carries nothing about the patient", async () => {
    // 300 characters fit a text message alone, but not with the link.
    await api(admin)
      .post("/outreach/campaigns", { segmentId: reachSegment, name: "Too long with link", channels: ["sms"], body: "x".repeat(300), includeBookingLink: true })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("wording_invalid"));
    const withLink = await sendCampaign(
      {
        segmentId: reachSegment,
        name: "Book a checkup",
        channels: ["sms"],
        body: "Your yearly checkup is due. Book a time that suits you.",
        includeBookingLink: true,
      },
      new Date("2026-10-27T03:00:00Z"),
    );
    expect(withLink.includeBookingLink).toBe(true);
    const variables = (
      await ctx.pool.query<{ variables: { bookingLink?: string; body: string } }>("SELECT variables FROM notification WHERE idempotency_key = $1", [
        `crm:${withLink.id}:${optedIn}:sms`,
      ])
    ).rows[0]!.variables;
    expect(variables.bookingLink).toBe("https://myhealth.test.invalid/appointments/book");
    expect(variables.bookingLink).not.toContain(optedIn);
    // A campaign without it carries none.
    const without = await sendCampaign(
      { segmentId: reachSegment, name: "No link", channels: ["sms"], body: "Our clinic hours change next month." },
      new Date("2026-10-27T03:00:00Z"),
    );
    const plain = (
      await ctx.pool.query<{ variables: Record<string, unknown> }>("SELECT variables FROM notification WHERE idempotency_key = $1", [
        `crm:${without.id}:${optedIn}:sms`,
      ])
    ).rows[0]!.variables;
    expect(plain["bookingLink"]).toBeUndefined();
  });
});
