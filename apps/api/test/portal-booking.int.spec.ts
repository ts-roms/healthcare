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

/** Online booking in MyHealth: options, open slots, book, reschedule, cancel — with the patient-booking rules. */
describe("portal booking", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let practitionerId: string;
  let bookableType: string;
  let bookableVersion: number;
  let staffOnlyType: string;
  const day = manilaDate(3);

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
    patch: (url: string) => ctx.http().patch(url).set(as(token, tenant.facilityId)),
  });
  const portal = (token: string) => ({
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` }),
    post: (url: string) =>
      ctx
        .http()
        .post(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` }),
  });

  let registered = 0;
  async function portalPatient(givenName: string, email: string) {
    registered += 1;
    const birthDate = `198${registered}-03-0${registered}`;
    const created = await staff(admin)
      .post("/api/v1/patients")
      .send({ familyName: `Bautista${registered}`, givenName, sex: "male", birthDate, contacts: [{ system: "mobile", value: `0918 444 020${registered}` }] })
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
      .send({ organizationCode: "book-org", patientNumber: created.body.patientNumber, birthDate, activationCode: code, email, password: PATIENT_PASSWORD })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "book-org", email, password: PATIENT_PASSWORD }).expect(200))
      .body.accessToken;
    return { patientId, token };
  }

  async function openSlots(token: string) {
    const res = await portal(token).get(`/booking/slots?facilityId=${tenant.facilityId}&visitTypeId=${bookableType}&date=${day}`).expect(200);
    return res.body.slots as Array<{ startsAt: string; practitionerId: string; practitionerName: string }>;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "book-org");
    await createStaff(ctx.pool, tenant, "admin@book.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "cruz@book.ph", ["physician"]));
    admin = (await login(ctx, "admin@book.ph")).accessToken;
    const type = await staff(admin).post("/api/v1/clinic/visit-types").send({ code: "consult", name: "Consultation", defaultDurationMinutes: 30 }).expect(201);
    bookableType = type.body.id;
    bookableVersion = type.body.version;
    staffOnlyType = (
      await staff(admin).post("/api/v1/clinic/visit-types").send({ code: "procedure", name: "Minor procedure", defaultDurationMinutes: 60 }).expect(201)
    ).body.id;
    for (let dow = 0; dow < 7; dow++) {
      await staff(admin)
        .post("/api/v1/clinic/schedules")
        .send({
          practitionerId,
          facilityId: tenant.facilityId,
          dayOfWeek: dow,
          startTime: "08:00",
          endTime: "10:00",
          slotMinutes: 30,
          validFrom: manilaDate(0),
        })
        .expect(201);
    }
  });

  afterAll(() => ctx.close());

  describe("visit types opened for online booking", () => {
    it("offers nothing until the clinic opens a visit type", async () => {
      const patient = await portalPatient("Jose", "jose@book.ph");
      const options = await portal(patient.token).get("/booking/options").expect(200);
      expect(options.body).toMatchObject({ visitTypes: [], facilities: [] });
      await portal(patient.token)
        .get(`/booking/slots?facilityId=${tenant.facilityId}&visitTypeId=${bookableType}&date=${day}`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("not_bookable_online"));
    });

    it("lets administrators open a visit type, with optimistic locking and audit", async () => {
      await staff(admin).patch(`/api/v1/clinic/visit-types/${bookableType}`).send({ onlineBooking: true, version: 99 }).expect(409);
      const updated = await staff(admin)
        .patch(`/api/v1/clinic/visit-types/${bookableType}`)
        .send({ onlineBooking: true, version: bookableVersion })
        .expect(200);
      expect(updated.body).toMatchObject({ onlineBooking: true, version: bookableVersion + 1 });
      const audit = await ctx.pool.query(`SELECT changes FROM audit_event WHERE action = 'visit-type.update' AND resource_id = $1`, [bookableType]);
      expect(audit.rows).toEqual([{ changes: { onlineBooking: { from: false, to: true } } }]);
    });
  });

  describe("a patient's own booking", () => {
    let pedro: { patientId: string; token: string };
    let ana: { patientId: string; token: string };
    let appointmentId: string;
    let firstSlot: string;

    beforeAll(async () => {
      pedro = await portalPatient("Pedro", "pedro@book.ph");
      ana = await portalPatient("Ana", "ana@book.ph");
    });

    it("lists what can be booked", async () => {
      const options = await portal(pedro.token).get("/booking/options").expect(200);
      expect(options.body.visitTypes).toEqual([{ id: bookableType, name: "Consultation", modality: "in_person", durationMinutes: 30 }]);
      expect(options.body.facilities).toEqual([
        expect.objectContaining({ id: tenant.facilityId, practitioners: [{ id: practitionerId, displayName: "Dr. cruz", specialty: null }] }),
      ]);
      expect(options.body.facilities[0].rules).toMatchObject({ minLeadMinutes: 120, maxUpcoming: 3, waitlistEnabled: false });
    });

    it("shows open slots from the published schedule", async () => {
      const slots = await openSlots(pedro.token);
      expect(slots).toHaveLength(4); // 08:00–10:00 in 30-minute slots
      expect(slots[0]).toMatchObject({ practitionerId, practitionerName: "Dr. cruz" });
      firstSlot = slots[0]!.startsAt;
    });

    it("books a slot as the patient, with no staff user, audited as the patient", async () => {
      const booked = await portal(pedro.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: firstSlot, reason: "Check-up" })
        .expect(201);
      appointmentId = booked.body.id;
      expect(booked.body).toMatchObject({ status: "booked", startsAt: firstSlot, version: 1 });
      const row = await ctx.pool.query(
        `SELECT booking_channel, created_by, updated_by, booked_by_patient, updated_by_patient, patient_id FROM appointment WHERE id = $1`,
        [appointmentId],
      );
      expect(row.rows[0]).toEqual({
        booking_channel: "online",
        created_by: null,
        updated_by: null,
        booked_by_patient: true,
        updated_by_patient: true,
        patient_id: pedro.patientId,
      });
      const audit = await auditRows(ctx.pool, `action = 'appointment.book' AND resource_id = '${appointmentId}'`);
      expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: pedro.patientId });

      expect((await openSlots(pedro.token)).map((s) => s.startsAt)).not.toContain(firstSlot);
      const mine = await portal(pedro.token).get("/appointments").expect(200);
      expect(mine.body.upcoming).toEqual([expect.objectContaining({ id: appointmentId, bookedByPatient: true, canCancel: true, canReschedule: true })]);
    });

    it("sends a confirmation that names only the facility and time", async () => {
      await drainEvents(ctx);
      const sent = await ctx.pool.query(
        `SELECT channel, template_key FROM notification WHERE idempotency_key LIKE 'patient-booking:%' AND recipient_patient_id = $1 ORDER BY channel`,
        [pedro.patientId],
      );
      // The text message, and the copy in the MyHealth inbox.
      expect(sent.rows).toEqual([
        { channel: "in_app", template_key: "appointment.self-service" },
        { channel: "sms", template_key: "appointment.self-service" },
      ]);
    });

    it("refuses a taken slot, one too soon, and one outside the schedule", async () => {
      await portal(ana.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: firstSlot })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("slot_unavailable"));
      await portal(ana.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: new Date(Date.now() + 30 * 60_000).toISOString() })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("booking_too_soon"));
      const offGrid = new Date(new Date(firstSlot).getTime() + 10 * 60_000).toISOString();
      await portal(ana.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: offGrid })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("slot_unavailable"));
      await portal(ana.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: staffOnlyType, practitionerId, startsAt: firstSlot })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("not_bookable_online"));
    });

    it("does not let another patient change the appointment", async () => {
      await portal(ana.token).post(`/appointments/${appointmentId}/cancel`).send({ version: 1 }).expect(404);
    });

    it("reschedules to another open slot with the same practitioner", async () => {
      const target = (await openSlots(pedro.token))[0]!.startsAt;
      await portal(pedro.token).post(`/appointments/${appointmentId}/reschedule`).send({ startsAt: target, version: 7 }).expect(409);
      const moved = await portal(pedro.token).post(`/appointments/${appointmentId}/reschedule`).send({ startsAt: target, version: 1 }).expect(200);
      expect(moved.body).toMatchObject({ startsAt: target, status: "booked", version: 2 });
      expect((await openSlots(pedro.token)).map((s) => s.startsAt)).toContain(firstSlot);
      const audit = await auditRows(ctx.pool, `action = 'appointment.reschedule' AND resource_id = '${appointmentId}'`);
      expect(audit[0]).toMatchObject({ actor_type: "patient" });
    });

    it("cancels, recording the patient and a default reason", async () => {
      const cancelled = await portal(pedro.token).post(`/appointments/${appointmentId}/cancel`).send({ version: 2 }).expect(200);
      expect(cancelled.body.status).toBe("cancelled");
      const row = await ctx.pool.query(`SELECT cancelled_by, cancellation_reason, updated_by_patient FROM appointment WHERE id = $1`, [appointmentId]);
      expect(row.rows[0]).toEqual({ cancelled_by: null, cancellation_reason: "Cancelled by the patient in MyHealth", updated_by_patient: true });
      await portal(pedro.token)
        .post(`/appointments/${appointmentId}/cancel`)
        .send({ version: 3 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_appointment_status"));
    });

    it("limits open online bookings per patient", async () => {
      const slots = await openSlots(ana.token);
      for (const slot of slots.slice(0, 3)) {
        await portal(ana.token)
          .post("/appointments")
          .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: slot.startsAt })
          .expect(201);
      }
      await portal(ana.token)
        .post("/appointments")
        .send({ facilityId: tenant.facilityId, visitTypeId: bookableType, practitionerId, startsAt: slots[3]!.startsAt })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("too_many_bookings"));
    });
  });

  describe("appointments the clinic booked", () => {
    it("can be cancelled but not moved online when the visit type is not bookable, and not at all close to the start", async () => {
      const patient = await portalPatient("Luz", "luz@book.ph");
      const later = await staff(admin)
        .post("/api/v1/appointments")
        .send({
          patientId: patient.patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId: staffOnlyType,
          startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          outsideSchedule: true,
        })
        .expect(201);
      const soon = await staff(admin)
        .post("/api/v1/appointments")
        .send({
          patientId: patient.patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId: bookableType,
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          outsideSchedule: true,
        })
        .expect(201);
      const mine = await portal(patient.token).get("/appointments").expect(200);
      expect(mine.body.upcoming).toEqual([
        expect.objectContaining({ id: soon.body[0].id, canCancel: false, canReschedule: false }),
        expect.objectContaining({ id: later.body[0].id, canCancel: true, canReschedule: false }),
      ]);

      await portal(patient.token)
        .post(`/appointments/${soon.body[0].id}/cancel`)
        .send({ version: 1 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("change_window_closed"));
      const target = (await openSlots(patient.token))[0]?.startsAt ?? new Date(Date.now() + 3 * 86_400_000).toISOString();
      await portal(patient.token)
        .post(`/appointments/${later.body[0].id}/reschedule`)
        .send({ startsAt: target, version: 1 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("not_bookable_online"));
      await portal(patient.token).post(`/appointments/${later.body[0].id}/cancel`).send({ version: 1, reason: "Feeling better" }).expect(200);
    });
  });
});
