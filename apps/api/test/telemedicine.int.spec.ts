import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, login, type Tenant, type TestContext } from "./harness";

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
});
