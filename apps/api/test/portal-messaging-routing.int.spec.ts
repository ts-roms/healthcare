import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";
import { PatientMessageReminders } from "../src/app/portal/patient-message-reminders";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-msg-route";

/**
 * Attachments, staff-only notes, routing by topic and response targets in MyHealth conversations (migration 0097,
 * docs/domains/patient-messaging.md).
 */
describe("MyHealth messaging: attachments, notes, routing and targets", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let receptionist: string;
  let nurseId: string;
  let receptionistId: string;
  let juanId: string;
  let juanToken: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const as_ = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const notices = async (templateKey: string) =>
    (
      await ctx.pool.query<{ recipient_user_id: string | null; variables: Record<string, unknown>; idempotency_key: string }>(
        `SELECT recipient_user_id, variables, idempotency_key FROM notification WHERE template_key = $1 ORDER BY created_at`,
        [templateKey],
      )
    ).rows;

  async function activate(patient: object, email: string): Promise<{ id: string; token: string }> {
    const id = (await staff(admin).post("/patients", patient).expect(201)).body.id as string;
    await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    const token = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
    return { id, token };
  }

  /** A patient's upload: prepared, "put" into the in-memory store, completed. */
  async function upload(token: string, fileName = "rash.jpg", contentType = "image/jpeg", sizeBytes = 1234): Promise<string> {
    const prepared = await as_(token).post("/message-threads/uploads", { title: fileName, fileName, contentType, sizeBytes }).expect(201);
    const documentId = prepared.body.document.id as string;
    expect(prepared.body.upload).toMatchObject({ method: "PUT", url: expect.any(String) });
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [documentId]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes, contentType });
    await as_(token).post(`/message-threads/uploads/${documentId}/complete`).expect(200);
    return documentId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@route.ph", ["org_admin"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@route.ph", ["nurse"]);
    receptionistId = await createStaff(ctx.pool, tenant, "front@route.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@route.ph")).accessToken;
    nurse = (await login(ctx, "nurse@route.ph")).accessToken;
    receptionist = (await login(ctx, "front@route.ph")).accessToken;
    ({ id: juanId, token: juanToken } = await activate(juan, "juan@route.ph"));
  });
  afterAll(() => ctx.close());

  let threadId = "";

  it("lets a patient attach their own finished uploads (images or PDFs), which the clinic opens behind a link", async () => {
    await as_(juanToken)
      .post("/message-threads/uploads", { title: "x", fileName: "x.exe", contentType: "application/octet-stream", sizeBytes: 10 })
      .expect(400);
    await as_(juanToken)
      .post("/message-threads/uploads", { title: "x", fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 11 * 1024 * 1024 })
      .expect(400);
    const pending = (
      await as_(juanToken).post("/message-threads/uploads", { title: "p", fileName: "p.jpg", contentType: "image/jpeg", sizeBytes: 5 }).expect(201)
    ).body.document.id as string;
    const photo = await upload(juanToken);
    const pdf = await upload(juanToken, "referral.pdf", "application/pdf", 4096);

    // Only finished uploads of the patient's own account are attachable.
    await as_(juanToken)
      .post("/message-threads", { topic: "general", subject: "Rash", body: "Is this normal?", documentIds: [pending] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("attachment_not_allowed"));
    await as_(juanToken)
      .post("/message-threads", { topic: "general", subject: "Rash", body: "Is this normal?", documentIds: [photo, pdf, photo, pdf] })
      .expect(400);

    const created = await as_(juanToken)
      .post("/message-threads", { topic: "general", subject: "Rash", body: "Is this normal?", documentIds: [photo, pdf] })
      .expect(201);
    threadId = created.body.id;
    expect(created.body.messages[0].attachments).toEqual([
      expect.objectContaining({ documentId: photo, fileName: "rash.jpg", contentType: "image/jpeg", sizeBytes: 1234 }),
      expect.objectContaining({ documentId: pdf, fileName: "referral.pdf" }),
    ]);
    expect((await as_(juanToken).get(`/message-threads/${threadId}/attachments/${photo}/link`).expect(200)).body).toMatchObject({ url: expect.any(String) });

    const detail = (await staff(nurse).get(`/patient-messages/${threadId}`).expect(200)).body;
    expect(detail.messages[0].attachments).toHaveLength(2);
    expect((await staff(nurse).get(`/patient-messages/${threadId}/attachments/${photo}/link`).expect(200)).body).toMatchObject({ url: expect.any(String) });
    // The staff link is only for attachments of that conversation.
    await staff(nurse).get(`/patient-messages/${threadId}/attachments/${pending}/link`).expect(404);
    // Attachments are recorded with their message; nothing is rewritten.
    await expect(ctx.pool.query("DELETE FROM patient_message_attachment")).rejects.toThrow();
    expect((await auditRows(ctx.pool, "action = 'document.download'")).length).toBeGreaterThanOrEqual(2);
  });

  it("limits a patient to ten uploads a day", async () => {
    for (let i = 0; i < 7; i++) await upload(juanToken, `more-${i}.png`, "image/png", 10);
    await as_(juanToken)
      .post("/message-threads/uploads", { title: "x", fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 10 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("upload_rate_limited"));
  });

  it("lets the clinic attach the patient's documents to a reply, never another patient's", async () => {
    const other = (
      await staff(admin)
        .post("/patients", {
          ...juan,
          familyName: "Santos",
          givenName: "Pedro",
          birthDate: "1975-03-03",
          identifiers: [],
          contacts: [{ system: "mobile", value: "0917 111 2222" }],
        })
        .expect(201)
    ).body.id as string;
    const foreign = (
      await staff(admin)
        .post("/documents", {
          patientId: other,
          category: "clinical_attachment",
          title: "Not his",
          fileName: "n.pdf",
          contentType: "application/pdf",
          sizeBytes: 20,
        })
        .expect(201)
    ).body.document.id as string;
    const own = (
      await staff(admin)
        .post("/documents", {
          patientId: juanId,
          category: "clinical_attachment",
          title: "Instructions",
          fileName: "i.pdf",
          contentType: "application/pdf",
          sizeBytes: 20,
        })
        .expect(201)
    ).body.document.id as string;
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [own]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 20, contentType: "application/pdf" });
    await staff(admin).post(`/documents/${own}/complete`).expect(200);

    await staff(nurse)
      .post(`/patient-messages/${threadId}/messages`, { body: "See attached", documentIds: [foreign] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("attachment_not_allowed"));
    const replied = await staff(nurse)
      .post(`/patient-messages/${threadId}/messages`, { body: "See attached", documentIds: [own] })
      .expect(201);
    expect(replied.body.messages.at(-1).attachments).toEqual([expect.objectContaining({ documentId: own, title: "Instructions" })]);
    const patientView = (await as_(juanToken).get(`/message-threads/${threadId}`).expect(200)).body;
    expect(patientView.messages.at(-1).attachments).toEqual([expect.objectContaining({ documentId: own })]);
    expect((await as_(juanToken).get(`/message-threads/${threadId}/attachments/${own}/link`).expect(200)).body.url).toEqual(expect.any(String));
  });

  it("keeps staff notes with the conversation and out of the patient's view", async () => {
    const noted = await staff(nurse).post(`/patient-messages/${threadId}/notes`, { body: "Checked with Dr. Cruz: benign, advise moisturiser." }).expect(201);
    expect(noted.body.notes).toEqual([expect.objectContaining({ body: "Checked with Dr. Cruz: benign, advise moisturiser.", authorName: "nurse@route.ph" })]);
    expect(noted.body.noteCount).toBe(1);
    expect(noted.body.messageCount).toBe(2);
    await staff(nurse).post(`/patient-messages/${threadId}/notes`, { body: " " }).expect(400);
    const patientView = JSON.stringify((await as_(juanToken).get(`/message-threads/${threadId}`).expect(200)).body);
    expect(patientView).not.toMatch(/Dr\. Cruz|moisturiser|notes/);
    expect(JSON.stringify((await as_(juanToken).get("/message-threads").expect(200)).body)).not.toMatch(/moisturiser/);
    await expect(ctx.pool.query("UPDATE patient_message_note SET body = 'x'")).rejects.toThrow();
    expect(JSON.stringify(await auditRows(ctx.pool, "action = 'patient.message-note'"))).not.toMatch(/moisturiser/);
    // Only people who may reply write notes; readers see them.
    const queue = (await staff(nurse).get("/patient-messages?filter=all").expect(200)).body as Array<{ id: string; noteCount: number }>;
    expect(queue.find((t) => t.id === threadId)?.noteCount).toBe(1);
  });

  it("routes a topic to a role or a person, assigns on arrival when asked, and tells only them", async () => {
    await staff(nurse).put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "billing", routeRoleKey: "receptionist" }).expect(403);
    await staff(admin)
      .put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "billing", routeRoleKey: "receptionist", routeUserId: nurseId })
      .expect(400);
    await staff(admin).put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "billing", autoAssign: true }).expect(400);
    const byRole = await staff(admin)
      .put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "billing", routeRoleKey: "receptionist", responseTargetHours: 24 })
      .expect(200);
    expect(byRole.body).toMatchObject({
      topic: "billing",
      routeRoleKey: "receptionist",
      routeUserId: null,
      autoAssign: false,
      responseTargetHours: 24,
      version: 1,
    });
    const toPerson = await staff(admin)
      .put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "medication", routeUserId: nurseId, autoAssign: true, responseTargetHours: 4 })
      .expect(200);
    expect(toPerson.body).toMatchObject({ routeUserId: nurseId, routeUserName: "nurse@route.ph", autoAssign: true });
    // Stale version → conflict.
    await staff(admin).put("/patient-messages/settings", { facilityId: tenant.facilityId, topic: "billing", responseTargetHours: 48, version: 5 }).expect(409);
    expect((await staff(receptionist).get(`/patient-messages/settings?facilityId=${tenant.facilityId}`).expect(200)).body).toHaveLength(2);

    await drainEvents(ctx);
    const before = (await notices("portal.message-new")).length;
    const billing = (await as_(juanToken).post("/message-threads", { topic: "billing", subject: "My bill", body: "Is this paid?" }).expect(201)).body;
    await drainEvents(ctx);
    const billingNotices = (await notices("portal.message-new")).slice(before);
    expect(billingNotices.map((n) => n.recipient_user_id)).toEqual([receptionistId]);
    const inQueue = (await staff(admin).get(`/patient-messages?filter=awaiting`).expect(200)).body as Array<{
      id: string;
      assignedTo: unknown;
      responseDueAt: string | null;
      overdue: boolean;
    }>;
    const billingRow = inQueue.find((t) => t.id === billing.id)!;
    expect(billingRow.assignedTo).toBeNull();
    expect(new Date(billingRow.responseDueAt!).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(billingRow.overdue).toBe(false);

    const medication = (await as_(juanToken).post("/message-threads", { topic: "medication", subject: "Dose", body: "Morning or night?" }).expect(201)).body;
    await drainEvents(ctx);
    const medicationNotices = (await notices("portal.message-new")).slice(before + 1);
    expect(medicationNotices.map((n) => n.recipient_user_id)).toEqual([nurseId]);
    const medicationRow = (
      (await staff(admin).get(`/patient-messages?filter=awaiting`).expect(200)).body as Array<{ id: string; assignedTo: { id: string } | null }>
    ).find((t) => t.id === medication.id)!;
    expect(medicationRow.assignedTo).toEqual(expect.objectContaining({ id: nurseId }));
    const audited = await ctx.pool.query<{ changes: unknown }>(
      "SELECT changes FROM audit_event WHERE action = 'patient.message-settings-update' ORDER BY occurred_at",
    );
    expect(JSON.stringify(audited.rows.map((r) => r.changes))).toMatch(/receptionist/);
  });

  it("marks conversations past their target, reminds the responsible people once per breach, and clears it on reply", async () => {
    const reminders = ctx.app.get(PatientMessageReminders);
    expect(await reminders.run()).toBe(0);
    expect((await staff(admin).get("/patient-messages/overdue-count").expect(200)).body).toEqual({ overdue: 0 });

    const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM patient_message_thread WHERE topic = 'billing' AND patient_id = $1", [juanId]);
    const overdueId = rows[0]!.id;
    await ctx.pool.query("UPDATE patient_message_thread SET response_due_at = now() - interval '1 hour' WHERE id = $1", [overdueId]);
    expect((await staff(admin).get("/patient-messages/overdue-count").expect(200)).body).toEqual({ overdue: 1 });
    const queue = (await staff(admin).get("/patient-messages?filter=awaiting").expect(200)).body as Array<{ id: string; overdue: boolean }>;
    expect(queue.find((t) => t.id === overdueId)?.overdue).toBe(true);

    expect(await reminders.run()).toBe(1);
    expect(await reminders.run()).toBe(0);
    const reminded = await notices("portal.message-overdue");
    expect(reminded.map((n) => n.recipient_user_id)).toEqual([receptionistId]);
    expect(reminded[0]!.variables).toEqual({ threadId: overdueId });

    // A reply clears the target; the next patient message starts a new one.
    const replied = await staff(receptionist).post(`/patient-messages/${overdueId}/messages`, { body: "Paid in full." }).expect(201);
    expect(replied.body.responseDueAt).toBeNull();
    expect(replied.body.overdue).toBe(false);
    expect((await staff(admin).get("/patient-messages/overdue-count").expect(200)).body).toEqual({ overdue: 0 });
    const again = await as_(juanToken).post(`/message-threads/${overdueId}/messages`, { body: "Thanks, and the other one?" }).expect(201);
    expect(again.body.id).toBe(overdueId);
    const row = (
      await ctx.pool.query<{ response_due_at: string; overdue_notified_at: string | null }>(
        "SELECT response_due_at, overdue_notified_at FROM patient_message_thread WHERE id = $1",
        [overdueId],
      )
    ).rows[0]!;
    expect(new Date(row.response_due_at).getTime()).toBeGreaterThan(Date.now());
    // A later breach of the new target is reminded again.
    await ctx.pool.query("UPDATE patient_message_thread SET response_due_at = now() - interval '1 minute' WHERE id = $1", [overdueId]);
    expect(await reminders.run()).toBe(1);
    expect(await notices("portal.message-overdue")).toHaveLength(2);
  });
});
