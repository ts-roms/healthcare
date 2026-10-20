import { as, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * The dashboard's calendar and week (`GET /clinic/dashboard/load`): per local day of the selected facility, the
 * appointments booked against the slots the weekly schedules offer, less leave and closures. Counts only.
 */
describe("clinic dashboard load", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let practitionerId: string;
  let visitTypeId: string;
  let patientId: string;

  // Monday 7, Wednesday 9 and Friday 11 January 2030 (Asia/Manila).
  const MONDAY = "2030-01-07";
  const TUESDAY = "2030-01-08";
  const WEDNESDAY = "2030-01-09";
  const THURSDAY = "2030-01-10";
  const FRIDAY = "2030-01-11";
  const SATURDAY = "2030-01-12";
  /** 08:00 Manila on a date, as an instant. */
  const manila = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "load-org");
    await createStaff(ctx.pool, tenant, "admin@load.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@load.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@load.ph", ["physician"]));
    admin = (await login(ctx, "admin@load.ph")).accessToken;
    desk = (await login(ctx, "desk@load.ph")).accessToken;

    visitTypeId = (
      await ctx.http().post("/api/v1/clinic/visit-types").set(as(admin)).send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)
    ).body.id;
    // Monday, Wednesday and Friday mornings, 08:00-10:00 in 15-minute slots: 8 slots a day.
    for (const dayOfWeek of [1, 3, 5]) {
      await ctx
        .http()
        .post("/api/v1/clinic/schedules")
        .set(as(admin, tenant.facilityId))
        .send({ practitionerId, facilityId: tenant.facilityId, dayOfWeek, startTime: "08:00", endTime: "10:00", slotMinutes: 15, validFrom: "2030-01-01" })
        .expect(201);
    }
    // Leave all of Wednesday; the first hour of Friday.
    await ctx
      .http()
      .post("/api/v1/clinic/schedule-exceptions")
      .set(as(admin, tenant.facilityId))
      .send({ facilityId: tenant.facilityId, practitionerId, startsAt: manila(WEDNESDAY, "00:00"), endsAt: manila(THURSDAY, "00:00"), reason: "Leave" })
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/clinic/schedule-exceptions")
      .set(as(admin, tenant.facilityId))
      .send({ facilityId: tenant.facilityId, practitionerId, startsAt: manila(FRIDAY, "08:00"), endsAt: manila(FRIDAY, "09:00"), reason: "Meeting" })
      .expect(201);

    patientId = (await ctx.http().post("/api/v1/patients").set(as(desk, tenant.facilityId)).send(juan).expect(201)).body.id;
    // Three appointments on Monday: one is cancelled again, so two count.
    const ids: Array<{ id: string; version: number }> = [];
    for (const time of ["08:00", "08:15", "08:30"]) {
      const booked = await ctx
        .http()
        .post("/api/v1/appointments")
        .set(as(desk, tenant.facilityId))
        .send({ patientId, practitionerId, facilityId: tenant.facilityId, visitTypeId, startsAt: manila(MONDAY, time) })
        .expect(201);
      ids.push(booked.body[0]);
    }
    // Another one did not come: it counts as scheduled that day, but its slot is free again.
    const [, absent, cancelled] = ids;
    if (!absent || !cancelled) throw new Error("The appointments were not booked");
    await ctx.pool.query(`UPDATE appointment SET status = 'no_show', no_show_at = now() WHERE id = $1`, [absent.id]);
    await ctx
      .http()
      .post(`/api/v1/appointments/${cancelled.id}/cancel`)
      .set(as(desk, tenant.facilityId))
      .send({ version: cancelled.version, reason: "Patient asked" })
      .expect(200);
  });

  afterAll(() => ctx.close());

  const load = (from: string, to: string, token = desk) =>
    ctx.http().get("/api/v1/clinic/dashboard/load").query({ from, to }).set(as(token, tenant.facilityId));

  it("counts the booked appointments and the slots the schedules offer, day by day", async () => {
    const response = await load(MONDAY, SATURDAY).expect(200);
    expect(response.body).toMatchObject({ facilityId: tenant.facilityId, from: MONDAY, to: SATURDAY });
    expect(response.body.days).toEqual([
      { date: MONDAY, scheduled: 2, booked: 1, slots: 8 }, // the cancelled one is not counted; the no-show holds no slot
      { date: TUESDAY, scheduled: 0, booked: 0, slots: 0 }, // no schedule
      { date: WEDNESDAY, scheduled: 0, booked: 0, slots: 0 }, // the practitioner is on leave all day
      { date: THURSDAY, scheduled: 0, booked: 0, slots: 0 },
      { date: FRIDAY, scheduled: 0, booked: 0, slots: 4 }, // the first hour is taken out
    ]);
  });

  it("offers no slots on a day before the schedules are valid", async () => {
    const response = await load("2029-12-31", "2030-01-01").expect(200);
    expect(response.body.days).toEqual([{ date: "2029-12-31", scheduled: 0, booked: 0, slots: 0 }]);
  });

  it("refuses an empty, backwards or too long range", async () => {
    await load(MONDAY, MONDAY).expect(400);
    await load(WEDNESDAY, MONDAY).expect(400);
    await load("2030-01-01", "2030-06-01").expect(400);
  });

  it("needs a facility and the dashboard permission", async () => {
    await ctx.http().get("/api/v1/clinic/dashboard/load").query({ from: MONDAY, to: SATURDAY }).set(as(admin)).expect(400);
    await load(MONDAY, SATURDAY, admin).expect(200);
    // The receptionist of one facility has nothing at the other.
    await ctx.http().get("/api/v1/clinic/dashboard/load").query({ from: MONDAY, to: SATURDAY }).set(as(desk, tenant.otherFacilityId)).expect(403);
  });
});
