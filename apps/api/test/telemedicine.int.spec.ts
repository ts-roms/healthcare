import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";

function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

/**
 * CLAUDE.md §31 critical journey (telemedicine part):
 * online booking → questionnaire → waiting room → video → telemedicine encounter → instructions,
 * plus escalation to in-person care.
 */
describe("telemedicine", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let practitionerId: string;
  let otherPractitionerId: string;
  let onlineType: string;
  let inPersonType: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
    put: (url: string) => ctx.http().put(url).set(as(token, tenant.facilityId)),
  });
  const portal = (token: string) => ({
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal/teleconsults${url}`)
        .set({ authorization: `Bearer ${token}` }),
    post: (url: string) =>
      ctx
        .http()
        .post(`/api/v1/portal/teleconsults${url}`)
        .set({ authorization: `Bearer ${token}` }),
    put: (url: string) =>
      ctx
        .http()
        .put(`/api/v1/portal/teleconsults${url}`)
        .set({ authorization: `Bearer ${token}` }),
  });
  const answers = {
    reasonForVisit: "Cough and fever for three days",
    symptoms: "Dry cough, 38.2 °C",
    symptomDurationDays: 3,
    locationCity: "Quezon City",
    callbackNumber: "0917 123 4567",
    acknowledgesOnlineConsultation: true,
  };

  /** A registered patient with an active MyHealth account; returns ids and a portal token. */
  let registered = 0;
  async function portalPatient(givenName: string, email: string) {
    registered += 1;
    const birthDate = `199${registered}-05-14`;
    const created = await staff(admin)
      .post("/api/v1/patients")
      .send({ familyName: `Santos${registered}`, givenName, sex: "female", birthDate, contacts: [{ system: "mobile", value: `0917 555 010${registered}` }] })
      .expect(201);
    const patientId = created.body.id;
    await staff(admin)
      .post(`/api/v1/patients/${patientId}/consents`)
      .send({ consentType: "portal_access", decision: "granted", capturedVia: "paper" })
      .expect(201);
    const code = (await staff(admin).post(`/api/v1/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "tele-org",
        patientNumber: created.body.patientNumber,
        birthDate,
        activationCode: code,
        email,
        password: PATIENT_PASSWORD,
      })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "tele-org", email, password: PATIENT_PASSWORD }).expect(200))
      .body.accessToken;
    return { patientId, token };
  }

  async function book(patientId: string, visitTypeId: string, minutesFromNow: number, withPractitioner = practitionerId) {
    const startsAt = new Date(Date.now() + minutesFromNow * 60_000).toISOString();
    const booked = await staff(admin)
      .post("/api/v1/appointments")
      .send({ patientId, practitionerId: withPractitioner, facilityId: tenant.facilityId, visitTypeId, startsAt, outsideSchedule: true, reason: "Cough" })
      .expect(201);
    return booked.body[0].id as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "tele-org");
    await createStaff(ctx.pool, tenant, "admin@tele.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@tele.ph", ["physician"]));
    ({ practitionerId: otherPractitionerId } = await createClinician(ctx, tenant, "reyes@tele.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "nurse@tele.ph", ["nurse"]);
    admin = (await login(ctx, "admin@tele.ph")).accessToken;
    doctor = (await login(ctx, "santos@tele.ph")).accessToken;
    nurse = (await login(ctx, "nurse@tele.ph")).accessToken;
    onlineType = (
      await staff(admin)
        .post("/api/v1/clinic/visit-types")
        .send({ code: "online", name: "Online consultation", defaultDurationMinutes: 20, modality: "telemedicine", requiresTriage: false })
        .expect(201)
    ).body.id;
    inPersonType = (
      await staff(admin).post("/api/v1/clinic/visit-types").send({ code: "consult", name: "Consultation", defaultDurationMinutes: 20 }).expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  describe("a consultation that ends with instructions", () => {
    let patient: { patientId: string; token: string };
    let appointmentId: string;
    let encounterId: string;
    let room: string;

    beforeAll(async () => {
      patient = await portalPatient("Maria", "maria@tele.ph");
      appointmentId = await book(patient.patientId, onlineType, 10);
    });

    it("lists the consultation for staff and patient; in-person appointments are not online consultations", async () => {
      const day = await staff(nurse).get("/api/v1/telemedicine/consultations").expect(200);
      expect(day.body).toMatchObject({
        videoConfigured: true,
        consultations: [expect.objectContaining({ session: expect.objectContaining({ status: "scheduled" }) })],
      });
      const mine = await portal(patient.token).get("").expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({ appointmentId, status: "scheduled", questionnaireSubmitted: false, practitionerName: "Dr. santos" }),
      ]);
      const inPerson = await book(patient.patientId, inPersonType, 24 * 60);
      await portal(patient.token).get(`/${inPerson}`).expect(404);
    });

    it("reports whether video is set up and answering, to staff who can read online consultations", async () => {
      // The test configuration names a video server that does not exist: set up, but not reachable.
      const status = await staff(nurse).get("/api/v1/telemedicine/consultations/video-status").expect(200);
      expect(status.body).toMatchObject({ configured: true, reachable: false, detail: expect.any(String) });
      expect(JSON.stringify(status.body)).not.toContain("test-key");
      expect(JSON.stringify(status.body)).not.toContain("video.test.invalid");
    });

    it("requires the questionnaire, with the acknowledgement, before the waiting room", async () => {
      await portal(patient.token)
        .post(`/${appointmentId}/waiting-room`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("questionnaire_required"));
      await portal(patient.token)
        .put(`/${appointmentId}/questionnaire`)
        .send({ ...answers, acknowledgesOnlineConsultation: false })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_questionnaire"));
      const submitted = await portal(patient.token)
        .put(`/${appointmentId}/questionnaire`)
        .send({ ...answers, redFlags: ["difficulty_breathing"] })
        .expect(200);
      expect(submitted.body).toMatchObject({ questionnaireSubmitted: true, status: "scheduled" });

      const detail = await staff(doctor).get(`/api/v1/telemedicine/consultations/${appointmentId}`).expect(200);
      expect(detail.body.session).toMatchObject({
        questionnaire: expect.objectContaining({ reasonForVisit: "Cough and fever for three days", callbackNumber: "0917 123 4567" }),
        redFlags: ["difficulty_breathing"],
        redFlagLabels: ["Difficulty breathing or shortness of breath"],
        consentAcknowledgedAt: expect.any(String),
      });
      const audit = await auditRows(ctx.pool, "action = 'portal.teleconsult-questionnaire'");
      expect(audit[0]).toMatchObject({ actor_type: "patient", metadata: { redFlags: 1, acknowledgedOnlineConsultation: true } });
    });

    it("does not start before the patient waits, and gives no video before the start", async () => {
      await staff(doctor)
        .post(`/api/v1/telemedicine/consultations/${appointmentId}/start`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("patient_not_waiting"));
      await portal(patient.token)
        .post(`/${appointmentId}/video`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("video_closed"));
    });

    it("checks the patient in from the waiting room, straight to the consultation queue", async () => {
      const waiting = await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(200);
      expect(waiting.body.status).toBe("waiting");
      await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(200);
      const visits = await ctx.pool.query(`SELECT status, checked_in_via, checked_in_by FROM visit WHERE appointment_id = $1`, [appointmentId]);
      expect(visits.rows).toEqual([{ status: "awaiting_consultation", checked_in_via: "patient_portal", checked_in_by: null }]);
      const appointment = await ctx.pool.query(`SELECT status FROM appointment WHERE id = $1`, [appointmentId]);
      expect(appointment.rows[0].status).toBe("checked_in");
    });

    it("shows the online visit in the queue and refuses an ordinary consultation for it", async () => {
      const [visit] = (await ctx.pool.query<{ id: string }>(`SELECT id FROM visit WHERE appointment_id = $1`, [appointmentId])).rows;
      const queue = await staff(doctor).get("/api/v1/queue").expect(200);
      expect(queue.body.find((v: { id: string }) => v.id === visit!.id)).toMatchObject({ modality: "telemedicine", appointmentId });
      // Neither the default nor an explicit modality opens it outside Telemedicine: the session would stay waiting.
      for (const body of [{ visitId: visit!.id }, { visitId: visit!.id, modality: "telemedicine" }]) {
        const refused = await staff(doctor).post("/api/v1/encounters").send(body).expect(422);
        expect(refused.body.error.code).toBe("online_consultation");
      }
      const open = await ctx.pool.query(`SELECT count(*)::int AS n FROM encounter WHERE visit_id = $1`, [visit!.id]);
      expect(open.rows[0].n).toBe(0);
    });

    it("starts a telemedicine encounter and hands out room-bound video tokens", async () => {
      await staff(nurse).post(`/api/v1/telemedicine/consultations/${appointmentId}/start`).expect(403);
      const started = await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/start`).expect(200);
      expect(started.body.session).toMatchObject({ status: "in_consultation", encounterId: expect.any(String) });
      encounterId = started.body.session.encounterId;
      room = started.body.video.room;
      expect(room).toMatch(/^tm-[0-9a-f]{32}$/);
      const staffClaims = jwtPayload(started.body.video.token);
      expect(staffClaims).toMatchObject({ iss: "test-key", sub: expect.stringMatching(/^staff:/), video: expect.objectContaining({ room, roomJoin: true }) });
      expect(staffClaims.video).not.toHaveProperty("roomRecord");

      const encounter = await staff(doctor).get(`/api/v1/encounters/${encounterId}`).expect(200);
      expect(encounter.body).toMatchObject({ modality: "telemedicine", status: "in_progress" });

      const video = await portal(patient.token).post(`/${appointmentId}/video`).expect(200);
      expect(video.body.room).toBe(room);
      expect(jwtPayload(video.body.token)).toMatchObject({ sub: `patient:${patient.patientId}`, video: expect.objectContaining({ room }) });
      // Starting again (e.g. a second tab) rejoins rather than failing.
      expect((await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/start`).expect(200)).body.session.encounterId).toBe(encounterId);
    });

    it("ends the call with instructions the patient sees in MyHealth", async () => {
      const ended = await staff(doctor)
        .post(`/api/v1/telemedicine/consultations/${appointmentId}/end`)
        .send({ patientInstructions: "Paracetamol for fever, rest and fluids. Book a visit if not better in 3 days." })
        .expect(200);
      expect(ended.body.session.status).toBe("ended");
      await portal(patient.token).post(`/${appointmentId}/video`).expect(422);
      const view = await portal(patient.token).get(`/${appointmentId}`).expect(200);
      expect(view.body).toMatchObject({ status: "ended", patientInstructions: expect.stringMatching(/^Paracetamol/) });
      await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/escalate`).send({ reason: "Too late" }).expect(422);
      await drainEvents(ctx);
      const events = await ctx.pool.query<{ event_type: string }>(
        `SELECT event_type FROM domain_event WHERE aggregate_type = 'telemedicine_session' ORDER BY occurred_at`,
      );
      expect(events.rows.map((e) => e.event_type)).toEqual([
        "TelemedicineQuestionnaireSubmitted",
        "TelemedicinePatientWaiting",
        "TelemedicineConsultationStarted",
        "TelemedicineConsultationEnded",
      ]);
      const payloads = await ctx.pool.query(`SELECT payload::text AS p FROM domain_event WHERE aggregate_type = 'telemedicine_session'`);
      expect(payloads.rows.map((r) => r.p).join(" ")).not.toMatch(/Cough|Paracetamol|0917/);
    });
  });

  it("escalates to in-person care with a reason", async () => {
    const patient = await portalPatient("Rosa", "rosa@tele.ph");
    // Another practitioner: Dr. Santos is already booked at this time (no double-booking).
    const appointmentId = await book(patient.patientId, onlineType, 5, otherPractitionerId);
    await portal(patient.token).put(`/${appointmentId}/questionnaire`).send(answers).expect(200);
    await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(200);
    await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/start`).expect(200);
    await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/escalate`).send({ reason: "x" }).expect(400);
    const escalated = await staff(doctor)
      .post(`/api/v1/telemedicine/consultations/${appointmentId}/escalate`)
      .send({ reason: "Needs chest auscultation and a chest X-ray", patientInstructions: "Come to the clinic today; bring your medicines." })
      .expect(200);
    expect(escalated.body.session).toMatchObject({ status: "escalated", escalationReason: "Needs chest auscultation and a chest X-ray" });
    const view = await portal(patient.token).get(`/${appointmentId}`).expect(200);
    expect(view.body).toMatchObject({ escalated: true, patientInstructions: "Come to the clinic today; bring your medicines." });
    expect(view.body).not.toHaveProperty("escalationReason");
    const audit = await auditRows(ctx.pool, "action = 'telemedicine.escalate'");
    expect(audit[0]).toMatchObject({ reason: "Needs chest auscultation and a chest X-ray" });
  });

  it("opens the waiting room only shortly before the consultation, and never to another patient", async () => {
    const patient = await portalPatient("Liza", "liza@tele.ph");
    const later = await book(patient.patientId, onlineType, 3 * 60);
    await portal(patient.token).put(`/${later}/questionnaire`).send(answers).expect(200);
    await portal(patient.token)
      .post(`/${later}/waiting-room`)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("outside_join_window"));
    const other = await portalPatient("Carmen", "carmen@tele.ph");
    await portal(other.token).get(`/${later}`).expect(404);
    await portal(other.token).put(`/${later}/questionnaire`).send(answers).expect(404);
    await portal(doctor).get("").expect(401);
  });

  it("keeps a text chat between patient and clinician from the waiting room until the call ends, append-only", async () => {
    const patient = await portalPatient("Ines", "ines@tele.ph");
    const appointmentId = await book(patient.patientId, onlineType, 26, otherPractitionerId);
    const chat = `/${appointmentId}/messages`;
    // Not open before the patient is in the waiting room.
    await portal(patient.token)
      .post(chat)
      .send({ body: "Hello" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("chat_closed"));
    expect((await portal(patient.token).get(chat).expect(200)).body).toEqual({ messages: [], open: false });

    await portal(patient.token).put(`/${appointmentId}/questionnaire`).send(answers).expect(200);
    await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(200);

    const first = await portal(patient.token).post(chat).send({ body: "  My video is not working  " }).expect(201);
    expect(first.body).toMatchObject({ sender: "patient", body: "My video is not working" });
    await portal(patient.token).post(chat).send({ body: "   " }).expect(400);
    await portal(patient.token)
      .post(chat)
      .send({ body: "x".repeat(1001) })
      .expect(400);

    // The clinician reads it (any staff who can read online consultations) and answers (only who conducts them).
    const url = `/api/v1/telemedicine/consultations/${appointmentId}/messages`;
    expect((await staff(nurse).get(url).expect(200)).body.messages).toEqual([expect.objectContaining({ sender: "patient", body: "My video is not working" })]);
    await staff(nurse).post(url).send({ body: "I cannot answer" }).expect(403);
    const reply = await staff(doctor).post(url).send({ body: "I will call you on 0917 123 4567" }).expect(201);
    expect(reply.body).toMatchObject({ sender: "staff", name: expect.any(String) });

    // Only what is new, in order.
    const newer = await portal(patient.token).get(`${chat}?after=${first.body.id}`).expect(200);
    expect(newer.body.messages.map((m: { body: string }) => m.body)).toEqual(["I will call you on 0917 123 4567"]);
    expect(newer.body.open).toBe(true);

    // The patient cannot read another patient's chat; messages are never edited or removed.
    const other = await portalPatient("Olga", "olga@tele.ph");
    await portal(other.token).get(chat).expect(404);
    await expect(ctx.pool.query("DELETE FROM telemedicine_message")).rejects.toThrow();
    await expect(ctx.pool.query("UPDATE telemedicine_message SET body = 'changed'")).rejects.toThrow();

    // Closed once the call ends, still readable.
    await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/start`).expect(200);
    await staff(doctor).post(`/api/v1/telemedicine/consultations/${appointmentId}/end`).send({ patientInstructions: "Rest." }).expect(200);
    await portal(patient.token)
      .post(chat)
      .send({ body: "Thank you" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("chat_closed"));
    const after = await staff(doctor).get(url).expect(200);
    expect(after.body).toMatchObject({ open: false, messages: [expect.anything(), expect.anything()] });

    // Sending is audited without the text.
    const audits = await auditRows(ctx.pool, "action IN ('portal.teleconsult-message', 'telemedicine.message-send')");
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("video is not working");
  });

  it("can require payment before the waiting room: the visit is charged and invoiced once, and opens when it is paid", async () => {
    const service = (
      await staff(admin)
        .post("/api/v1/billing/services")
        .send({
          code: "online-fee",
          name: "Online consultation fee",
          category: "consultation",
          sourceKind: "visit_type",
          sourceCode: "online",
          unitPrice: 30_000,
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body;
    expect(service.id).toBeDefined();
    const setting = (url: string) => staff(admin).get(url);
    expect((await setting("/api/v1/telemedicine/settings").expect(200)).body).toMatchObject({ paymentRequired: false, version: 0 });
    await ctx.http().put("/api/v1/telemedicine/settings").set(as(nurse, tenant.facilityId)).send({ paymentRequired: true, version: 0 }).expect(403);
    await ctx.http().put("/api/v1/telemedicine/settings").set(as(admin, tenant.facilityId)).send({ paymentRequired: true, version: 0 }).expect(200);
    await ctx.http().put("/api/v1/telemedicine/settings").set(as(admin, tenant.facilityId)).send({ paymentRequired: true, version: 0 }).expect(409);

    const patient = await portalPatient("Pia", "pia@tele.ph");
    // A third practitioner, so the waiting room is open (within 30 minutes of the start) without overlapping another booking.
    const { practitionerId: thirdPractitionerId } = await createClinician(ctx, tenant, "cruz@tele.ph", ["physician"]);
    const appointmentId = await book(patient.patientId, onlineType, 10, thirdPractitionerId);
    await portal(patient.token).put(`/${appointmentId}/questionnaire`).send(answers).expect(200);
    // Reading never charges.
    expect((await portal(patient.token).get(`/${appointmentId}`).expect(200)).body.payment).toMatchObject({
      required: true,
      state: "not_required",
      invoiceId: null,
    });

    // Asking for the waiting room first charges and invoices the visit, and is refused until it is paid.
    const refused = await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(422);
    expect(refused.body.error.code).toBe("payment_required");
    const unpaid = (await portal(patient.token).get(`/${appointmentId}`).expect(200)).body.payment;
    expect(unpaid).toMatchObject({ required: true, state: "unpaid", amount: 30_000, balance: 30_000, invoiceId: expect.any(String) });
    // Asking again, or asking to pay, finds the same invoice (once per appointment).
    const again = (await portal(patient.token).post(`/${appointmentId}/payment`).expect(200)).body;
    expect(again).toMatchObject({ invoiceId: unpaid.invoiceId, state: "unpaid" });
    const charges = await ctx.pool.query("SELECT count(*)::int AS n FROM billing_charge WHERE source_type = 'appointment' AND source_id = $1", [appointmentId]);
    expect(charges.rows[0].n).toBe(1);
    const invoice = await ctx.pool.query("SELECT status, created_by, created_via, patient_total FROM billing_invoice WHERE id = $1", [unpaid.invoiceId]);
    expect(invoice.rows[0]).toMatchObject({ status: "issued", created_by: null, created_via: "system" });
    expect(Number(invoice.rows[0].patient_total)).toBe(30_000);

    // The cashier takes the payment at the counter; the waiting room opens.
    await staff(admin)
      .post(`/api/v1/billing/invoices/${unpaid.invoiceId}/payments`)
      .send({ amount: 30_000, method: "cash", idempotencyKey: "tele-prepay-0001" })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((await portal(patient.token).get(`/${appointmentId}`).expect(200)).body.payment).toMatchObject({ state: "paid", balance: 0 });
    await portal(patient.token).post(`/${appointmentId}/waiting-room`).expect(200);
    expect((await staff(doctor).get(`/api/v1/telemedicine/consultations/${appointmentId}`).expect(200)).body.payment).toMatchObject({
      required: true,
      state: "paid",
    });

    // Turned off again, nothing is asked for.
    await ctx.http().put("/api/v1/telemedicine/settings").set(as(admin, tenant.facilityId)).send({ paymentRequired: false, version: 1 }).expect(200);
    await portal(patient.token).post(`/${appointmentId}/payment`).expect(422);
  });

  // Keep last: once the organization has its own wording, every questionnaire must confirm it.
  it("asks for the organization's own acknowledgement wording once it has one, and records which version the patient saw", async () => {
    const patient = await portalPatient("Nena", "nena@tele.ph");
    const appointmentId = await book(patient.patientId, onlineType, 8 * 60);
    // Before any wording: the platform's plain statement; the staff view says so.
    expect((await portal(patient.token).get(`/${appointmentId}`).expect(200)).body.acknowledgement).toBeNull();

    const published = await ctx
      .http()
      .post("/api/v1/consent-texts")
      .set(as(admin, tenant.facilityId))
      .send({
        consentType: "telemedicine",
        offered: true,
        title: "Online consultation",
        body: "What an online consultation can and cannot do, in the clinic's words.",
        acknowledgement: "I have read how online consultations work at this clinic.",
      })
      .expect(201);

    const shown = (await portal(patient.token).get(`/${appointmentId}`).expect(200)).body.acknowledgement;
    expect(shown).toMatchObject({
      id: published.body.id,
      version: 1,
      title: "Online consultation",
      statement: "I have read how online consultations work at this clinic.",
    });

    // Confirming without the version offered now (or an older one) is refused.
    await portal(patient.token)
      .put(`/${appointmentId}/questionnaire`)
      .send(answers)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("acknowledgement_wording_changed"));
    await portal(patient.token)
      .put(`/${appointmentId}/questionnaire`)
      .send({ ...answers, acknowledgementTextId: "00000000-0000-4000-8000-000000000000" })
      .expect(422);
    await portal(patient.token)
      .put(`/${appointmentId}/questionnaire`)
      .send({ ...answers, acknowledgementTextId: published.body.id })
      .expect(200);

    const detail = await staff(doctor).get(`/api/v1/telemedicine/consultations/${appointmentId}`).expect(200);
    expect(detail.body.acknowledgement).toEqual({ source: "organization", version: 1, title: "Online consultation" });
    const stored = await ctx.pool.query("SELECT acknowledgement_text_id FROM telemedicine_session WHERE appointment_id = $1", [appointmentId]);
    expect(stored.rows[0].acknowledgement_text_id).toBe(published.body.id);
  });
});
