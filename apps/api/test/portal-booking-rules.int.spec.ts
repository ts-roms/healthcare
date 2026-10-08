import { WaitlistOffersService } from "@healthcare/clinic";
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
  underPlatform,
} from "./harness";

const PASSWORD = "Maaraw-na-umaga-2026";
const ORG = "rules-org";

/**
 * Per-clinic online booking rules, choosing another doctor when moving a visit, and the patient waiting list for full days
 * (docs/domains/clinic.md, "Online booking rules and the waiting list").
 */
describe("online booking rules, another doctor, and the waiting list", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let receptionist: string;
  let cruz: string;
  let reyes: string;
  let visitType: string;
  let rulesVersion: number | undefined;
  const day = manilaDate(5);
  const otherDay = manilaDate(8);

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const rules = (over: Partial<Record<string, unknown>> = {}) => ({
    minLeadMinutes: 120,
    maxAdvanceDays: 60,
    maxUpcoming: 3,
    changeCutoffMinutes: 120,
    waitlistEnabled: false,
    maxWaitlistEntries: 3,
    autoNoShow: false,
    autoNoShowHour: 20,
    onlineCheckIn: false,
    checkInOpensMinutes: 60,
    checkInClosesMinutes: 15,
    waitlistMode: "notice",
    offerHoldMinutes: 120,
    offerBatch: 1,
    ...over,
  });
  async function setRules(over: Partial<Record<string, unknown>>) {
    const res = await staff(admin)
      .put(`/clinic/booking-rules/${tenant.facilityId}`, { ...rules(over), version: rulesVersion })
      .expect(200);
    rulesVersion = res.body.version;
    return res.body;
  }

  let registered = 0;
  async function portalPatient(givenName: string, email: string) {
    registered += 1;
    const birthDate = `${1980 + registered}-04-${String(10 + registered)}`;
    const created = await staff(admin)
      .post("/patients", {
        familyName: `Aquino${registered}`,
        givenName,
        sex: "female",
        birthDate,
        contacts: [{ system: "mobile", value: `0917 555 ${String(1000 + registered)}` }],
      })
      .expect(201);
    const patientId = created.body.id as string;
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: ORG, patientNumber: created.body.patientNumber, birthDate, activationCode: code, email, password: PASSWORD })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: ORG, email, password: PASSWORD }).expect(200)).body
      .accessToken as string;
    return { patientId, token };
  }
  async function slots(token: string, date: string, practitionerId?: string) {
    const q = `facilityId=${tenant.facilityId}&visitTypeId=${visitType}&date=${date}${practitionerId ? `&practitionerId=${practitionerId}` : ""}`;
    return (await portal(token).get(`/booking/slots?${q}`).expect(200)).body.slots as Array<{ startsAt: string; practitionerId: string }>;
  }
  const book = (token: string, practitionerId: string, startsAt: string) =>
    portal(token).post("/appointments", { facilityId: tenant.facilityId, visitTypeId: visitType, practitionerId, startsAt });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@rules.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@rules.ph", ["receptionist"]);
    ({ practitionerId: cruz } = await createClinician(ctx, tenant, "cruz@rules.ph", ["physician"]));
    ({ practitionerId: reyes } = await createClinician(ctx, tenant, "reyes@rules.ph", ["physician"]));
    admin = (await login(ctx, "admin@rules.ph")).accessToken;
    receptionist = (await login(ctx, "desk@rules.ph")).accessToken;
    const type = await staff(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 30 }).expect(201);
    visitType = type.body.id;
    await ctx
      .http()
      .patch(`/api/v1/clinic/visit-types/${visitType}`)
      .set(as(admin, tenant.facilityId))
      .send({ onlineBooking: true, version: type.body.version })
      .expect(200);
    for (const [practitionerId, startTime, endTime] of [
      [cruz, "08:00", "10:00"],
      [reyes, "10:00", "12:00"],
    ] as const) {
      for (let dow = 0; dow < 7; dow++) {
        await staff(admin)
          .post("/clinic/schedules", {
            practitionerId,
            facilityId: tenant.facilityId,
            dayOfWeek: dow,
            startTime,
            endTime,
            slotMinutes: 30,
            validFrom: manilaDate(0),
          })
          .expect(201);
      }
    }
  });
  afterAll(() => ctx.close());

  describe("booking rules per clinic", () => {
    it("start as the platform's defaults, with no waiting list", async () => {
      const list = (await staff(receptionist).get("/clinic/booking-rules").expect(200)).body as Array<{
        facilityId: string;
        customized: boolean;
        rules: object;
        version: number | null;
      }>;
      expect(list.find((f) => f.facilityId === tenant.facilityId)).toMatchObject({ customized: false, version: null, rules: rules() });
      expect(list.length).toBeGreaterThanOrEqual(1);
      const patient = await portalPatient("Ana", "ana@rules.ph");
      const options = (await portal(patient.token).get("/booking/options").expect(200)).body;
      expect(options.facilities[0].rules).toEqual(rules());
      expect(options).not.toHaveProperty("rules");
    });

    it("are set by clinic administrators only, validated, versioned and audited", async () => {
      await staff(receptionist)
        .put(`/clinic/booking-rules/${tenant.facilityId}`, rules())
        .expect((r) => expect([403, 404]).toContain(r.status));
      await staff(admin)
        .put(`/clinic/booking-rules/${tenant.facilityId}`, rules({ maxAdvanceDays: 0 }))
        .expect(400);
      await staff(admin)
        .put(`/clinic/booking-rules/${tenant.facilityId}`, rules({ minLeadMinutes: 100_000 }))
        .expect(400);
      await staff(admin).put(`/clinic/booking-rules/${crypto.randomUUID()}`, rules()).expect(404);
      const first = await setRules({ minLeadMinutes: 24 * 60, maxAdvanceDays: 7, maxUpcoming: 2, changeCutoffMinutes: 48 * 60 });
      expect(first).toMatchObject({
        customized: true,
        version: 1,
        rules: rules({ minLeadMinutes: 1440, maxAdvanceDays: 7, maxUpcoming: 2, changeCutoffMinutes: 2880 }),
      });
      await staff(admin)
        .put(`/clinic/booking-rules/${tenant.facilityId}`, { ...rules(), version: 99 })
        .expect(409);
      const audit = await auditRows(ctx.pool, "action = 'facility.booking-rules-update'");
      expect(audit).toHaveLength(1);
      const { rows } = await ctx.pool.query<{ changes: Record<string, { from: unknown; to: unknown }> }>(
        "SELECT changes FROM audit_event WHERE action = 'facility.booking-rules-update'",
      );
      expect(rows[0]!.changes).toMatchObject({ minLeadMinutes: { from: 120, to: 1440 }, maxAdvanceDays: { from: 60, to: 7 } });
    });

    it("decide which times patients are offered and refused", async () => {
      const patient = await portalPatient("Bea", "bea@rules.ph");
      expect((await portal(patient.token).get("/booking/options").expect(200)).body.facilities[0].rules).toMatchObject({
        minLeadMinutes: 1440,
        maxAdvanceDays: 7,
      });
      // Less than a day's notice: nothing today; more than a week ahead: nothing.
      expect(await slots(patient.token, manilaDate(0))).toEqual([]);
      expect(await slots(patient.token, manilaDate(9))).toEqual([]);
      expect((await slots(patient.token, manilaDate(3))).length).toBeGreaterThan(0);
      const [far] = await slots(patient.token, manilaDate(3));
      await book(patient.token, far!.practitionerId, new Date(Date.now() + 30 * 86_400_000).toISOString())
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("booking_too_far_ahead"));
      await book(patient.token, far!.practitionerId, new Date(Date.now() + 3600_000).toISOString())
        .expect(422)
        .expect((r) => {
          expect(r.body.error.code).toBe("booking_too_soon");
          expect(r.body.error.message).toContain("1 day");
        });
    });

    it("limit upcoming online bookings per the clinic's number, and how late a visit may be changed", async () => {
      const patient = await portalPatient("Cora", "cora@rules.ph");
      const times = await slots(patient.token, manilaDate(3), cruz);
      await book(patient.token, cruz, times[0]!.startsAt).expect(201);
      await book(patient.token, cruz, times[1]!.startsAt).expect(201);
      await book(patient.token, cruz, times[2]!.startsAt)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("too_many_bookings"));
      // The change cut-off is two days here: an appointment 1 day 20 hours away cannot be changed online.
      const soon = await slots(patient.token, manilaDate(2), reyes);
      const inWindow = soon.find(
        (s) => new Date(s.startsAt).getTime() > Date.now() + 26 * 3600_000 && new Date(s.startsAt).getTime() < Date.now() + 47 * 3600_000,
      );
      if (inWindow) {
        await setRules({ minLeadMinutes: 60, maxAdvanceDays: 7, maxUpcoming: 5, changeCutoffMinutes: 48 * 60 });
        const made = await book(patient.token, reyes, inWindow.startsAt).expect(201);
        await portal(patient.token)
          .post(`/appointments/${made.body.id}/cancel`, { version: made.body.version })
          .expect(422)
          .expect((r) => expect(r.body.error.code).toBe("change_window_closed"));
        const listed = (await portal(patient.token).get("/appointments").expect(200)).body.upcoming as Array<{ id: string; canCancel: boolean }>;
        expect(listed.find((v) => v.id === made.body.id)!.canCancel).toBe(false);
        await setRules({ minLeadMinutes: 1440, maxAdvanceDays: 7, maxUpcoming: 2, changeCutoffMinutes: 2880 });
      }
    });
  });

  describe("moving a visit to another doctor", () => {
    let patient: { patientId: string; token: string };
    let visit: { id: string; version: number };

    beforeAll(async () => {
      await setRules({ minLeadMinutes: 120, maxAdvanceDays: 60, maxUpcoming: 5, changeCutoffMinutes: 120 });
      patient = await portalPatient("Dina", "dina@rules.ph");
      const times = await slots(patient.token, day, cruz);
      const made = await book(patient.token, cruz, times[0]!.startsAt).expect(201);
      visit = { id: made.body.id, version: made.body.version };
    });

    it("keeps the same doctor when none is chosen, and moves to another doctor's open time when one is", async () => {
      const cruzTimes = await slots(patient.token, day, cruz);
      const same = await portal(patient.token)
        .post(`/appointments/${visit.id}/reschedule`, { startsAt: cruzTimes[1]!.startsAt, version: visit.version })
        .expect(200);
      expect(same.body.practitionerId).toBe(cruz);

      const reyesTimes = await slots(patient.token, day, reyes);
      const moved = await portal(patient.token)
        .post(`/appointments/${visit.id}/reschedule`, { startsAt: reyesTimes[0]!.startsAt, version: same.body.version, practitionerId: reyes })
        .expect(200);
      expect(moved.body).toMatchObject({ practitionerId: reyes, status: "booked" });
      visit = { id: visit.id, version: moved.body.version };
      const { rows } = await ctx.pool.query<{ practitioner_id: string }>("SELECT practitioner_id FROM appointment WHERE id = $1", [visit.id]);
      expect(rows[0]!.practitioner_id).toBe(reyes);
      const { rows: audit } = await ctx.pool.query<{ changes: Record<string, unknown> }>(
        "SELECT changes FROM audit_event WHERE action = 'appointment.reschedule' AND resource_id = $1 ORDER BY occurred_at DESC LIMIT 1",
        [visit.id],
      );
      expect(audit[0]!.changes).toHaveProperty("practitionerId");
    });

    it("refuses a doctor who is not on duty, an unknown doctor, and a time already taken", async () => {
      const cruzTimes = await slots(patient.token, day, cruz);
      const other = await portalPatient("Elena", "elena@rules.ph");
      const reyesTimes = await slots(patient.token, day, reyes);
      await book(other.token, reyes, reyesTimes[2]!.startsAt).expect(201);
      // Reyes works 10:00–12:00: a time from Cruz's morning is not one of hers.
      await portal(patient.token)
        .post(`/appointments/${visit.id}/reschedule`, { startsAt: cruzTimes[2]!.startsAt, version: visit.version, practitionerId: reyes })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("slot_unavailable"));
      await portal(patient.token)
        .post(`/appointments/${visit.id}/reschedule`, { startsAt: reyesTimes[2]!.startsAt, version: visit.version, practitionerId: reyes })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("slot_unavailable"));
      await portal(patient.token)
        .post(`/appointments/${visit.id}/reschedule`, { startsAt: cruzTimes[2]!.startsAt, version: visit.version, practitionerId: crypto.randomUUID() })
        .expect(404);
    });
  });

  describe("the waiting list for full days", () => {
    let patient: { patientId: string; token: string };
    const join = (token: string, over: Record<string, unknown> = {}) =>
      portal(token).post("/booking/waitlist", { facilityId: tenant.facilityId, visitTypeId: visitType, earliestDate: otherDay, latestDate: otherDay, ...over });

    beforeAll(async () => {
      patient = await portalPatient("Fe", "fe@rules.ph");
      // The clinic is closed on that day: a full day for patients.
      await staff(admin)
        .post("/clinic/schedule-exceptions", {
          facilityId: tenant.facilityId,
          startsAt: `${otherDay}T00:00:00+08:00`,
          endsAt: `${otherDay}T23:59:00+08:00`,
          reason: "Clinic closed",
        })
        .expect(201);
    });

    it("is off until the clinic turns it on", async () => {
      await setRules({ waitlistEnabled: false });
      await join(patient.token)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("waitlist_not_available"));
      await setRules({ waitlistEnabled: true, maxWaitlistEntries: 2 });
      expect((await portal(patient.token).get("/booking/options").expect(200)).body.facilities[0].rules).toMatchObject({
        waitlistEnabled: true,
        maxWaitlistEntries: 2,
      });
    });

    it("takes a request for a full day only, within the clinic's horizon and at most two weeks", async () => {
      await join(patient.token, { earliestDate: day, latestDate: day })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("open_times_available"));
      await join(patient.token, { earliestDate: manilaDate(-2), latestDate: otherDay }).expect(422);
      await join(patient.token, { earliestDate: otherDay, latestDate: manilaDate(30) }).expect(422);
      await join(patient.token, { earliestDate: otherDay, latestDate: manilaDate(1) }).expect(422);
      await join(patient.token, { visitTypeId: crypto.randomUUID() }).expect(422);
      const created = await join(patient.token).expect(201);
      expect(created.body).toMatchObject({ facilityId: tenant.facilityId, earliestDate: otherDay, latestDate: otherDay, visitTypeName: "Consultation" });
      const listed = (await portal(patient.token).get("/booking/waitlist").expect(200)).body as Array<{ id: string }>;
      expect(listed.map((e) => e.id)).toEqual([created.body.id]);
    });

    it("refuses the same days twice and more than the clinic allows, and can be taken back", async () => {
      await join(patient.token)
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("already_on_waitlist"));
      // A second request for another closed day, then the limit of two.
      const dayC = manilaDate(9);
      await staff(admin)
        .post("/clinic/schedule-exceptions", {
          facilityId: tenant.facilityId,
          startsAt: `${dayC}T00:00:00+08:00`,
          endsAt: `${dayC}T23:59:00+08:00`,
          reason: "Clinic closed",
        })
        .expect(201);
      const second = await join(patient.token, { earliestDate: dayC, latestDate: dayC }).expect(201);
      const dayD = manilaDate(10);
      await staff(admin)
        .post("/clinic/schedule-exceptions", {
          facilityId: tenant.facilityId,
          startsAt: `${dayD}T00:00:00+08:00`,
          endsAt: `${dayD}T23:59:00+08:00`,
          reason: "Clinic closed",
        })
        .expect(201);
      await join(patient.token, { earliestDate: dayD, latestDate: dayD })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe("too_many_waitlist_entries"));
      const stranger = await portalPatient("Gina", "gina@rules.ph");
      await portal(stranger.token).post(`/booking/waitlist/${second.body.id}/leave`).expect(404);
      await portal(patient.token).post(`/booking/waitlist/${second.body.id}/leave`).expect(204);
      await portal(patient.token).post(`/booking/waitlist/${second.body.id}/leave`).expect(404);
      expect(((await portal(patient.token).get("/booking/waitlist").expect(200)).body as unknown[]).length).toBe(1);
    });

    it("shows on the clinic's own waiting list, marked as made by the patient", async () => {
      const entries = (await staff(receptionist).get(`/waitlist?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
        patientId: string;
        createdBy: string | null;
        createdByPatient: boolean;
      }>;
      expect(entries.find((e) => e.patientId === patient.patientId)).toMatchObject({ createdBy: null, createdByPatient: true });
      const audit = await auditRows(ctx.pool, "action = 'waitlist.add' AND actor_type = 'patient'");
      expect(audit.length).toBeGreaterThanOrEqual(2);
      // The database keeps exactly one creator.
      await expect(ctx.pool.query("UPDATE appointment_waitlist_entry SET created_by = NULL, created_by_patient = false")).rejects.toThrow(
        /appointment_waitlist_entry_one_creator/,
      );
    });

    it("tells a waiting patient when a time opens — once a day, never the one who freed it — and closes the entry when they book", async () => {
      const waiting = await portalPatient("Hana", "hana@rules.ph");
      const canceller = await portalPatient("Ines", "ines@rules.ph");
      const times = await slots(canceller.token, day, cruz);
      const made = await book(canceller.token, cruz, times[3]!.startsAt).expect(201);
      const entry = (
        await ctx.pool.query<{ id: string }>(
          `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, visit_type_id, earliest_date, latest_date, created_by, created_by_patient)
           VALUES ($1, $2, $3, $4, $5, $5, NULL, true) RETURNING id`,
          [tenant.organizationId, tenant.facilityId, waiting.patientId, visitType, day],
        )
      ).rows[0]!.id;
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${made.body.id}/cancel`, { version: made.body.version }).expect(200);
      await drainEvents(ctx);
      const told = async (patientId: string) =>
        (
          await ctx.pool.query<{ channel: string; variables: Record<string, string> }>(
            "SELECT channel, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'appointment.waitlist-opened'",
            [patientId],
          )
        ).rows;
      const notices = await told(waiting.patientId);
      expect(notices.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(notices)).not.toMatch(/Cruz|08:|09:|Consultation/);
      expect(await told(canceller.patientId)).toEqual([]);

      // Another time opening the same day does not send a second notice to the same entry.
      const again = await book(canceller.token, cruz, times[3]!.startsAt).expect(201);
      await portal(canceller.token).post(`/appointments/${again.body.id}/cancel`, { version: again.body.version }).expect(200);
      await drainEvents(ctx);
      expect((await told(waiting.patientId)).length).toBe(notices.length);

      // Booking a time in those days closes the entry.
      const open = await slots(waiting.token, day, cruz);
      await book(waiting.token, cruz, open[0]!.startsAt).expect(201);
      const { rows } = await ctx.pool.query<{ status: string; appointment_id: string | null }>(
        "SELECT status, appointment_id FROM appointment_waitlist_entry WHERE id = $1",
        [entry],
      );
      expect(rows[0]).toMatchObject({ status: "booked" });
      expect(rows[0]!.appointment_id).not.toBeNull();
    });

    it("sends no notice when the clinic has no patient waiting list", async () => {
      await setRules({ waitlistEnabled: false });
      const before = (await ctx.pool.query("SELECT 1 FROM notification WHERE template_key = 'appointment.waitlist-opened'")).rowCount;
      const waiting = await portalPatient("Jo", "jo@rules.ph");
      const canceller = await portalPatient("Kim", "kim@rules.ph");
      const times = await slots(canceller.token, day, reyes);
      const made = await book(canceller.token, reyes, times[1]!.startsAt).expect(201);
      await ctx.pool.query(
        `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, earliest_date, latest_date, created_by, created_by_patient)
         VALUES ($1, $2, $3, $4, $4, NULL, true)`,
        [tenant.organizationId, tenant.facilityId, waiting.patientId, day],
      );
      await portal(canceller.token).post(`/appointments/${made.body.id}/cancel`, { version: made.body.version }).expect(200);
      await drainEvents(ctx);
      expect((await ctx.pool.query("SELECT 1 FROM notification WHERE template_key = 'appointment.waitlist-opened'")).rowCount).toBe(before);
    });
  });

  describe("waiting-list rules per visit type or practitioner, offers, and room views (migration 0096)", () => {
    let patient: { patientId: string; token: string };
    let second: { patientId: string; token: string };
    let canceller: { patientId: string; token: string };
    const closedDay = manilaDate(12);
    const offerDay = manilaDate(6);
    const join = (token: string, over: Record<string, unknown> = {}) =>
      portal(token).post("/booking/waitlist", {
        facilityId: tenant.facilityId,
        visitTypeId: visitType,
        earliestDate: closedDay,
        latestDate: closedDay,
        ...over,
      });
    const offersOf = async (token: string) =>
      (await portal(token).get("/booking/offers").expect(200)).body as Array<{ id: string; startsAt: string; practitionerName: string }>;

    beforeAll(async () => {
      patient = await portalPatient("Liza", "liza@rules.ph");
      second = await portalPatient("Mara", "mara@rules.ph");
      canceller = await portalPatient("Nilo", "nilo@rules.ph");
      await staff(admin)
        .post("/clinic/schedule-exceptions", {
          facilityId: tenant.facilityId,
          startsAt: `${closedDay}T00:00:00+08:00`,
          endsAt: `${closedDay}T23:59:00+08:00`,
          reason: "Clinic closed",
        })
        .expect(201);
      await setRules({ waitlistEnabled: true, maxWaitlistEntries: 3 });
    });

    it("lets a rule for a visit type or practitioner override the clinic's own, the practitioner's winning (clinic.configure, audited)", async () => {
      await staff(receptionist)
        .put("/clinic/waitlist-rules", { facilityId: tenant.facilityId, scope: "visit_type", visitTypeId: visitType, enabled: false, maxEntries: 1 })
        .expect(403);
      await staff(admin).put("/clinic/waitlist-rules", { facilityId: tenant.facilityId, scope: "visit_type", enabled: false, maxEntries: 1 }).expect(400);
      const typeRule = await staff(admin)
        .put("/clinic/waitlist-rules", { facilityId: tenant.facilityId, scope: "visit_type", visitTypeId: visitType, enabled: false, maxEntries: 1 })
        .expect(200);
      expect(typeRule.body).toMatchObject({
        scope: "visit_type",
        visitTypeName: "Consultation",
        enabled: false,
        maxEntries: 1,
        maxDaysAhead: null,
        version: 1,
      });
      // Not for this visit type any more…
      expect(
        (await portal(patient.token).get(`/booking/waitlist-allowance?facilityId=${tenant.facilityId}&visitTypeId=${visitType}`).expect(200)).body,
      ).toEqual({
        enabled: false,
        maxEntries: 1,
        maxDaysAhead: 60,
      });
      await join(patient.token)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("waitlist_not_offered"));
      // …unless asked for Dr Cruz, whose rule allows it and wins.
      await staff(admin)
        .put("/clinic/waitlist-rules", {
          facilityId: tenant.facilityId,
          scope: "practitioner",
          practitionerId: cruz,
          enabled: true,
          maxEntries: 2,
          maxDaysAhead: 30,
        })
        .expect(200);
      expect(
        (
          await portal(patient.token)
            .get(`/booking/waitlist-allowance?facilityId=${tenant.facilityId}&visitTypeId=${visitType}&practitionerId=${cruz}`)
            .expect(200)
        ).body,
      ).toEqual({ enabled: true, maxEntries: 2, maxDaysAhead: 30 });
      await join(patient.token, { practitionerId: cruz }).expect(201);
      // A rule changes only with the version read.
      await staff(admin)
        .put("/clinic/waitlist-rules", { facilityId: tenant.facilityId, scope: "visit_type", visitTypeId: visitType, enabled: true, maxEntries: 3, version: 7 })
        .expect(409);
      await staff(admin)
        .put("/clinic/waitlist-rules", { facilityId: tenant.facilityId, scope: "visit_type", visitTypeId: visitType, enabled: true, maxEntries: 3, version: 1 })
        .expect(200);
      const listed = (await staff(receptionist).get(`/clinic/waitlist-rules?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
        scope: string;
        version: number;
      }>;
      expect(listed.map((r) => [r.scope, r.version])).toEqual([
        ["practitioner", 1],
        ["visit_type", 2],
      ]);
      expect((await auditRows(ctx.pool, "action = 'facility.waitlist-rule-update'")).length).toBe(3);
    });

    it("in offer mode holds an opened time for the next waiting patient, who accepts it in MyHealth; the others learn it is taken", async () => {
      await setRules({ waitlistEnabled: true, maxWaitlistEntries: 3, waitlistMode: "offer", offerHoldMinutes: 60, offerBatch: 2 });
      // Two patients wait for Dr Cruz on a day; a third books a time that day and cancels it.
      await ctx.pool.query(
        `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, earliest_date, latest_date, created_by, created_by_patient, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $6, NULL, true, 'routine'), ($1, $2, $7, $4, $5, $6, $6, NULL, true, 'soon')`,
        [tenant.organizationId, tenant.facilityId, patient.patientId, cruz, visitType, offerDay, second.patientId],
      );
      const times = await slots(canceller.token, offerDay, cruz);
      const made = await book(canceller.token, cruz, times[2]!.startsAt).expect(201);
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${made.body.id}/cancel`, { version: made.body.version }).expect(200);
      await drainEvents(ctx);

      const first = await offersOf(patient.token);
      const urgent = await offersOf(second.token);
      expect(first).toHaveLength(1);
      expect(urgent).toHaveLength(1);
      expect(first[0]).toMatchObject({ startsAt: times[2]!.startsAt, practitionerName: "Dr. cruz" });
      expect(await offersOf(canceller.token)).toEqual([]);
      const notices = (
        await ctx.pool.query<{ variables: Record<string, string> }>(
          "SELECT variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'appointment.waitlist-offer'",
          [second.patientId],
        )
      ).rows;
      expect(notices).toHaveLength(1);
      expect(JSON.stringify(notices)).not.toMatch(/Cruz|0[0-9]:[0-9]{2}|Consultation/);
      expect(notices[0]!.variables).toMatchObject({ holdText: "1 hour" });
      // Staff see the held times.
      const held = (await staff(receptionist).get(`/waitlist/offers?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
        status: string;
        patientId: string;
      }>;
      expect(
        held
          .filter((o) => o.status === "offered")
          .map((o) => o.patientId)
          .sort(),
      ).toEqual([patient.patientId, second.patientId].sort());

      // The urgent patient accepts: booked as an online booking; the other offer is taken; the entry is closed as booked.
      const booked = await portal(second.token).post(`/booking/offers/${urgent[0]!.id}/accept`).expect(200);
      expect(booked.body).toMatchObject({ practitionerId: cruz, startsAt: times[2]!.startsAt, status: "booked" });
      await portal(patient.token)
        .post(`/booking/offers/${first[0]!.id}/accept`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("offer_taken"));
      expect(await offersOf(patient.token)).toEqual([]);
      const entry = (
        await ctx.pool.query<{ status: string }>("SELECT status FROM appointment_waitlist_entry WHERE patient_id = $1 AND earliest_date = $2", [
          second.patientId,
          offerDay,
        ])
      ).rows[0];
      expect(entry).toMatchObject({ status: "booked" });
      const audit = await auditRows(ctx.pool, "action = 'waitlist.offer.accept' AND actor_type = 'patient'");
      expect(audit).toHaveLength(1);
    });

    it("hands a declined or expired time to the next entries, lets staff accept for the patient, and withdraws with a reason", async () => {
      // Another cancellation on the same day: only the patient still waiting is offered it (batch 2, one candidate).
      const times = await slots(canceller.token, offerDay, cruz);
      const made = await book(canceller.token, cruz, times[0]!.startsAt).expect(201);
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${made.body.id}/cancel`, { version: made.body.version }).expect(200);
      await drainEvents(ctx);
      // One offer per entry per day: the earlier (taken) offer that day blocks a new one for this entry.
      expect(await offersOf(patient.token)).toEqual([]);

      // A new day: the patient waits again, a time opens, and the patient declines it.
      const nextDay = manilaDate(7);
      const waiting = await portalPatient("Ofelia", "ofelia@rules.ph");
      // Liza asked first (an earlier entry), Ofelia later.
      await ctx.pool.query(
        `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, earliest_date, latest_date, created_by, created_by_patient, created_at)
         VALUES ($1, $2, $7, $4, $5, $6, $6, NULL, true, now() - interval '1 hour'), ($1, $2, $3, $4, $5, $6, $6, NULL, true, now())`,
        [tenant.organizationId, tenant.facilityId, waiting.patientId, cruz, visitType, nextDay, patient.patientId],
      );
      await setRules({ waitlistEnabled: true, maxWaitlistEntries: 3, waitlistMode: "offer", offerHoldMinutes: 60, offerBatch: 1 });
      const later = await slots(canceller.token, nextDay, cruz);
      const freed = await book(canceller.token, cruz, later[1]!.startsAt).expect(201);
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${freed.body.id}/cancel`, { version: freed.body.version }).expect(200);
      await drainEvents(ctx);
      // The oldest waiting entry (Liza's) gets the only offer.
      const mine = await offersOf(patient.token);
      expect(mine).toHaveLength(1);
      expect(await offersOf(waiting.token)).toEqual([]);
      await portal(patient.token).post(`/booking/offers/${mine[0]!.id}/decline`).expect(204);
      // Declining hands the time to the next entry at once.
      const next = await offersOf(waiting.token);
      expect(next).toHaveLength(1);
      expect(next[0]!.startsAt).toBe(later[1]!.startsAt);

      // Staff withdraw it with a reason, then accept the next one on the patient's behalf after an expiry hands it on.
      await staff(receptionist).post(`/waitlist/offers/${next[0]!.id}/withdraw`, { reason: "x" }).expect(400);
      const withdrawn = await staff(receptionist).post(`/waitlist/offers/${next[0]!.id}/withdraw`, { reason: "Patient called: no longer needed" }).expect(200);
      expect(withdrawn.body).toMatchObject({ status: "withdrawn", withdrawReason: "Patient called: no longer needed" });
      await portal(waiting.token)
        .post(`/booking/offers/${next[0]!.id}/accept`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("offer_withdrawn"));

      // Expiry: the same time opens again. Liza declined and Ofelia was already offered that day (one offer per entry per
      // day), so it goes to a newcomer; when her hold runs out the offer expires and nobody else is left to offer it to.
      const newcomer = await portalPatient("Pia", "pia@rules.ph");
      await ctx.pool.query(
        `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, earliest_date, latest_date, created_by, created_by_patient)
         VALUES ($1, $2, $3, $4, $5, $6, $6, NULL, true)`,
        [tenant.organizationId, tenant.facilityId, newcomer.patientId, cruz, visitType, nextDay],
      );
      const again = await book(canceller.token, cruz, later[1]!.startsAt).expect(201);
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${again.body.id}/cancel`, { version: again.body.version }).expect(200);
      await drainEvents(ctx);
      const reoffered = await offersOf(newcomer.token);
      expect(reoffered).toHaveLength(1);
      expect(await offersOf(waiting.token)).toEqual([]);
      await ctx.pool.query("UPDATE waitlist_offer SET expires_at = now() - interval '1 minute' WHERE id = $1", [reoffered[0]!.id]);
      const offers = underPlatform(ctx.app.get(WaitlistOffersService));
      expect((await offers.expire()).expired).toBe(1);
      expect(await offersOf(newcomer.token)).toEqual([]);
      const open = (await staff(receptionist).get(`/waitlist/offers?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
        id: string;
        patientId: string;
        status: string;
      }>;
      expect(open.filter((o) => o.status === "offered")).toEqual([]);
      expect((await ctx.pool.query("SELECT status FROM waitlist_offer WHERE id = $1", [reoffered[0]!.id])).rows[0]).toEqual({ status: "expired" });
      // Staff acceptance: a fresh offer for Ofelia on yet another day.
      const thirdDay = manilaDate(13);
      await ctx.pool.query(
        `INSERT INTO appointment_waitlist_entry (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, earliest_date, latest_date, created_by, created_by_patient)
         VALUES ($1, $2, $3, $4, $5, $6, $6, NULL, true)`,
        [tenant.organizationId, tenant.facilityId, waiting.patientId, cruz, visitType, thirdDay],
      );
      const third = await slots(canceller.token, thirdDay, cruz);
      const last = await book(canceller.token, cruz, third[0]!.startsAt).expect(201);
      await drainEvents(ctx);
      await portal(canceller.token).post(`/appointments/${last.body.id}/cancel`, { version: last.body.version }).expect(200);
      await drainEvents(ctx);
      const forStaff = (await staff(receptionist).get(`/waitlist/offers?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
        id: string;
        patientId: string;
      }>;
      const offer = forStaff.find((o) => o.patientId === waiting.patientId)!;
      const accepted = await staff(receptionist).post(`/waitlist/offers/${offer.id}/accept`).expect(200);
      expect(accepted.body).toMatchObject({ patientId: waiting.patientId, practitionerId: cruz, bookingChannel: "front_desk" });
      expect((await ctx.pool.query("SELECT status, accepted_by_patient FROM waitlist_offer WHERE id = $1", [offer.id])).rows[0]).toMatchObject({
        status: "accepted",
        accepted_by_patient: false,
      });
    });

    it("lists the day's appointments by room", async () => {
      const room = (
        await staff(admin).post("/clinic/rooms", { facilityId: tenant.facilityId, code: "r1", name: "Room 1", roomType: "consultation" }).expect(201)
      ).body;
      const roomDay = manilaDate(14);
      const times = await slots(canceller.token, roomDay, reyes);
      const inRoom = await staff(receptionist)
        .post("/appointments", {
          patientId: canceller.patientId,
          practitionerId: reyes,
          facilityId: tenant.facilityId,
          visitTypeId: visitType,
          startsAt: times[0]!.startsAt,
          roomId: room.id,
        })
        .expect(201);
      await staff(receptionist)
        .post("/appointments", {
          patientId: patient.patientId,
          practitionerId: reyes,
          facilityId: tenant.facilityId,
          visitTypeId: visitType,
          startsAt: times[1]!.startsAt,
        })
        .expect(201);
      const all = (await staff(receptionist).get(`/appointments?facilityId=${tenant.facilityId}&date=${roomDay}`).expect(200)).body.items as Array<{
        id: string;
        room: { name: string } | null;
      }>;
      expect(all.find((a) => a.id === inRoom.body[0].id)?.room).toEqual({ id: room.id, name: "Room 1" });
      expect(all.filter((a) => a.room === null)).toHaveLength(1);
      const only = (await staff(receptionist).get(`/appointments?facilityId=${tenant.facilityId}&date=${roomDay}&roomId=${room.id}`).expect(200)).body
        .items as Array<{ id: string }>;
      expect(only.map((a) => a.id)).toEqual([inRoom.body[0].id]);
    });
  });
});
