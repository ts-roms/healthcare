import { AutomaticNoShows } from "@healthcare/clinic";
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

const PASSWORD = "Maaraw-na-umaga-2026";
const ORG = "attend-org";

/**
 * Automatic no-shows at the end of the day and online check-in for in-person appointments, both per clinic and off by
 * default (docs/domains/clinic.md, "Automatic no-shows and online check-in").
 */
describe("automatic no-shows and online check-in", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let practitionerId: string;
  let visitTypeId: string;
  let rulesVersion: number | undefined;

  const staff = () => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(admin, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(admin, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(admin, tenant.facilityId)).send(body),
  });
  const portal = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  async function setRules(over: Record<string, unknown>) {
    const res = await staff()
      .put(`/clinic/booking-rules/${tenant.facilityId}`, {
        minLeadMinutes: 120,
        maxAdvanceDays: 60,
        maxUpcoming: 3,
        changeCutoffMinutes: 120,
        waitlistEnabled: false,
        maxWaitlistEntries: 3,
        ...over,
        version: rulesVersion,
      })
      .expect(200);
    rulesVersion = res.body.version;
    return res.body;
  }
  let registered = 0;
  async function portalPatient(givenName: string) {
    registered += 1;
    const birthDate = `${1970 + registered}-06-${String(10 + registered)}`;
    const email = `${givenName.toLowerCase()}@attend.ph`;
    const created = await staff()
      .post("/patients", {
        familyName: `Lopez${registered}`,
        givenName,
        sex: "male",
        birthDate,
        contacts: [{ system: "mobile", value: `0917 444 ${1000 + registered}` }],
      })
      .expect(201);
    const patientId = created.body.id as string;
    await staff().post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff().post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: ORG, patientNumber: created.body.patientNumber, birthDate, activationCode: code, email, password: PASSWORD })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: ORG, email, password: PASSWORD }).expect(200)).body
      .accessToken as string;
    return { patientId, token };
  }
  async function book(patientId: string, startsAt: Date): Promise<string> {
    const res = await staff()
      .post("/appointments", { patientId, practitionerId, facilityId: tenant.facilityId, visitTypeId, startsAt: startsAt.toISOString(), outsideSchedule: true })
      .expect(201);
    return res.body[0].id as string;
  }
  /** Test shortcut: moves an appointment to a time already past (staff cannot book in the past). */
  async function moveTo(appointmentId: string, startsAt: string) {
    const start = new Date(startsAt);
    await ctx.pool.query(`UPDATE appointment SET starts_at = $2, ends_at = $3 WHERE id = $1`, [appointmentId, start, new Date(start.getTime() + 30 * 60_000)]);
  }
  const status = async (id: string) => (await ctx.pool.query(`SELECT status, no_show_automatic FROM appointment WHERE id = $1`, [id])).rows[0];

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@attend.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@attend.ph", ["physician"]));
    admin = (await login(ctx, "admin@attend.ph")).accessToken;
    visitTypeId = (await staff().post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 30 }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  describe("automatic no-shows", () => {
    let yesterday: string;
    let early: string;
    let attended: string;
    let patientId: string;

    beforeAll(async () => {
      patientId = (await portalPatient("Andres")).patientId;
      yesterday = await book(patientId, new Date(Date.now() + 5 * 3_600_000));
      await moveTo(yesterday, `${manilaDate(-1)}T09:00:00+08:00`);
      early = await book(patientId, new Date(Date.now() + 6 * 3_600_000));
      await moveTo(early, `${manilaDate(-1)}T10:00:00+08:00`);
      attended = await book(patientId, new Date(Date.now() + 7 * 3_600_000));
      await moveTo(attended, `${manilaDate(-1)}T11:00:00+08:00`);
      await ctx.pool.query(`UPDATE appointment SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'test' WHERE id = $1`, [attended]);
    });

    it("leaves unattended appointments alone while the clinic has not turned it on", async () => {
      expect(await ctx.app.get(AutomaticNoShows).run()).toEqual({ marked: 0 });
      expect(await status(yesterday)).toEqual({ status: "booked", no_show_automatic: false });
    });

    it("waits for the clinic's hour on the appointment's day, then marks them once, audited and followed up", async () => {
      const saved = await setRules({ autoNoShow: true, autoNoShowHour: 18 });
      expect(saved.rules).toMatchObject({ autoNoShow: true, autoNoShowHour: 18, onlineCheckIn: false });
      const job = ctx.app.get(AutomaticNoShows);
      // 17:00 in Manila on the day: past the appointments, but before the clinic's hour.
      expect(await job.run(new Date(`${manilaDate(-1)}T17:00:00+08:00`))).toEqual({ marked: 0 });
      expect(await job.run(new Date(`${manilaDate(-1)}T18:00:00+08:00`))).toEqual({ marked: 2 });
      expect(await job.run()).toEqual({ marked: 0 });
      expect(await status(yesterday)).toEqual({ status: "no_show", no_show_automatic: true });
      expect(await status(early)).toEqual({ status: "no_show", no_show_automatic: true });
      expect((await status(attended)).status).toBe("cancelled");
      const audit = await auditRows(ctx.pool, `action = 'appointment.no-show' AND resource_id = $1`, [yesterday]);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: "system", patient_id: patientId, metadata: { automatic: true } });
      await drainEvents(ctx);
      const followUp = await ctx.pool.query(`SELECT template_key FROM notification WHERE recipient_patient_id = $1 AND template_key LIKE 'appointment.%'`, [
        patientId,
      ]);
      expect(followUp.rows.length).toBeGreaterThan(0);
    });
  });

  describe("online check-in", () => {
    let patient: { patientId: string; token: string };
    let soon: string;
    let later: string;

    beforeAll(async () => {
      patient = await portalPatient("Bea");
      soon = await book(patient.patientId, new Date(Date.now() + 20 * 60_000));
      later = await book(patient.patientId, new Date(Date.now() + 3 * 3_600_000));
    });

    it("is refused where the clinic does not offer it", async () => {
      await setRules({ autoNoShow: false, onlineCheckIn: false });
      const list = (await portal(patient.token).get("/appointments").expect(200)).body.upcoming as Array<{
        id: string;
        canCheckIn: boolean;
        checkInOpensAt: string | null;
      }>;
      expect(list.find((a) => a.id === soon)).toMatchObject({ canCheckIn: false, checkInOpensAt: null });
      await portal(patient.token)
        .post(`/appointments/${soon}/check-in`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("online_check_in_not_offered"));
    });

    it("opens a window before the start and checks the patient into the queue for triage, once", async () => {
      await setRules({ onlineCheckIn: true, checkInOpensMinutes: 60, checkInClosesMinutes: 15 });
      const list = (await portal(patient.token).get("/appointments").expect(200)).body.upcoming as Array<{
        id: string;
        canCheckIn: boolean;
        checkInOpensAt: string | null;
      }>;
      expect(list.find((a) => a.id === soon)).toMatchObject({ canCheckIn: true, checkInOpensAt: null });
      const laterRow = list.find((a) => a.id === later)!;
      expect(laterRow.canCheckIn).toBe(false);
      expect(laterRow.checkInOpensAt).not.toBeNull();
      await portal(patient.token)
        .post(`/appointments/${later}/check-in`)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("check_in_too_early"));

      const checked = await portal(patient.token).post(`/appointments/${soon}/check-in`).expect(200);
      expect(checked.body).toMatchObject({ appointmentId: soon, status: "waiting", ticket: expect.stringMatching(/^A-\d{3}$/) });
      const again = await portal(patient.token).post(`/appointments/${soon}/check-in`).expect(200);
      expect(again.body.ticket).toBe(checked.body.ticket);
      const after = (await portal(patient.token).get("/appointments").expect(200)).body.upcoming as Array<{ id: string }>;
      expect(after.find((a) => a.id === soon)).toMatchObject({ status: "checked_in", canCheckIn: false, queueTicket: checked.body.ticket });

      const queue = (await staff().get("/queue").expect(200)).body as Array<{
        appointmentId: string;
        status: string;
        checkedInVia: string;
        checkedInBy: string | null;
      }>;
      expect(queue.find((v) => v.appointmentId === soon)).toMatchObject({ status: "waiting", checkedInVia: "patient_portal", checkedInBy: null });
      expect(await status(soon)).toMatchObject({ status: "checked_in" });
      const audit = await auditRows(ctx.pool, `action = 'appointment.check-in' AND resource_id = $1`, [soon]);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: patient.patientId, metadata: expect.objectContaining({ via: "patient_portal" }) });
    });

    it("does not reveal or check in another patient's appointment", async () => {
      const other = await portalPatient("Carlo");
      await portal(other.token).post(`/appointments/${later}/check-in`).expect(404);
    });
  });
});
