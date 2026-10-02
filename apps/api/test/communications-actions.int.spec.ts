import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Resend and cancel from the communication log, and the navigation badges (migration 0099,
 * docs/domains/notification.md). A resend is a new message through the ordinary path; the original never changes.
 */
describe("communication log actions and badges", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let nurse: string;
  let patientId: string;
  let noContactId: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const registered = { givenName: "Juan", organizationName: "Demo Health", patientNumber: "P00000001" };
  const send = (token: string, patient: string, extra: object = {}) =>
    staff(token).post("/notifications", {
      recipient: { type: "patient", patientId: patient },
      channel: "sms",
      templateKey: "patient.registered",
      variables: registered,
      ...extra,
    });
  const row = async (id: string) =>
    (await ctx.pool.query<{ status: string; resent_from: string | null }>("SELECT status, resent_from FROM notification WHERE id = $1", [id])).rows[0]!;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "comm-actions-org");
    await createStaff(ctx.pool, tenant, "admin@comm.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@comm.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "nurse@comm.ph", ["nurse"]);
    admin = (await login(ctx, "admin@comm.ph")).accessToken;
    desk = (await login(ctx, "desk@comm.ph")).accessToken;
    nurse = (await login(ctx, "nurse@comm.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    noContactId = (
      await staff(admin)
        .post("/patients", { ...juan, familyName: "Walang", givenName: "Numero", birthDate: "1970-01-01", identifiers: [], contacts: [] })
        .expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("cancels a queued message with a reason, never one already sent", async () => {
    const queued = (await send(admin, patientId, { scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body;
    expect(queued.status).toBe("queued");
    await staff(nurse).post(`/communications/${queued.id}/cancel`, { reason: "Patient asked us not to text" }).expect(403);
    await staff(desk).post(`/communications/${queued.id}/cancel`, { reason: "no" }).expect(400);
    const cancelled = await staff(desk).post(`/communications/${queued.id}/cancel`, { reason: "Patient asked us not to text" }).expect(200);
    expect(cancelled.body).toMatchObject({ id: queued.id, status: "cancelled" });
    await staff(desk)
      .post(`/communications/${queued.id}/cancel`, { reason: "Again" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("notification_not_cancellable"));
    const audit = await auditRows(ctx.pool, "action = 'notification.cancel'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: "Patient asked us not to text" });
  });

  it("sends a message again as a new one, re-checking the patient's contact detail, and links the rows", async () => {
    // Suppressed: the patient has no number. Resending before a number exists is suppressed again (and recorded).
    const suppressed = (await send(admin, noContactId).expect(201)).body;
    expect(suppressed.status).toBe("suppressed");
    const again = await staff(desk).post(`/communications/${suppressed.id}/resend`, { reason: "Number added" }).expect(201);
    expect(again.body).toMatchObject({ status: "suppressed", resentFrom: suppressed.id });
    // Now with a number: the next resend goes out as a new queued message.
    await ctx.pool.query(
      `INSERT INTO patient_contact_point (organization_id, patient_id, system, value, value_normalized, is_primary, created_by)
       SELECT $1, $2, 'mobile', '0917 000 0001', '+639170000001', true, id FROM app_user WHERE email = 'admin@comm.ph'`,
      [tenant.organizationId, noContactId],
    );
    const sent = await staff(desk).post(`/communications/${suppressed.id}/resend`, { reason: "Number added" }).expect(201);
    expect(sent.body).toMatchObject({ status: "queued", resentFrom: suppressed.id, templateKey: "patient.registered" });
    expect(sent.body.id).not.toBe(suppressed.id);
    expect(await row(suppressed.id)).toMatchObject({ status: "suppressed", resent_from: null });
    // A message already sent again (queued) is not resent a third time; the log shows the link both ways.
    await staff(desk)
      .post(`/communications/${suppressed.id}/resend`, { reason: "Once more" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("notification_already_resent"));
    const today = new Date().toISOString().slice(0, 10);
    const log = (await staff(admin).get(`/communications?from=${today}&to=${today}&patientId=${noContactId}`).expect(200)).body.items as Array<{
      id: string;
      resentFrom: string | null;
      resentAs: string | null;
    }>;
    expect(log.find((m) => m.id === suppressed.id)).toMatchObject({ resentFrom: null, resentAs: sent.body.id });
    expect(log.find((m) => m.id === sent.body.id)).toMatchObject({ resentFrom: suppressed.id, resentAs: null });
    const audit = await auditRows(ctx.pool, "action = 'notification.resend'");
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).toMatch(/Number added/);
  });

  it("refuses a resend of a sent message, a security message, an old message, and for staff without the permission", async () => {
    const queued = (await send(admin, patientId).expect(201)).body;
    await staff(desk)
      .post(`/communications/${queued.id}/resend`, { reason: "Why not" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("notification_not_resendable"));
    await ctx.pool.query("UPDATE notification SET status = 'failed', failed_at = now() WHERE id = $1", [queued.id]);
    await staff(nurse).post(`/communications/${queued.id}/resend`, { reason: "Why not" }).expect(403);
    await ctx.pool.query("UPDATE notification SET created_at = now() - interval '31 days' WHERE id = $1", [queued.id]);
    await staff(desk)
      .post(`/communications/${queued.id}/resend`, { reason: "Too late" })
      .expect(422)
      .expect((r) => expect(r.body.error.details).toMatchObject({ reason: "too_old" }));
    // An internal security message (a password-reset email) is never resent from the log, whatever its state.
    const { rows: security } = await ctx.pool.query<{ id: string }>(
      `INSERT INTO notification (organization_id, recipient_type, recipient_patient_id, channel, category, template_key, template_version, status, failed_at, destination)
       VALUES ($1, 'patient', $2, 'email', 'security', 'portal.password-reset', 1, 'failed', now(), 'juan@example.ph') RETURNING id`,
      [tenant.organizationId, patientId],
    );
    await staff(desk)
      .post(`/communications/${security[0]!.id}/resend`, { reason: "Security" })
      .expect(422)
      .expect((r) => expect(r.body.error.details).toMatchObject({ reason: "template" }));
    // Staff inbox messages are not part of the log and cannot be touched from it.
    const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM notification WHERE recipient_type = 'user' LIMIT 1");
    if (rows[0]) await staff(desk).post(`/communications/${rows[0].id}/resend`, { reason: "Nope" }).expect(404);
  });

  it("counts for the navigation only what the user may see", async () => {
    const forAdmin = (await staff(admin).get("/me/badges").expect(200)).body;
    expect(forAdmin).toEqual({ messagesAwaiting: 0, messagesOverdue: 0, criticalResults: 0, recordsRequests: 0, caseReports: 0 });
    const forNurse = (await staff(nurse).get("/me/badges").expect(200)).body;
    expect(forNurse).toMatchObject({ messagesAwaiting: 0, criticalResults: 0, recordsRequests: null, caseReports: null });
    // Without a facility the critical-result count is withheld.
    const noFacility = (await ctx.http().get("/api/v1/me/badges").set(as(admin)).expect(200)).body;
    expect(noFacility.criticalResults).toBeNull();
  });
});
