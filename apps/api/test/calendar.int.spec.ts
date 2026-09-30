import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/**
 * The staff calendar (docs/domains/calendar.md): events of a facility beside appointments; organizer-only changes;
 * invitee-only visibility; cancelled events stay listed; the appointment list takes a range.
 */
describe("calendar", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let outsider: string;
  let nurseUserId: string;
  let doctorUserId: string;

  const staff = (t: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(t, facilityId)).send(body),
  });
  const code = (status: number, expected: string) => (r: { status: number; body: { error?: { code?: string } } }) => {
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(expected);
  };
  const range = () => `facilityId=${tenant.facilityId}&from=2030-03-01T00:00:00.000Z&to=2030-03-31T00:00:00.000Z`;
  const meeting = (over: object = {}) => ({
    facilityId: tenant.facilityId,
    title: "Staff meeting",
    kind: "meeting",
    startsAt: "2030-03-10T01:00:00.000Z",
    endsAt: "2030-03-10T02:00:00.000Z",
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "cal-org");
    other = await createTenant(ctx.pool, "cal-other");
    await createStaff(ctx.pool, tenant, "admin@cal.ph", ["org_admin"]);
    doctorUserId = (await createClinician(ctx, tenant, "doctor@cal.ph", ["physician"])).userId;
    nurseUserId = (await createClinician(ctx, tenant, "nurse@cal.ph", ["nurse"], "nurse")).userId;
    await createStaff(ctx.pool, other, "admin@cal-other.ph", ["org_admin"]);
    [admin, doctor, nurse] = await Promise.all(["admin", "doctor", "nurse"].map(async (u) => (await login(ctx, `${u}@cal.ph`)).accessToken));
    outsider = (await login(ctx, "admin@cal-other.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("adds an event, lists it in the range with its organizer and audits it", async () => {
    const created = await staff(doctor)
      .post("/calendar/events", meeting({ attendeeUserIds: [nurseUserId], location: "Room 2" }))
      .expect(201);
    expect(created.body).toMatchObject({
      title: "Staff meeting",
      kind: "meeting",
      status: "scheduled",
      version: 1,
      editable: true,
      organizerUserId: doctorUserId,
    });
    expect(created.body.attendees).toEqual([{ userId: nurseUserId, displayName: "Dr. nurse" }]);
    const listed = await staff(nurse).get(`/calendar/events?${range()}`).expect(200);
    expect(listed.body.map((e: { id: string }) => e.id)).toEqual([created.body.id]);
    expect(listed.body[0].editable).toBe(false);
    expect((await auditRows(ctx.pool, "action = $1 AND organization_id = $2", ["calendar.event.create", tenant.organizationId])).length).toBe(1);
    // Events outside the range are not listed.
    const later = `facilityId=${tenant.facilityId}&from=2030-04-01T00:00:00.000Z&to=2030-04-05T00:00:00.000Z`;
    expect((await staff(nurse).get(`/calendar/events?${later}`).expect(200)).body).toEqual([]);
  });

  it("validates the event and the range, and only invites the organization's clinicians", async () => {
    await staff(doctor)
      .post("/calendar/events", meeting({ endsAt: "2030-03-10T00:00:00.000Z" }))
      .expect(400);
    await staff(doctor)
      .post("/calendar/events", meeting({ title: "x" }))
      .expect(400);
    await staff(doctor)
      .post("/calendar/events", meeting({ attendeeUserIds: ["00000000-0000-4000-8000-000000000001"] }))
      .expect(code(422, "calendar_attendee_invalid"));
    await staff(doctor).get(`/calendar/events?facilityId=${tenant.facilityId}&from=2030-01-01T00:00:00.000Z&to=2030-06-01T00:00:00.000Z`).expect(400);
  });

  it("shows invitee-only events to the organizer and invitees only", async () => {
    const secret = (
      await staff(doctor)
        .post("/calendar/events", meeting({ title: "Private review", visibility: "invitees", attendeeUserIds: [nurseUserId] }))
        .expect(201)
    ).body;
    const titles = async (t: string) => (await staff(t).get(`/calendar/events?${range()}`).expect(200)).body.map((e: { title: string }) => e.title);
    expect(await titles(doctor)).toContain("Private review");
    expect(await titles(nurse)).toContain("Private review");
    expect(await titles(admin)).not.toContain("Private review");
    await staff(admin).get(`/calendar/events/${secret.id}`).expect(404);
    await staff(nurse).get(`/calendar/events/${secret.id}`).expect(200);
  });

  it("lets the organizer (or clinic.configure) change an event, refuses others, and detects stale versions", async () => {
    const event = (
      await staff(doctor)
        .post("/calendar/events", meeting({ title: "Training day", kind: "training" }))
        .expect(201)
    ).body;
    const changed = { ...meeting({ title: "Training day 2", kind: "training" }), version: 1 };
    delete (changed as { facilityId?: string }).facilityId;
    await staff(nurse).put(`/calendar/events/${event.id}`, changed).expect(403);
    const updated = await staff(doctor).put(`/calendar/events/${event.id}`, changed).expect(200);
    expect(updated.body).toMatchObject({ title: "Training day 2", version: 2 });
    await staff(doctor).put(`/calendar/events/${event.id}`, changed).expect(409);
    await staff(admin)
      .put(`/calendar/events/${event.id}`, { ...changed, version: 2, title: "Training day 3" })
      .expect(200);
  });

  it("cancels with a reason, keeps the event listed and refuses further changes", async () => {
    const event = (
      await staff(doctor)
        .post("/calendar/events", meeting({ title: "Clinic outing", kind: "event" }))
        .expect(201)
    ).body;
    await staff(doctor).post(`/calendar/events/${event.id}/cancel`, { reason: "ok", version: 1 }).expect(400);
    const cancelled = await staff(doctor).post(`/calendar/events/${event.id}/cancel`, { reason: "Postponed by the director", version: 1 }).expect(201);
    expect(cancelled.body).toMatchObject({ status: "cancelled", cancelReason: "Postponed by the director", editable: false });
    const titles = (await staff(nurse).get(`/calendar/events?${range()}`).expect(200)).body.map((e: { title: string }) => e.title);
    expect(titles).toContain("Clinic outing");
    await staff(doctor).post(`/calendar/events/${event.id}/cancel`, { reason: "Again", version: 2 }).expect(code(422, "calendar_event_cancelled"));
  });

  it("keeps events inside the organization and behind calendar permissions", async () => {
    await staff(outsider, other.facilityId).get(`/calendar/events?${range()}`).expect(404);
    const mine = await staff(outsider, other.facilityId)
      .get(`/calendar/events?facilityId=${other.facilityId}&from=2030-03-01T00:00:00.000Z&to=2030-03-31T00:00:00.000Z`)
      .expect(200);
    expect(mine.body).toEqual([]);
    const pharmacist = await createStaff(ctx.pool, tenant, "cashier@cal.ph", ["cashier"]);
    expect(pharmacist).toBeTruthy();
    const cashier = (await login(ctx, "cashier@cal.ph")).accessToken;
    await staff(cashier).get(`/calendar/events?${range()}`).expect(403);
  });

  it("lists appointments in a range", async () => {
    const res = await staff(admin).get(`/appointments?facilityId=${tenant.facilityId}&from=2030-03-01T00:00:00.000Z&to=2030-03-31T00:00:00.000Z`).expect(200);
    expect(res.body.items).toEqual([]);
    await staff(admin).get(`/appointments?facilityId=${tenant.facilityId}&from=2030-03-01T00:00:00.000Z`).expect(400);
  });
});
