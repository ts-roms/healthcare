import { CarePlanRecallReminders } from "@healthcare/care-plan";
import { zonedToUtc } from "@healthcare/core";
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

/** Phase 4c: the MyHealth inbox, no-show follow-up and care-plan recall reminders. */
describe("patient outreach", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let practitionerId: string;
  let visitTypeId: string;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
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
  async function patient(givenName: string, withPortal: boolean) {
    registered += 1;
    const birthDate = `197${registered}-07-1${registered}`;
    const created = await staff(admin)
      .post("/api/v1/patients")
      .send({
        familyName: `Villanueva${registered}`,
        givenName,
        sex: "female",
        birthDate,
        contacts: [{ system: "mobile", value: `0919 333 040${registered}` }],
      })
      .expect(201);
    const patientId: string = created.body.id;
    if (!withPortal) return { patientId, token: "" };
    await staff(admin)
      .post(`/api/v1/patients/${patientId}/consents`)
      .send({ consentType: "portal_access", decision: "granted", capturedVia: "paper" })
      .expect(201);
    const code = (await staff(admin).post(`/api/v1/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const email = `${givenName.toLowerCase()}@outreach.ph`;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: "outreach-org", patientNumber: created.body.patientNumber, birthDate, activationCode: code, email, password: PATIENT_PASSWORD })
      .expect(200);
    const token: string = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "outreach-org", email, password: PATIENT_PASSWORD }).expect(200)
    ).body.accessToken;
    return { patientId, token };
  }

  async function sent(patientId: string, templateKey: string) {
    const rows = await ctx.pool.query(
      `SELECT channel, status, suppression_reason FROM notification WHERE recipient_patient_id = $1 AND template_key = $2 ORDER BY channel`,
      [patientId, templateKey],
    );
    return rows.rows;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "outreach-org");
    await createStaff(ctx.pool, tenant, "admin@outreach.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "lim@outreach.ph", ["physician"]));
    admin = (await login(ctx, "admin@outreach.ph")).accessToken;
    visitTypeId = (
      await staff(admin).post("/api/v1/clinic/visit-types").send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  describe("MyHealth inbox", () => {
    it("delivers a clinic message to the patient's inbox, only for patients with MyHealth", async () => {
      const rosa = await patient("Rosa", true);
      const lito = await patient("Lito", false);
      const message = {
        channel: "in_app",
        templateKey: "clinic.message",
        variables: { title: "Clinic closed on Friday", body: "The clinic is closed on Friday for the holiday." },
      };
      const delivered = await staff(admin)
        .post("/api/v1/notifications")
        .send({ ...message, recipient: { type: "patient", patientId: rosa.patientId } })
        .expect(201);
      expect(delivered.body.status).toBe("delivered");
      const suppressed = await staff(admin)
        .post("/api/v1/notifications")
        .send({ ...message, recipient: { type: "patient", patientId: lito.patientId } })
        .expect(201);
      expect(suppressed.body).toMatchObject({ status: "suppressed", suppressionReason: "no_portal_account" });

      expect((await portal(rosa.token).get("/messages/unread-count").expect(200)).body).toEqual({ unread: 1 });
      const inbox = await portal(rosa.token).get("/messages").expect(200);
      expect(inbox.body).toEqual([
        expect.objectContaining({
          id: delivered.body.id,
          subject: "Clinic closed on Friday",
          text: "The clinic is closed on Friday for the holiday.",
          readAt: null,
        }),
      ]);
      const audit = await auditRows(ctx.pool, "action = 'portal.messages-view'");
      expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: rosa.patientId });

      await portal(rosa.token).post(`/messages/${delivered.body.id}/read`).expect(204);
      await portal(rosa.token).post(`/messages/${delivered.body.id}/read`).expect(204);
      expect((await portal(rosa.token).get("/messages/unread-count").expect(200)).body).toEqual({ unread: 0 });
    });

    it("does not let a patient read or mark someone else's message", async () => {
      const ana = await patient("Ana", true);
      const ben = await patient("Ben", true);
      const other = await staff(admin)
        .post("/api/v1/notifications")
        .send({
          channel: "in_app",
          templateKey: "clinic.message",
          variables: { title: "Hi", body: "For someone else" },
          recipient: { type: "patient", patientId: ben.patientId },
        })
        .expect(201);
      await portal(ana.token).post(`/messages/${other.body.id}/read`).expect(404);
      expect((await portal(ana.token).get("/messages").expect(200)).body).toEqual([]);
    });

    it("refuses clinic messages by SMS (free text stays in MyHealth)", async () => {
      const cora = await patient("Cora", true);
      await staff(admin)
        .post("/api/v1/notifications")
        .send({
          channel: "sms",
          templateKey: "clinic.message",
          variables: { title: "Hi", body: "Text" },
          recipient: { type: "patient", patientId: cora.patientId },
        })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("channel_not_supported"));
    });
  });

  describe("no-show follow-up", () => {
    async function missed(patientId: string) {
      const booked = await staff(admin)
        .post("/api/v1/appointments")
        .send({
          patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId,
          startsAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          outsideSchedule: true,
        })
        .expect(201);
      await staff(admin).post(`/api/v1/appointments/${booked.body[0].id}/no-show`).send({ version: 1 }).expect(200);
      await drainEvents(ctx);
    }

    it("invites the patient to book again, by SMS and in MyHealth", async () => {
      const dina = await patient("Dina", true);
      await missed(dina.patientId);
      expect(await sent(dina.patientId, "appointment.no-show")).toEqual([
        { channel: "in_app", status: "delivered", suppression_reason: null },
        { channel: "sms", status: "queued", suppression_reason: null },
      ]);
      const inbox = await portal(dina.token).get("/messages").expect(200);
      expect(inbox.body[0].text).toMatch(/^We missed you at .+\. If you still need care, book a new visit in MyHealth or call the clinic\.$/);
    });

    it("stays quiet when the patient already has another visit booked", async () => {
      const ella = await patient("Ella", false);
      await staff(admin)
        .post("/api/v1/appointments")
        .send({
          patientId: ella.patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId,
          startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          outsideSchedule: true,
        })
        .expect(201);
      await missed(ella.patientId);
      expect(await sent(ella.patientId, "appointment.no-show")).toEqual([]);
    });
  });

  describe("care-plan recall reminders", () => {
    const tenAm = (days = 0) => zonedToUtc(manilaDate(days), "10:00", "Asia/Manila");
    let fe: { patientId: string; token: string };

    beforeAll(async () => {
      fe = await patient("Fe", true);
      await staff(admin)
        .post("/api/v1/care-plans")
        .send({
          patientId: fe.patientId,
          title: "Hypertension care plan",
          category: "chronic_disease",
          startDate: manilaDate(-30),
          activities: [
            { kind: "follow_up_appointment", description: "BP follow-up", assignee: "care_team", dueDate: manilaDate(3) },
            { kind: "laboratory_monitoring", description: "Lipid profile", assignee: "care_team", dueDate: manilaDate(-10) },
            { kind: "lifestyle", description: "Walk 30 minutes a day", assignee: "patient", dueDate: manilaDate(1) },
            { kind: "follow_up_appointment", description: "Next quarter review", assignee: "care_team", dueDate: manilaDate(40) },
          ],
        })
        .expect(201);
    });

    it("does not send at night", async () => {
      const night = zonedToUtc(manilaDate(0), "22:00", "Asia/Manila");
      expect(await ctx.app.get(CarePlanRecallReminders).run(night)).toEqual({ patients: 0, activities: 0 });
    });

    it("sends one message per patient for due and overdue follow-ups, naming no condition or test", async () => {
      const result = await ctx.app.get(CarePlanRecallReminders).run(tenAm());
      expect(result).toEqual({ patients: 1, activities: 2 });
      expect(await sent(fe.patientId, "care-plan.follow-up-due")).toEqual([
        { channel: "in_app", status: "delivered", suppression_reason: null },
        { channel: "sms", status: "queued", suppression_reason: null },
      ]);
      const inbox = await portal(fe.token).get("/messages").expect(200);
      const text: string = inbox.body[0].text;
      expect(text).toMatch(/has not been booked yet/); // the overdue one leads
      expect(text).not.toMatch(/Lipid|BP|Hypertension/);
      const reminders = await ctx.pool.query(`SELECT kind FROM care_plan_activity_reminder WHERE patient_id = $1 ORDER BY kind`, [fe.patientId]);
      expect(reminders.rows).toEqual([{ kind: "due" }, { kind: "overdue" }]);
    });

    it("sends each reminder once, and shows it on the recall list", async () => {
      expect(await ctx.app.get(CarePlanRecallReminders).run(tenAm())).toEqual({ patients: 0, activities: 0 });
      expect(await sent(fe.patientId, "care-plan.follow-up-due")).toHaveLength(2);
      const due = await staff(admin).get("/api/v1/care-plans/activities/due?withinDays=7").expect(200);
      const bp = due.body.find((a: { description: string }) => a.description === "BP follow-up");
      expect(bp.lastReminderAt).toEqual(expect.any(String));
    });

    it("reminds again once the due follow-up is a week overdue", async () => {
      const result = await ctx.app.get(CarePlanRecallReminders).run(tenAm(10));
      expect(result).toEqual({ patients: 1, activities: 1 });
      await expect(ctx.pool.query(`UPDATE care_plan_activity_reminder SET kind = 'due'`)).rejects.toThrow();
    });
  });
});
