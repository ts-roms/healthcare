import { KioskRegistrationService } from "../src/app/kiosk/kiosk-registration.service";
import { KioskSessionService } from "../src/app/kiosk/kiosk-session.service";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext, underPlatform } from "./harness";

/**
 * The patient self-service kiosk (migration 0137, docs/domains/kiosk.md): a kiosk signs in as an account with only the
 * Patient kiosk role, serves one person at a time in a short-lived session, recognises existing patients against the
 * Patient Master, checks them in through the clinic's own visit code, and stages a new patient's registration for staff.
 */
describe("patient self-service kiosk", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let kiosk: Record<"one" | "two" | "three" | "annex", string>;
  let visitTypeId: string;
  let hiddenTypeId: string;
  let practitionerId: string;
  let deviceOne: { id: string; version: number };
  let n = 0;

  const staff = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  /** A kiosk's requests; `session` is the X-Kiosk-Session token. */
  const k = (token: string, session?: string, facilityId = tenant.facilityId) => {
    const headers = { ...as(token, facilityId), ...(session ? { "x-kiosk-session": session } : {}) };
    return {
      get: (url: string) => ctx.http().get(`/api/v1/kiosk${url}`).set(headers),
      post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/kiosk${url}`).set(headers).send(body),
      delete: (url: string) => ctx.http().delete(`/api/v1/kiosk${url}`).set(headers),
    };
  };
  const openSession = async (token: string) => (await k(token).post("/sessions").expect(201)).body.token as string;

  async function newPatient(givenName: string) {
    n += 1;
    const birthDate = `${1960 + n}-0${1 + (n % 8)}-1${n % 9}`;
    const mobile = `0917 600 ${String(1000 + n)}`;
    const created = await staff(desk)
      .post("/patients", { familyName: `Santos${n}`, givenName, sex: "female", birthDate, contacts: [{ system: "mobile", value: mobile }] })
      .expect(201);
    return { id: created.body.id as string, number: created.body.patientNumber as string, givenName, birthDate, mobile };
  }
  async function identified(token: string, who: { number: string; birthDate: string; givenName: string }) {
    const session = await openSession(token);
    await k(token, session).post("/identify", { key: who.number, birthDate: who.birthDate, givenName: who.givenName }).expect(200);
    return session;
  }
  async function queueRow(ticket: string) {
    const rows = (await staff(desk).get("/queue").expect(200)).body as Array<{
      id: string;
      version: number;
      ticket: string;
      checkedInVia: string;
      status: string;
      calledTo: string | null;
      skippedCount: number;
    }>;
    return rows.find((r) => r.ticket === ticket);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "kiosk-org");
    await createStaff(ctx.pool, tenant, "admin@kiosk.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@kiosk.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@kiosk.ph", ["physician"]));
    for (const [name, facilityId] of [
      ["one", tenant.facilityId],
      ["two", tenant.facilityId],
      ["three", tenant.facilityId],
      ["annex", tenant.otherFacilityId],
    ] as const) {
      await createStaff(ctx.pool, tenant, `${name}@kiosk.ph`, [{ role: "kiosk_device", facilityId }]);
    }
    await createStaff(ctx.pool, tenant, "powerful@kiosk.ph", [
      { role: "kiosk_device", facilityId: tenant.facilityId },
      { role: "receptionist", facilityId: tenant.facilityId },
    ]);
    admin = (await login(ctx, "admin@kiosk.ph")).accessToken;
    desk = (await login(ctx, "desk@kiosk.ph")).accessToken;
    kiosk = {
      one: (await login(ctx, "one@kiosk.ph")).accessToken,
      two: (await login(ctx, "two@kiosk.ph")).accessToken,
      three: (await login(ctx, "three@kiosk.ph")).accessToken,
      annex: (await login(ctx, "annex@kiosk.ph")).accessToken,
    };
    visitTypeId = (
      await staff(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 30, kioskEnabled: true }).expect(201)
    ).body.id;
    hiddenTypeId = (await staff(admin).post("/clinic/visit-types", { code: "er", name: "Emergency", defaultDurationMinutes: 30 }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  describe("kiosk devices", () => {
    it("registers only accounts that hold the kiosk role and no patient record access", async () => {
      const register = (email: string, code: string) =>
        ctx.pool
          .query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email])
          .then((r) => staff(admin).post("/kiosk/admin/devices", { code, name: `Kiosk ${code}`, userId: r.rows[0]!.id }));
      const first = await register("one@kiosk.ph", "front-1");
      expect(first.status).toBe(201);
      deviceOne = first.body;
      expect(first.body).toMatchObject({ code: "front-1", status: "active", health: "offline" });
      for (const [email, code] of [
        ["two@kiosk.ph", "front-2"],
        ["three@kiosk.ph", "front-3"],
      ] as const) {
        await register(email, code).then((r) => expect(r.status).toBe(201));
      }
      const annexUser = (await ctx.pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email = 'annex@kiosk.ph'`)).rows[0]!.id;
      await staff(admin, tenant.otherFacilityId).post("/kiosk/admin/devices", { code: "annex-1", name: "Annex kiosk", userId: annexUser }).expect(201);

      expect((await register("one@kiosk.ph", "front-9")).status).toBe(409);
      expect((await register("desk@kiosk.ph", "desk-1")).body.error.code).toBe("not_a_kiosk_account");
      expect((await register("powerful@kiosk.ph", "powerful-1")).body.error.code).toBe("kiosk_account_too_powerful");
    });

    it("gives the kiosk account no access to patient records, the queue or registration", async () => {
      await staff(kiosk.one).get("/patients?q=Santos").expect(403);
      await staff(kiosk.one).get("/queue").expect(403);
      await staff(kiosk.one).post("/patients", { familyName: "A", givenName: "B", sex: "male", birthDate: "1990-01-01" }).expect(403);
      await staff(kiosk.one).get("/kiosk/admin/devices").expect(403);
      await staff(desk).get("/kiosk/me").expect(403);
    });

    it("shows staff whether each kiosk is online once it reports in", async () => {
      await k(kiosk.one).post("/heartbeat", { appVersion: "1.0.0", printerStatus: "ok" }).expect(200);
      const list = (await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{
        code: string;
        health: string;
        printerStatus: string;
        appVersion: string;
      }>;
      expect(list.find((d) => d.code === "front-1")).toMatchObject({ health: "online", printerStatus: "unknown", appVersion: "1.0.0" });
      expect(list.find((d) => d.code === "front-2")).toMatchObject({ health: "offline" });
      expect(list.map((d) => d.code)).not.toContain("annex-1");
      await staff(desk).post("/kiosk/admin/devices", { code: "x-1", name: "No", userId: deviceOne.id }).expect(403);
    });

    it("keeps a kiosk of one facility out of another", async () => {
      await k(kiosk.annex, undefined, tenant.facilityId).get("/me").expect(403);
      await k(kiosk.one, undefined, tenant.otherFacilityId).get("/me").expect(403);
      expect((await k(kiosk.annex, undefined, tenant.otherFacilityId).get("/me").expect(200)).body.device.code).toBe("annex-1");
    });

    it("serves no patients while in maintenance, and none once disabled", async () => {
      const set = (status: string, version: number) => staff(admin).patch(`/kiosk/admin/devices/${deviceOne.id}`, { status, version });
      const maintenance = await set("maintenance", deviceOne.version).expect(200);
      expect((await k(kiosk.one).post("/sessions").expect(422)).body.error.code).toBe("kiosk_in_maintenance");
      await k(kiosk.one).post("/heartbeat", {}).expect(200);
      const active = await set("active", maintenance.body.version).expect(200);
      const disabled = await set("disabled", active.body.version).expect(200);
      expect((await k(kiosk.one).post("/sessions").expect(403)).body.error.code).toBe("kiosk_disabled");
      const back = await set("active", disabled.body.version).expect(200);
      deviceOne = back.body;
      await set("active", 1).expect(409);
      await k(kiosk.one).post("/sessions").expect(201);
    });
  });

  describe("existing patient", () => {
    it("recognises a patient from number, birth date and given name, showing initials only, and gives a ticket", async () => {
      const maria = await newPatient("Maria");
      const session = await openSession(kiosk.two);
      const answer = await k(kiosk.two, session)
        .post("/identify", { key: maria.number.toLowerCase(), birthDate: maria.birthDate, givenName: " MARIA " })
        .expect(200);
      expect(answer.body).toEqual({ maskedName: "M*** S***", birthYear: Number(maria.birthDate.slice(0, 4)) });
      expect(JSON.stringify(answer.body)).not.toMatch(/Santos|aria/);

      const services = (await k(kiosk.two).get("/services").expect(200)).body.items as Array<{ id: string; name: string }>;
      expect(services).toEqual([{ id: visitTypeId, name: "Consultation" }]);

      const ticket = (await k(kiosk.two, session).post("/check-in", { visitTypeId }).expect(201)).body;
      expect(ticket).toMatchObject({ ticket: expect.stringMatching(/^A-\d{3}$/), facilityName: "Main Clinic", instructions: expect.any(String) });
      expect(Object.keys(ticket).sort()).toEqual(["facilityName", "instructions", "issuedAt", "printJobId", "queueNumber", "ticket"]);
      expect(JSON.stringify(ticket)).not.toMatch(/Maria|Santos/);

      const row = await queueRow(ticket.ticket);
      expect(row).toMatchObject({ status: "waiting", checkedInVia: "kiosk" });
      const stored = await ctx.pool.query(`SELECT checked_in_by, arrival_mode FROM visit WHERE id = $1`, [row!.id]);
      expect(stored.rows[0]).toEqual({ checked_in_by: null, arrival_mode: "walk_in" });

      const again = await k(kiosk.two, session).post("/check-in", { visitTypeId }).expect(409);
      expect(again.body.error.code).toBe("already_in_queue");
      const audit = await auditRows(ctx.pool, `action = 'visit.kiosk-walk-in'`);
      expect(audit.at(-1)).toMatchObject({ patient_id: maria.id });
      await k(kiosk.two, session).delete("/sessions").expect(204);
      await k(kiosk.two, session).get("/appointments").expect(422);
    });

    it("answers every failed identification the same way and locks the session after three", async () => {
      const lina = await newPatient("Lina");
      const session = await openSession(kiosk.three);
      const wrong = [
        { key: lina.number, birthDate: "1999-01-01", givenName: lina.givenName },
        { key: lina.number, birthDate: lina.birthDate, givenName: "Someone" },
        { key: "P99999999", birthDate: lina.birthDate, givenName: lina.givenName },
      ];
      const answers = [];
      for (const body of wrong.slice(0, 2)) answers.push((await k(kiosk.three, session).post("/identify", body).expect(422)).body.error);
      expect(answers[0]).toEqual(expect.objectContaining({ code: "identification_failed" }));
      expect(answers[0].message).toBe(answers[1].message);
      expect((await k(kiosk.three, session).post("/identify", wrong[2]).expect(422)).body.error.code).toBe("kiosk_session_locked");
      // Even the right answers do not open a locked session.
      expect(
        (await k(kiosk.three, session).post("/identify", { key: lina.number, birthDate: lina.birthDate, givenName: lina.givenName }).expect(422)).body.error
          .code,
      ).toBe("kiosk_session_expired");
      const stored = await ctx.pool.query(
        `SELECT status, failed_attempts, patient_id FROM kiosk_session WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-3') ORDER BY created_at DESC LIMIT 1`,
      );
      expect(stored.rows[0]).toEqual({ status: "locked", failed_attempts: 3, patient_id: null });
    });

    it("stops a kiosk that keeps guessing across sessions, until the window has passed", async () => {
      const guess = { key: "P00000001", birthDate: "1990-01-01", givenName: "Nobody" };
      const annex = (session?: string) => k(kiosk.annex, session, tenant.otherFacilityId);
      for (let i = 0; i < 3; i++) {
        const session = (await annex().post("/sessions").expect(201)).body.token as string;
        for (let miss = 0; miss < 3; miss++) await annex(session).post("/identify", guess).expect(422);
      }
      expect((await annex().post("/sessions").expect(422)).body.error.code).toBe("kiosk_cooling_down");
      await ctx.pool.query(
        `UPDATE kiosk_session SET created_at = now() - interval '11 minutes' WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'annex-1')`,
      );
      await annex().post("/sessions").expect(201);
    });

    it("does not offer a service the organization has not switched on for kiosks, nor an unknown one", async () => {
      const rosa = await newPatient("Rosa");
      const session = await identified(kiosk.two, rosa);
      expect((await k(kiosk.two, session).post("/check-in", { visitTypeId: hiddenTypeId }).expect(422)).body.error.code).toBe("not_available_at_kiosk");
      await k(kiosk.two, session).post("/check-in", { visitTypeId: "00000000-0000-4000-8000-000000000000" }).expect(404);
      await k(kiosk.two, session).post("/check-in", {}).expect(400);
      await k(kiosk.two, session).delete("/sessions");
    });

    it("needs identification before anything about a patient, and keeps sessions to their own kiosk", async () => {
      const session = await openSession(kiosk.two);
      expect((await k(kiosk.two, session).get("/appointments").expect(422)).body.error.code).toBe("kiosk_not_identified");
      expect((await k(kiosk.two, session).post("/check-in", { visitTypeId }).expect(422)).body.error.code).toBe("kiosk_not_identified");
      await k(kiosk.three, session).get("/appointments").expect(422);
      await k(kiosk.three, session).post("/identify", { key: "P00000001", birthDate: "1990-01-01", givenName: "X" }).expect(422);
      await k(kiosk.two).get("/appointments").expect(422);
      await k(kiosk.two, "not-a-session").get("/appointments").expect(422);
      await k(kiosk.two, session).delete("/sessions");
    });

    it("ends a session that has been idle too long", async () => {
      const rosa = await newPatient("Ida");
      const session = await identified(kiosk.two, rosa);
      await ctx.pool.query(
        `UPDATE kiosk_session SET expires_at = now() - interval '1 second' WHERE status = 'active' AND device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2')`,
      );
      expect((await k(kiosk.two, session).post("/check-in", { visitTypeId }).expect(422)).body.error.code).toBe("kiosk_session_expired");
      const stored = await ctx.pool.query(
        `SELECT status FROM kiosk_session WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2') ORDER BY created_at DESC LIMIT 1`,
      );
      expect(stored.rows[0].status).toBe("expired");
    });

    it("closes sessions nobody ended, in the background", async () => {
      await openSession(kiosk.three);
      await ctx.pool.query(`UPDATE kiosk_session SET expires_at = now() - interval '1 minute' WHERE status = 'active'`);
      const closed = await underPlatform(ctx.app.get(KioskSessionService)).expireDue();
      expect(closed).toBeGreaterThanOrEqual(1);
      expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM kiosk_session WHERE status = 'active' AND expires_at < now()`)).rows[0].n).toBe(0);
    });

    it("hands out distinct tickets to patients checking in at the same moment", async () => {
      const people = await Promise.all([newPatient("Ana"), newPatient("Bea"), newPatient("Cora")]);
      const tokens = [kiosk.one, kiosk.two, kiosk.three];
      const sessions = await Promise.all(people.map((p, i) => identified(tokens[i]!, p)));
      const tickets = await Promise.all(sessions.map((s, i) => k(tokens[i]!, s).post("/check-in", { visitTypeId }).expect(201)));
      const labels = tickets.map((t) => t.body.ticket as string);
      expect(new Set(labels).size).toBe(3);
      await Promise.all(sessions.map((s, i) => k(tokens[i]!, s).delete("/sessions")));
    });
  });

  describe("appointment check-in", () => {
    async function book(patientId: string, startsInMinutes: number, offsetMinutes: number) {
      const created = await staff(admin)
        .post("/appointments", {
          patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId,
          startsAt: new Date(Date.now() + 5 * 3_600_000 + offsetMinutes * 60_000).toISOString(),
          outsideSchedule: true,
        })
        .expect(201);
      const id = created.body[0].id as string;
      await ctx.pool.query(
        `UPDATE appointment SET starts_at = now() + make_interval(mins => $2), ends_at = now() + make_interval(mins => $2 + 20) WHERE id = $1`,
        [id, startsInMinutes],
      );
      return id;
    }

    it("lists today's appointments with whether check-in is open, and checks the patient in once", async () => {
      const pia = await newPatient("Pia");
      const soon = await book(pia.id, 20, 0);
      const later = await book(pia.id, 400, 60);
      const session = await identified(kiosk.one, pia);
      const listed = (await k(kiosk.one, session).get("/appointments").expect(200)).body.items as Array<{
        id: string;
        checkIn: string;
        service: string;
        practitioner: string;
      }>;
      expect(listed.find((a) => a.id === soon)).toMatchObject({ checkIn: "open", service: "Consultation", practitioner: expect.stringContaining("Dr.") });
      expect(Object.keys(listed[0]!).sort()).toEqual(["checkIn", "id", "practitioner", "service", "startsAt"]);
      // 400 minutes ahead is beyond the opening of the check-in window (60 minutes by default), or on another day.
      expect(listed.find((a) => a.id === later)?.checkIn ?? "too_early").toBe("too_early");
      expect((await k(kiosk.one, session).post("/check-in", { appointmentId: later }).expect(422)).body.error.code).toBe("check_in_too_early");

      const ticket = (await k(kiosk.one, session).post("/check-in", { appointmentId: soon }).expect(201)).body;
      const again = (await k(kiosk.one, session).post("/check-in", { appointmentId: soon }).expect(201)).body;
      expect(again.ticket).toBe(ticket.ticket);
      const row = await queueRow(ticket.ticket);
      expect(row).toMatchObject({ checkedInVia: "kiosk" });
      const stored = await ctx.pool.query(`SELECT a.status, v.arrival_mode FROM appointment a JOIN visit v ON v.appointment_id = a.id WHERE a.id = $1`, [soon]);
      expect(stored.rows).toEqual([{ status: "checked_in", arrival_mode: "appointment" }]);
      expect((await k(kiosk.one, session).get("/appointments").expect(200)).body.items.find((a: { id: string }) => a.id === soon).checkIn).toBe("done");
      await k(kiosk.one, session).delete("/sessions");
    });

    it("never checks in someone else's appointment, and not after the window has closed", async () => {
      const cora = await newPatient("Dina");
      const other = await newPatient("Elsa");
      const theirs = await book(other.id, 120, 120);
      const session = await identified(kiosk.one, cora);
      await k(kiosk.one, session).post("/check-in", { appointmentId: theirs }).expect(404);
      const late = await book(cora.id, -60, 180);
      expect((await k(kiosk.one, session).post("/check-in", { appointmentId: late }).expect(422)).body.error.code).toBe("check_in_too_late");
      await k(kiosk.one, session).delete("/sessions");
    });
  });

  describe("new patient registration", () => {
    const typed = (over: Record<string, unknown> = {}) => ({
      familyName: "Reyes",
      givenName: "Lorna",
      sex: "female",
      birthDate: "1992-02-02",
      contacts: [{ system: "mobile", value: "0917 555 0101" }],
      addresses: [{ cityMunicipality: "Quezon City" }],
      emergencyContact: { name: "Pedro Reyes", contactNumber: "0917 555 0102", relationship: "spouse" },
      privacyAcknowledged: true,
      ...over,
    });

    it("stages the registration sealed, answers only a reference, and lets staff approve it into a patient and a ticket", async () => {
      const session = await openSession(kiosk.one);
      const submitted = await k(kiosk.one, session).post("/registrations", typed()).expect(201);
      expect(Object.keys(submitted.body).sort()).toEqual(["expiresAt", "reference"]);
      expect(submitted.body.reference).toMatch(/^KR-[A-HJ-NP-Z2-9]{6}$/);
      // The same session cannot register twice: it returns the same reference.
      expect((await k(kiosk.one, session).post("/registrations", typed()).expect(201)).body.reference).toBe(submitted.body.reference);

      const stored = await ctx.pool.query(`SELECT payload_sealed, status FROM kiosk_registration WHERE reference = $1`, [submitted.body.reference]);
      expect(stored.rows[0].status).toBe("pending");
      expect(stored.rows[0].payload_sealed).toMatch(/^v2\./);
      expect(stored.rows[0].payload_sealed).not.toMatch(/Reyes|Lorna|0917/);

      const pending = (await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<Record<string, unknown>>;
      const item = pending.find((p) => p.reference === submitted.body.reference)!;
      expect(JSON.stringify(item)).not.toMatch(/Reyes|Lorna/);
      expect(item).toMatchObject({ kiosk: "Kiosk front-1", possibleDuplicates: 0 });

      const detail = (await staff(desk).get(`/kiosk/admin/registrations/${item.id}`).expect(200)).body;
      expect(detail.registration).toMatchObject({ familyName: "Reyes", givenName: "Lorna" });
      expect((await auditRows(ctx.pool, `action = 'kiosk.registration.view' AND resource_id = $1`, [item.id as string])).length).toBe(1);

      const approved = (
        await staff(desk)
          .post(`/kiosk/admin/registrations/${item.id}/approve`, { visitTypeId, identityChecked: true, identityNote: "PhilHealth ID shown" })
          .expect(200)
      ).body;
      expect(approved).toMatchObject({ patientId: expect.any(String), patientNumber: expect.stringMatching(/^P\d{8}$/), visitId: expect.any(String) });
      const patient = (await staff(desk).get(`/patients/${approved.patientId}`).expect(200)).body;
      expect(patient).toMatchObject({ familyName: "Reyes", givenName: "Lorna" });

      const decided = await ctx.pool.query(`SELECT status, payload_sealed, patient_id, reviewed_by FROM kiosk_registration WHERE id = $1`, [item.id]);
      expect(decided.rows[0]).toMatchObject({ status: "approved", payload_sealed: null, patient_id: approved.patientId });
      expect(decided.rows[0].reviewed_by).not.toBeNull();
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/approve`, { identityChecked: true }).expect(422);
      await staff(desk).get(`/kiosk/admin/registrations/${item.id}`).expect(422);
      await k(kiosk.one, session).delete("/sessions");
    });

    it("applies the front desk's duplicate rule: a likely duplicate is refused until the reviewer confirms it", async () => {
      const existing = await newPatient("Nena");
      const session = await openSession(kiosk.two);
      const dup = typed({
        familyName: `Santos${n}`,
        givenName: "Nena",
        birthDate: existing.birthDate,
        contacts: [{ system: "mobile", value: existing.mobile }],
      });
      const ref = (await k(kiosk.two, session).post("/registrations", dup).expect(201)).body.reference;
      const item = (
        (await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<{ id: string; reference: string; possibleDuplicates: number }>
      ).find((p) => p.reference === ref)!;
      expect(item.possibleDuplicates).toBeGreaterThan(0);
      const refused = await staff(desk).post(`/kiosk/admin/registrations/${item.id}/approve`, { identityChecked: true }).expect(409);
      expect(["possible_duplicates", "identifier_in_use"]).toContain(refused.body.error.code);
      expect((await ctx.pool.query(`SELECT status FROM kiosk_registration WHERE id = $1`, [item.id])).rows[0].status).toBe("pending");

      const linked = (
        await staff(desk).post(`/kiosk/admin/registrations/${item.id}/link`, { patientId: existing.id, visitTypeId, identityChecked: true }).expect(200)
      ).body;
      expect(linked.patientId).toBe(existing.id);
      expect((await ctx.pool.query(`SELECT status, payload_sealed FROM kiosk_registration WHERE id = $1`, [item.id])).rows[0]).toEqual({
        status: "linked",
        payload_sealed: null,
      });
      await k(kiosk.two, session).delete("/sessions");
    });

    it("rejects with a reason and erases what was typed", async () => {
      const session = await openSession(kiosk.three);
      const ref = (
        await k(kiosk.three, session)
          .post("/registrations", typed({ givenName: "Test", familyName: "Spam" }))
          .expect(201)
      ).body.reference;
      const item = ((await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<{ id: string; reference: string }>).find(
        (p) => p.reference === ref,
      )!;
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/reject`, { reason: "x" }).expect(400);
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/reject`, { reason: "Not a real person" }).expect(200);
      expect((await ctx.pool.query(`SELECT status, payload_sealed, decision_reason FROM kiosk_registration WHERE id = $1`, [item.id])).rows[0]).toEqual({
        status: "rejected",
        payload_sealed: null,
        decision_reason: "Not a real person",
      });
      await expect(ctx.pool.query(`UPDATE kiosk_registration SET status = 'pending' WHERE id = $1`, [item.id])).rejects.toThrow();
      await k(kiosk.three, session).delete("/sessions");
    });

    it("erases submissions nobody reviewed within the time allowed", async () => {
      const session = await openSession(kiosk.three);
      const ref = (
        await k(kiosk.three, session)
          .post("/registrations", typed({ givenName: "Late", familyName: "Arrival" }))
          .expect(201)
      ).body.reference;
      await ctx.pool.query(`UPDATE kiosk_registration SET expires_at = now() - interval '1 minute' WHERE reference = $1`, [ref]);
      const expired = await underPlatform(ctx.app.get(KioskRegistrationService)).expireDue();
      expect(expired).toBeGreaterThanOrEqual(1);
      expect((await ctx.pool.query(`SELECT status, payload_sealed FROM kiosk_registration WHERE reference = $1`, [ref])).rows[0]).toEqual({
        status: "expired",
        payload_sealed: null,
      });
      await k(kiosk.three, session).delete("/sessions");
    });

    it("requires the privacy acknowledgement and refuses an identified patient or an unprivileged reviewer", async () => {
      const session = await openSession(kiosk.one);
      await k(kiosk.one, session)
        .post("/registrations", typed({ privacyAcknowledged: false }))
        .expect(400);
      await k(kiosk.one, session)
        .post("/registrations", typed({ birthDate: "2999-01-01" }))
        .expect(400);
      await k(kiosk.one, session).delete("/sessions");
      const ida = await newPatient("Ines");
      const known = await identified(kiosk.one, ida);
      expect((await k(kiosk.one, known).post("/registrations", typed()).expect(422)).body.error.code).toBe("kiosk_already_identified");
      await k(kiosk.one, known).delete("/sessions");
      await staff(kiosk.one).get("/kiosk/admin/registrations").expect(403);
    });

    it("will not register or link anyone before the reviewer confirms they checked identification, and keeps that in the audit trail", async () => {
      const session = await openSession(kiosk.two);
      const reference = (
        await k(kiosk.two, session)
          .post("/registrations", typed({ givenName: "Check", familyName: "Identity", birthDate: "1969-09-09" }))
          .expect(201)
      ).body.reference as string;
      const item = ((await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<{ id: string; reference: string }>).find(
        (r) => r.reference === reference,
      )!;

      // Nothing happens without the confirmation: no patient is created and the registration still waits.
      const refused = await staff(desk).post(`/kiosk/admin/registrations/${item.id}/approve`, {}).expect(400);
      expect(JSON.stringify(refused.body)).toMatch(/checked the person/);
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/approve`, { identityChecked: false }).expect(400);
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/link`, { patientId: item.id }).expect(400);
      expect((await ctx.pool.query(`SELECT status FROM kiosk_registration WHERE id = $1`, [item.id])).rows[0].status).toBe("pending");

      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/approve`, { identityChecked: true, identityNote: "Driver's licence shown" }).expect(200);
      const audit = await auditRows(ctx.pool, `action = 'kiosk.registration.approve' AND resource_id = $1`, [item.id]);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({ reference, identityChecked: true, identityNote: "Driver's licence shown" });
    });

    it("counts the registrations waiting in the navigation badge, for reviewers only", async () => {
      const badge = async (token: string) => (await staff(token).get("/me/badges").expect(200)).body.kioskRegistrations as number | null;
      const before = await badge(desk);
      expect(before).toEqual(expect.any(Number));
      expect(await badge(kiosk.one)).toBeNull();

      const session = await openSession(kiosk.three);
      const reference = (
        await k(kiosk.three, session)
          .post("/registrations", typed({ givenName: "Badge", familyName: "Counter", birthDate: "1970-07-07" }))
          .expect(201)
      ).body.reference as string;
      expect(await badge(desk)).toBe(before! + 1);

      const item = ((await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<{ id: string; reference: string }>).find(
        (r) => r.reference === reference,
      )!;
      await staff(desk).post(`/kiosk/admin/registrations/${item.id}/reject`, { reason: "Counted, then declined" }).expect(200);
      expect(await badge(desk)).toBe(before);
    });
  });

  describe("skipping a called patient", () => {
    async function ticketFor(token: string, name: string) {
      const person = await newPatient(name);
      const session = await identified(token, person);
      const ticket = (await k(token, session).post("/check-in", { visitTypeId }).expect(201)).body.ticket as string;
      await k(token, session).delete("/sessions");
      return ticket;
    }
    const call = async (ticket: string, place = "Room 1") => {
      const row = (await queueRow(ticket))!;
      return (await staff(desk).post(`/queue/visits/${row.id}/call`, { calledTo: place, version: row.version }).expect(200)).body;
    };

    it("puts the patient back behind those who arrived since, and only after a call", async () => {
      const first = await ticketFor(kiosk.one, "Una");
      const second = await ticketFor(kiosk.two, "Vera");
      const third = await ticketFor(kiosk.three, "Wena");
      const before = (await staff(desk).get("/queue").expect(200)).body.map((r: { ticket: string }) => r.ticket);
      expect(before.indexOf(first)).toBeLessThan(before.indexOf(second));

      const row = (await queueRow(first))!;
      expect((await staff(desk).post(`/queue/visits/${row.id}/skip`, { version: row.version }).expect(422)).body.error.code).toBe("not_called");
      const called = await call(first);
      const skipped = (await staff(desk).post(`/queue/visits/${row.id}/skip`, { version: called.version, reason: "Not at the counter" }).expect(200)).body;
      expect(skipped).toMatchObject({ calledAt: null, calledTo: null, skippedCount: 1, status: "waiting" });
      const after = (await staff(desk).get("/queue").expect(200)).body.map((r: { ticket: string }) => r.ticket);
      expect(after.indexOf(first)).toBeGreaterThan(after.indexOf(third));
      expect(after.indexOf(second)).toBeLessThan(after.indexOf(first));
      expect((await auditRows(ctx.pool, `action = 'visit.skip' AND resource_id = $1`, [row.id])).length).toBe(1);
      // The original arrival time is untouched.
      const times = await ctx.pool.query(`SELECT checked_in_at < queued_at AS later FROM visit WHERE id = $1`, [row.id]);
      expect(times.rows[0].later).toBe(true);

      // Three skips in all; then staff must close the visit instead.
      let latest = skipped;
      for (let i = 0; i < 2; i++) {
        const c = await call(first);
        latest = (await staff(desk).post(`/queue/visits/${row.id}/skip`, { version: c.version }).expect(200)).body;
      }
      expect(latest.skippedCount).toBe(3);
      const last = await call(first);
      expect((await staff(desk).post(`/queue/visits/${row.id}/skip`, { version: last.version }).expect(422)).body.error.code).toBe("skip_limit_reached");
      await staff(kiosk.one).post(`/queue/visits/${row.id}/skip`, { version: last.version }).expect(403);
    });
  });

  // Phase 6 audit regression tests (docs/security/kiosk-audit-phase-6.md).
  describe("audit findings", () => {
    const typedBody = (over: Record<string, unknown> = {}) => ({
      familyName: "Auditor",
      givenName: "Anya",
      sex: "female",
      birthDate: "1991-03-03",
      contacts: [{ system: "mobile", value: "0917 888 0101" }],
      addresses: [{ cityMunicipality: "Quezon City" }],
      emergencyContact: { name: "Pedro Auditor", contactNumber: "0917 888 0102", relationship: "spouse" },
      privacyAcknowledged: true,
      ...over,
    });
    async function submit(token: string, over: Record<string, unknown> = {}) {
      const session = await openSession(token);
      const reference = (await k(token, session).post("/registrations", typedBody(over)).expect(201)).body.reference as string;
      await k(token, session).delete("/sessions");
      const pending = (await staff(desk).get("/kiosk/admin/registrations").expect(200)).body.items as Array<{ id: string; reference: string }>;
      return pending.find((p) => p.reference === reference)!.id;
    }

    it("KA-01: guesses sent in parallel cannot beat the three-attempt limit", async () => {
      await ctx.pool.query(`UPDATE kiosk_session SET failed_attempts = 0 WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2')`);
      const who = await newPatient("Guessed");
      const session = await openSession(kiosk.two);
      const guesses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          k(kiosk.two, session).post("/identify", { key: who.number, birthDate: `19${60 + (i % 30)}-01-01`, givenName: "Nobody" }),
        ),
      );
      expect(guesses.every((g) => g.status === 422)).toBe(true);
      const stored = await ctx.pool.query(
        `SELECT status, failed_attempts FROM kiosk_session WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2') ORDER BY created_at DESC LIMIT 1`,
      );
      expect(stored.rows[0]).toEqual({ status: "locked", failed_attempts: 3 });
      // Even the right answers are refused once the session is locked.
      await k(kiosk.two, session).post("/identify", { key: who.number, birthDate: who.birthDate, givenName: who.givenName }).expect(422);
      await ctx.pool.query(`UPDATE kiosk_session SET failed_attempts = 0 WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2')`);
    });

    it("KA-01: two misses and then the right answer still identifies, and the misses do not pile up", async () => {
      const who = await newPatient("Careful");
      const session = await openSession(kiosk.two);
      for (let i = 0; i < 2; i++) {
        await k(kiosk.two, session).post("/identify", { key: who.number, birthDate: "1950-01-01", givenName: who.givenName }).expect(422);
      }
      await k(kiosk.two, session).post("/identify", { key: who.number, birthDate: who.birthDate, givenName: who.givenName }).expect(200);
      const stored = await ctx.pool.query(
        `SELECT status, failed_attempts FROM kiosk_session WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2') ORDER BY created_at DESC LIMIT 1`,
      );
      expect(stored.rows[0]).toEqual({ status: "active", failed_attempts: 2 });
      await k(kiosk.two, session).delete("/sessions");
      await ctx.pool.query(`UPDATE kiosk_session SET failed_attempts = 0 WHERE device_id = (SELECT id FROM kiosk_device WHERE code = 'front-2')`);
    });

    it("KA-02: a patient who cannot be queued is still linked to the submission, not left as an orphan", async () => {
      const id = await submit(kiosk.one, { familyName: "Orphaned", givenName: "Opal", birthDate: "1993-04-04" });
      const approved = await staff(desk)
        .post(`/kiosk/admin/registrations/${id}/approve`, { identityChecked: true, visitTypeId: "00000000-0000-4000-8000-000000000000" })
        .expect(200);
      expect(approved.body).toMatchObject({ queued: false, visitId: null, queueError: expect.any(String), patientId: expect.any(String) });
      const row = (await ctx.pool.query(`SELECT status, patient_id, payload_sealed FROM kiosk_registration WHERE id = $1`, [id])).rows[0];
      expect(row).toMatchObject({ status: "approved", patient_id: approved.body.patientId, payload_sealed: null });
    });

    it("KA-02: two reviewers approving at once create one patient", async () => {
      const id = await submit(kiosk.one, { familyName: "Twice", givenName: "Tess", birthDate: "1994-05-05" });
      const results = await Promise.all([
        staff(desk).post(`/kiosk/admin/registrations/${id}/approve`, { identityChecked: true }),
        staff(admin).post(`/kiosk/admin/registrations/${id}/approve`, { identityChecked: true }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(["registration_in_review", "registration_decided"]).toContain(results.find((r) => r.status === 422)!.body.error.code);
      const made = await ctx.pool.query(`SELECT count(*)::int AS n FROM patient WHERE family_name = 'Twice'`);
      expect(made.rows[0].n).toBe(1);
    });

    it("KA-02: a refused approval releases the registration for the next try", async () => {
      const existing = await newPatient("Dup");
      const id = await submit(kiosk.one, {
        familyName: `Santos${n}`,
        givenName: "Dup",
        birthDate: existing.birthDate,
        contacts: [{ system: "mobile", value: existing.mobile }],
      });
      const refused = await staff(desk).post(`/kiosk/admin/registrations/${id}/approve`, { identityChecked: true });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("possible_duplicates");
      const claim = await ctx.pool.query(`SELECT claimed_at FROM kiosk_registration WHERE id = $1`, [id]);
      expect(claim.rows[0].claimed_at).toBeNull();
      await staff(desk).post(`/kiosk/admin/registrations/${id}/link`, { identityChecked: true, patientId: existing.id }).expect(200);
    });

    it("KA-03: a kiosk cannot overwrite the printer status", async () => {
      await ctx.pool.query(`UPDATE kiosk_device SET printer_status = 'paper_out' WHERE code = 'front-1'`);
      await k(kiosk.one).post("/heartbeat", { appVersion: "1.0.1", printerStatus: "ok" }).expect(200);
      const row = await ctx.pool.query(`SELECT printer_status, app_version FROM kiosk_device WHERE code = 'front-1'`);
      expect(row.rows[0]).toEqual({ printer_status: "paper_out", app_version: "1.0.1" });
      await ctx.pool.query(`UPDATE kiosk_device SET printer_status = 'unknown' WHERE code = 'front-1'`);
    });
  });
});
