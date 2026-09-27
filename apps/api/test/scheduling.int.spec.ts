import { dayOfWeek, zonedToUtc } from "@healthcare/core";
import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

describe("scheduling and appointments", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let patientId: string;
  let practitionerId: string;
  let visitTypeId: string;
  // A date two weeks ahead, so slots are always in the future.
  const date = manilaDate(14);
  const at = (time: string) => zonedToUtc(date, time, "Asia/Manila").toISOString();

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "sched-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@example.ph", ["receptionist"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@example.ph", ["physician"]));
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    desk = (await login(ctx, "desk@example.ph")).accessToken;

    const visitType = await ctx
      .http()
      .post("/api/v1/clinic/visit-types")
      .set(as(admin))
      .send({ code: "consult", name: "Consultation", defaultDurationMinutes: 30 })
      .expect(201);
    visitTypeId = visitType.body.id;
    await ctx
      .http()
      .post("/api/v1/clinic/schedules")
      .set(as(admin))
      .send({
        practitionerId,
        facilityId: tenant.facilityId,
        dayOfWeek: dayOfWeek(date),
        startTime: "09:00",
        endTime: "12:00",
        slotMinutes: 30,
        validFrom: manilaDate(0),
      })
      .expect(201);
    const patient = await ctx.http().post("/api/v1/patients").set(as(desk, tenant.facilityId)).send(juan).expect(201);
    patientId = patient.body.id;
  });

  afterAll(() => ctx.close());

  const book = (body: Record<string, unknown>) =>
    ctx
      .http()
      .post("/api/v1/appointments")
      .set(as(desk))
      .send({ patientId, practitionerId, facilityId: tenant.facilityId, visitTypeId, ...body });

  it("restricts clinic configuration to authorized staff", async () => {
    await ctx.http().post("/api/v1/clinic/visit-types").set(as(desk)).send({ code: "x-ray", name: "X-ray", defaultDurationMinutes: 15 }).expect(403);
  });

  it("rejects overlapping schedule blocks", async () => {
    const response = await ctx
      .http()
      .post("/api/v1/clinic/schedules")
      .set(as(admin))
      .send({
        practitionerId,
        facilityId: tenant.facilityId,
        dayOfWeek: dayOfWeek(date),
        startTime: "11:00",
        endTime: "13:00",
        slotMinutes: 30,
        validFrom: manilaDate(0),
      })
      .expect(409);
    expect(response.body.error.code).toBe("schedule_overlap");
  });

  it("lists availability in local facility time", async () => {
    const response = await ctx
      .http()
      .get(`/api/v1/appointments/availability?practitionerId=${practitionerId}&facilityId=${tenant.facilityId}&visitTypeId=${visitTypeId}&date=${date}`)
      .set(as(desk))
      .expect(200);
    expect(response.body.timeZone).toBe("Asia/Manila");
    expect(response.body.slots).toHaveLength(6);
    expect(response.body.slots[0].startsAt).toBe(new Date(at("09:00")).toISOString());
  });

  it("books inside the schedule and prevents double-booking in the database", async () => {
    const booked = await book({ startsAt: at("09:00"), reason: "Follow-up of blood pressure" }).expect(201);
    expect(booked.body).toEqual([expect.objectContaining({ status: "booked", practitionerId })]);

    const clash = await book({ startsAt: at("09:15") }).expect(409);
    expect(clash.body.error.code).toBe("slot_unavailable");
    // Even bypassing the schedule check, the exclusion constraint holds.
    await expect(
      ctx.pool.query(
        `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, booking_channel, created_by, updated_by)
         SELECT organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at + interval '10 minutes', ends_at, 'phone', created_by, updated_by
         FROM appointment WHERE id = $1`,
        [booked.body[0].id],
      ),
    ).rejects.toThrow(/appointment_practitioner_no_overlap/);

    const availability = await ctx
      .http()
      .get(`/api/v1/appointments/availability?practitionerId=${practitionerId}&facilityId=${tenant.facilityId}&visitTypeId=${visitTypeId}&date=${date}`)
      .set(as(desk))
      .expect(200);
    expect(availability.body.slots).toHaveLength(5);
  });

  it("refuses times outside the schedule unless explicitly allowed", async () => {
    const outside = await book({ startsAt: at("14:00") }).expect(422);
    expect(outside.body.error.code).toBe("outside_schedule");
    await book({ startsAt: at("14:00"), outsideSchedule: true }).expect(201);
  });

  it("honors facility closures such as declared holidays", async () => {
    await ctx
      .http()
      .post("/api/v1/clinic/schedule-exceptions")
      .set(as(admin))
      .send({ facilityId: tenant.facilityId, startsAt: at("11:00"), endsAt: at("12:00"), reason: "Declared holiday (half day)" })
      .expect(201);
    const response = await book({ startsAt: at("11:00") }).expect(422);
    expect(response.body.error.code).toBe("practitioner_unavailable");
  });

  it("books recurring series all-or-nothing", async () => {
    const series = await book({ startsAt: at("10:00"), recurrence: { intervalDays: 7, occurrences: 3 } }).expect(201);
    expect(series.body).toHaveLength(3);
    expect(new Set(series.body.map((a: { seriesId: string }) => a.seriesId)).size).toBe(1);

    // The second occurrence of this series would collide with the first one's slot a week later.
    const collision = await book({ startsAt: at("10:00"), recurrence: { intervalDays: 7, occurrences: 2 }, outsideSchedule: true }).expect(409);
    expect(collision.body.error.code).toBe("slot_unavailable");
  });

  it("confirms, reschedules and cancels with optimistic locking", async () => {
    const [created] = (await book({ startsAt: at("09:30") }).expect(201)).body;
    const confirmed = await ctx.http().post(`/api/v1/appointments/${created.id}/confirm`).set(as(desk)).send({ version: 1 }).expect(200);
    await ctx.http().post(`/api/v1/appointments/${created.id}/confirm`).set(as(desk)).send({ version: 1 }).expect(409);

    const moved = await ctx
      .http()
      .post(`/api/v1/appointments/${created.id}/reschedule`)
      .set(as(desk))
      .send({ startsAt: at("10:30"), reason: "Patient request", version: confirmed.body.version })
      .expect(200);
    expect(moved.body).toMatchObject({ status: "booked", startsAt: new Date(at("10:30")).toISOString() });

    const cancelled = await ctx
      .http()
      .post(`/api/v1/appointments/${created.id}/cancel`)
      .set(as(desk))
      .send({ reason: "Patient travelling", version: moved.body.version })
      .expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    await ctx.http().post(`/api/v1/appointments/${created.id}/cancel`).set(as(desk)).send({ reason: "again", version: cancelled.body.version }).expect(422);
    // A cancelled slot can be booked again.
    await book({ startsAt: at("10:30") }).expect(201);
    expect(await auditRows(ctx.pool, `action = 'appointment.reschedule'`)).toHaveLength(1);
  });

  it("refuses a no-show before the appointment starts", async () => {
    const [created] = (await book({ startsAt: at("11:30"), outsideSchedule: true }).expect(201)).body;
    const response = await ctx.http().post(`/api/v1/appointments/${created.id}/no-show`).set(as(desk)).send({ version: 1 }).expect(422);
    expect(response.body.error.code).toBe("too_early_for_no_show");
  });

  it("schedules SMS reminders through the outbox and withdraws them on cancellation", async () => {
    await drainEvents(ctx);
    const reminders = await ctx.pool.query(
      `SELECT status, scheduled_for, idempotency_key FROM notification WHERE template_key = 'appointment.reminder' ORDER BY created_at`,
    );
    expect(reminders.rows.length).toBeGreaterThan(0);
    // Every reminder is sent 24 h before its appointment.
    const first = reminders.rows[0];
    const appointmentId = first.idempotency_key.split(":")[1];
    const appointmentRow = await ctx.pool.query(`SELECT starts_at FROM appointment WHERE id = $1`, [appointmentId]);
    expect(new Date(appointmentRow.rows[0].starts_at).getTime() - new Date(first.scheduled_for).getTime()).toBe(24 * 3_600_000);

    // The appointment cancelled earlier had its (rescheduled) reminder withdrawn.
    const cancelled = await ctx.pool.query(
      `SELECT n.status FROM notification n JOIN appointment a ON n.idempotency_key LIKE 'appointment-reminder:' || a.id || ':%' WHERE a.status = 'cancelled'`,
    );
    expect(cancelled.rows.map((r) => r.status).sort()).toEqual(["cancelled", "cancelled"]);
    // Draining again changes nothing (idempotent handlers).
    const before = await ctx.pool.query(`SELECT count(*)::int AS n FROM notification`);
    await drainEvents(ctx);
    const after = await ctx.pool.query(`SELECT count(*)::int AS n FROM notification`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("lists the day's schedule with minimal patient identification", async () => {
    const response = await ctx.http().get(`/api/v1/appointments?facilityId=${tenant.facilityId}&date=${date}&pageSize=100`).set(as(desk)).expect(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0].patient).toEqual({ patientNumber: "P00000001", displayName: "DELA CRUZ, Juan Santos", sex: "male", age: expect.any(Number) });
    // No contact or clinical details on a schedule row.
    expect(JSON.stringify(response.body.items[0])).not.toMatch(/0917|Makati/);
  });

  it("manages a waiting list and fulfils it by booking", async () => {
    const entry = await ctx
      .http()
      .post("/api/v1/waitlist")
      .set(as(desk))
      .send({ patientId, facilityId: tenant.facilityId, practitionerId, earliestDate: manilaDate(1), latestDate: manilaDate(30), priority: "soon" })
      .expect(201);
    const list = await ctx.http().get(`/api/v1/waitlist?facilityId=${tenant.facilityId}`).set(as(desk)).expect(200);
    expect(list.body.map((e: { id: string }) => e.id)).toContain(entry.body.id);
    await book({ startsAt: at("12:30"), outsideSchedule: true, waitlistEntryId: entry.body.id }).expect(201);
    const row = await ctx.pool.query(`SELECT status, appointment_id FROM appointment_waitlist_entry WHERE id = $1`, [entry.body.id]);
    expect(row.rows[0]).toMatchObject({ status: "booked", appointment_id: expect.any(String) });
  });
});
