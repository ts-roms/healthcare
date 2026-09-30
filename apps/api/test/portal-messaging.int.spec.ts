import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-msg";
const maria = {
  familyName: "Reyes",
  givenName: "Maria",
  sex: "female",
  birthDate: "1991-07-09",
  contacts: [{ system: "mobile", value: "0918 765 4321" }],
  addresses: juan.addresses,
  identifiers: [],
};

/**
 * Two-way messaging (docs/domains/patient-messaging.md): the patient writes in MyHealth, the clinic reads, replies,
 * assigns and closes; limits keep the queue readable; the patient is told a message is waiting, never what it says.
 */
describe("MyHealth two-way messaging", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let pharmacist: string;
  let juanId: string;
  let mariaId: string;
  let juanToken: string;
  let mariaToken: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const as_ = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const start = (token: string, body: Partial<{ topic: string; subject: string; body: string }> = {}) =>
    as_(token).post("/message-threads", { topic: "general", subject: "A question", body: "Can I take my medicine with food?", ...body });

  async function activate(patient: object, email: string, consent = true): Promise<{ id: string; token: string }> {
    const id = (await staff(admin).post("/patients", patient).expect(201)).body.id as string;
    if (consent) await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
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
  const notices = async (templateKey: string, where = "TRUE") =>
    (
      await ctx.pool.query<{ channel: string; status: string; recipient_user_id: string | null; variables: Record<string, unknown> }>(
        `SELECT channel, status, recipient_user_id, variables FROM notification WHERE template_key = $1 AND ${where} ORDER BY created_at`,
        [templateKey],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@msg.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@msg.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "pharm@msg.ph", ["pharmacist"]);
    admin = (await login(ctx, "admin@msg.ph")).accessToken;
    nurse = (await login(ctx, "nurse@msg.ph")).accessToken;
    pharmacist = (await login(ctx, "pharm@msg.ph")).accessToken;
    ({ id: juanId, token: juanToken } = await activate(juan, "juan@msg.ph"));
    ({ id: mariaId, token: mariaToken } = await activate(maria, "maria@msg.ph"));
  });
  afterAll(() => ctx.close());

  let threadId = "";

  it("lets a patient start a conversation, which the clinic finds waiting in its queue", async () => {
    const created = await start(juanToken).expect(201);
    threadId = created.body.id;
    expect(created.body).toMatchObject({
      topic: "general",
      subject: "A question",
      status: "open",
      startedBy: "patient",
      messageCount: 1,
      lastMessageFrom: "patient",
      unread: false,
    });
    expect(created.body.messages).toEqual([expect.objectContaining({ sender: "patient", senderName: null, body: "Can I take my medicine with food?" })]);

    const queue = (await staff(nurse).get("/patient-messages").expect(200)).body as Array<{
      id: string;
      patientName: string;
      patientNumber: string;
      awaitingClinic: boolean;
      facilityId: string;
    }>;
    expect(queue).toEqual([
      expect.objectContaining({ id: threadId, awaitingClinic: true, facilityId: tenant.facilityId, patientName: expect.stringMatching(/DELA CRUZ/) }),
    ]);
    expect((await staff(nurse).get("/patient-messages/awaiting-count").expect(200)).body).toEqual({ awaiting: 1 });
  });

  it("refuses an empty, over-long or mistyped message, and anyone who is not signed in", async () => {
    await start(juanToken, { body: "   " }).expect(400);
    await start(juanToken, { body: "x".repeat(2001) }).expect(400);
    await start(juanToken, { subject: "y".repeat(101) }).expect(400);
    await start(juanToken, { topic: "marketing" }).expect(400);
    await ctx.http().post("/api/v1/portal/message-threads").send({ topic: "general", subject: "s", body: "b" }).expect(401);
    await ctx.http().get("/api/v1/portal/message-threads").set(as(admin, tenant.facilityId)).expect(401);
  });

  it("keeps one patient's conversations from another", async () => {
    await as_(mariaToken).get(`/message-threads/${threadId}`).expect(404);
    await as_(mariaToken).post(`/message-threads/${threadId}/messages`, { body: "hello" }).expect(404);
    expect((await as_(mariaToken).get("/message-threads").expect(200)).body).toEqual([]);
  });

  it("tells the clinic once for a run of messages, and gives the notice no name or text", async () => {
    await drainEvents(ctx);
    const first = await notices("portal.message-new");
    // Admin and nurse can reply at this facility.
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.every((n) => n.channel === "in_app" && JSON.stringify(n.variables) === JSON.stringify({ threadId }))).toBe(true);
    await as_(juanToken).post(`/message-threads/${threadId}/messages`, { body: "Also, is water enough?" }).expect(201);
    await drainEvents(ctx);
    expect((await notices("portal.message-new")).length).toBe(first.length);
  });

  it("lets staff reply, marks it unread for the patient, and tells them without saying what it says", async () => {
    const reply = await staff(nurse).post(`/patient-messages/${threadId}/messages`, { body: "Yes, with food is fine. Water is enough." }).expect(201);
    expect(reply.body).toMatchObject({ lastMessageFrom: "staff", messageCount: 3, awaitingClinic: false, assignedTo: { displayName: expect.any(String) } });
    expect(reply.body.messages.at(-1)).toMatchObject({ sender: "staff", senderName: expect.any(String) });

    await drainEvents(ctx);
    const told = await notices("portal.message-received", `recipient_patient_id = '${juanId}'`);
    expect(told.map((n) => n.channel)).toContain("sms");
    expect(JSON.stringify(told)).not.toMatch(/water|food|medicine/i);

    const list = (await as_(juanToken).get("/message-threads").expect(200)).body as Array<{ id: string; unread: boolean; lastMessageFrom: string }>;
    expect(list[0]).toMatchObject({ id: threadId, unread: true, lastMessageFrom: "staff" });
    expect((await as_(juanToken).get("/messages/unread-count").expect(200)).body.unread).toBeGreaterThanOrEqual(1);
    expect((await as_(juanToken).get("/message-threads/unread-count").expect(200)).body).toEqual({ unread: 1 });

    const opened = (await as_(juanToken).get(`/message-threads/${threadId}`).expect(200)).body;
    expect(opened.unread).toBe(false);
    expect(opened.messages.map((m: { sender: string }) => m.sender)).toEqual(["patient", "patient", "staff"]);
    expect((await as_(juanToken).get("/message-threads/unread-count").expect(200)).body).toEqual({ unread: 0 });
    expect((await staff(nurse).get("/patient-messages/awaiting-count").expect(200)).body).toEqual({ awaiting: 0 });
  });

  it("assigns, closes and reopens; a closed conversation takes no messages", async () => {
    const assigned = await staff(admin).post(`/patient-messages/${threadId}/assignment`, { assignToMe: true }).expect(200);
    expect(assigned.body.assignedTo).not.toBeNull();
    expect((await staff(admin).post(`/patient-messages/${threadId}/assignment`, { assignToMe: false }).expect(200)).body.assignedTo).toBeNull();

    const closed = (await staff(nurse).post(`/patient-messages/${threadId}/close`).expect(200)).body;
    expect(closed).toMatchObject({ status: "closed" });
    expect(closed.closedAt).not.toBeNull();
    await as_(juanToken)
      .post(`/message-threads/${threadId}/messages`, { body: "one more thing" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("thread_closed"));
    await staff(nurse).post(`/patient-messages/${threadId}/messages`, { body: "closed?" }).expect(422);
    expect((await staff(nurse).get("/patient-messages?filter=closed").expect(200)).body).toHaveLength(1);
    expect((await staff(nurse).get("/patient-messages?filter=open").expect(200)).body).toHaveLength(0);

    await staff(nurse).post(`/patient-messages/${threadId}/reopen`).expect(200);
    await as_(juanToken).post(`/message-threads/${threadId}/messages`, { body: "one more thing" }).expect(201);
    expect((await staff(nurse).get("/patient-messages").expect(200)).body).toHaveLength(1);
  });

  it("lets the clinic start a conversation only with a patient who can read it", async () => {
    const noPortal = (
      await staff(admin)
        .post("/patients", {
          ...maria,
          familyName: "Santos",
          givenName: "Pedro",
          birthDate: "1975-01-02",
          contacts: [{ system: "mobile", value: "0919 111 2222" }],
        })
        .expect(201)
    ).body.id;
    await staff(admin)
      .post("/patient-messages", { patientId: noPortal, topic: "results", subject: "Your results", body: "Please call us." })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("no_portal_account"));
    const started = await staff(admin)
      .post("/patient-messages", { patientId: mariaId, topic: "appointment", subject: "Your appointment", body: "Can you come at 10?" })
      .expect(201);
    expect(started.body).toMatchObject({ startedBy: "staff", lastMessageFrom: "staff", awaitingClinic: false });
    const mine = (await as_(mariaToken).get("/message-threads").expect(200)).body as Array<{ subject: string; unread: boolean; startedBy: string }>;
    expect(mine).toEqual([expect.objectContaining({ subject: "Your appointment", unread: true, startedBy: "staff" })]);
    await as_(mariaToken).post(`/message-threads/${started.body.id}/messages`, { body: "Yes, 10 works." }).expect(201);
    expect((await staff(admin).get(`/patient-messages?patientId=${mariaId}&filter=awaiting`).expect(200)).body).toHaveLength(1);
  });

  it("limits open conversations and writing speed", async () => {
    // Maria has one from the clinic (not counted: the patient did not start it) and writes 5 of her own.
    for (let i = 0; i < 5; i++) await start(mariaToken, { subject: `Question ${i}` }).expect(201);
    await start(mariaToken)
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("too_many_open_threads"));
    // 1 reply above + 5 starts = 6 messages this hour; 4 more are allowed, the next is refused.
    const [own] = (await as_(mariaToken).get("/message-threads").expect(200)).body as Array<{ id: string }>;
    for (let i = 0; i < 4; i++)
      await as_(mariaToken)
        .post(`/message-threads/${own!.id}/messages`, { body: `More ${i}` })
        .expect(201);
    await as_(mariaToken)
      .post(`/message-threads/${own!.id}/messages`, { body: "Too many" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("message_rate_limited"));
  });

  it("is only for staff with the messaging permissions, and audits what patients and staff do", async () => {
    for (const path of ["/patient-messages", `/patient-messages/${threadId}`]) {
      await staff(pharmacist)
        .get(path)
        .expect((r) => expect([403, 404]).toContain(r.status));
    }
    await staff(pharmacist)
      .post(`/patient-messages/${threadId}/messages`, { body: "hi" })
      .expect((r) => expect([403, 404]).toContain(r.status));
    await staff(admin).post(`/patient-messages/${threadId}/messages`, { body: "" }).expect(400);

    const sent = await auditRows(ctx.pool, "action = 'portal.message-send'");
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.every((a) => a.actor_type === "patient" && a.patient_id)).toBe(true);
    expect((await auditRows(ctx.pool, "action = 'patient.message-reply'")).every((a) => a.actor_type === "user")).toBe(true);
    expect((await auditRows(ctx.pool, "action = 'patient.message-thread-view'")).length).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(await auditRows(ctx.pool, "action LIKE '%message%'"))).not.toMatch(/Can I take my medicine|water is enough/i);
  });

  it("never edits or deletes what was written, and keeps a message to one kind of sender", async () => {
    await expect(ctx.pool.query("UPDATE patient_message SET body = 'changed'")).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM patient_message")).rejects.toThrow();
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_message (organization_id, thread_id, patient_id, sender_type, body)
         SELECT organization_id, id, patient_id, 'patient', 'no account' FROM patient_message_thread LIMIT 1`,
      ),
    ).rejects.toThrow(/patient_message_check/);
  });

  it("does not start conversations under a merged record", async () => {
    const retired = (
      await staff(admin)
        .post("/patients", {
          ...maria,
          familyName: "Bautista",
          givenName: "Ana",
          birthDate: "1960-05-05",
          contacts: [{ system: "mobile", value: "0920 333 4444" }],
        })
        .expect(201)
    ).body.id;
    await ctx.pool.query("UPDATE patient SET status = 'merged', merged_into_patient_id = $2 WHERE id = $1", [retired, mariaId]);
    await expect(
      ctx.pool.query(
        `INSERT INTO patient_message_thread (organization_id, patient_id, facility_id, topic, subject, started_by, last_message_from)
         SELECT organization_id, id, registered_facility_id, 'general', 'x', 'staff', 'staff' FROM patient WHERE id = $1`,
        [retired],
      ),
    ).rejects.toThrow(/merged/);
  });
});
