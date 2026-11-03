import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/**
 * Reception queue actions (migration 0138, docs/domains/clinic.md "Queue actions"): recall repeats a call, a no-show
 * closes a called patient who never came forward, and a visit closed as left-without-being-seen can be put back in
 * line the same day, a limited number of times. Each is authorized, facility-scoped, audited and safe against two
 * people acting on the same ticket at once.
 */
describe("queue actions at the front desk", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let otherDesk: string;
  let cashier: string;
  let visitTypeId: string;
  let n = 0;

  const staff = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });

  /** A patient checked in as a walk-in; returns the visit as the queue board lists it. */
  async function queued(label: string) {
    n += 1;
    const patient = await staff(desk)
      .post("/patients", {
        familyName: `Qa${label}${n}x`,
        givenName: `Given${n}`,
        sex: "female",
        birthDate: `19${50 + (n % 40)}-0${1 + (n % 9)}-${10 + (n % 18)}`,
      })
      .expect(201);
    const visit = (await staff(desk).post("/queue/walk-ins", { patientId: patient.body.id, visitTypeId, priority: "routine" }).expect(201)).body;
    return { patientId: patient.body.id as string, visit: visit as { id: string; version: number; ticket: string } };
  }
  const read = async (id: string) => (await staff(desk).get(`/queue/visits/${id}`).expect(200)).body;
  const call = async (id: string, place = "Room 1") => {
    const row = await read(id);
    return (await staff(desk).post(`/queue/visits/${id}/call`, { calledTo: place, version: row.version }).expect(200)).body;
  };
  const noShow = async (id: string) => {
    const called = await call(id);
    return (await staff(desk).post(`/queue/visits/${id}/no-show`, { version: called.version }).expect(200)).body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "queue-actions-org");
    await createStaff(ctx.pool, tenant, "admin@qa.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@qa.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "annex@qa.ph", [{ role: "receptionist", facilityId: tenant.otherFacilityId }]);
    await createStaff(ctx.pool, tenant, "cashier@qa.ph", [{ role: "cashier", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@qa.ph")).accessToken;
    desk = (await login(ctx, "desk@qa.ph")).accessToken;
    otherDesk = (await login(ctx, "annex@qa.ph")).accessToken;
    cashier = (await login(ctx, "cashier@qa.ph")).accessToken;
    visitTypeId = (await staff(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 30 }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  describe("recall", () => {
    it("calls the patient again to the same place, and only a patient who was called", async () => {
      const { visit } = await queued("recall");
      expect((await staff(desk).post(`/queue/visits/${visit.id}/recall`, { version: visit.version }).expect(422)).body.error.code).toBe("not_called");

      const called = await call(visit.id, "Room 4");
      const recalled = (await staff(desk).post(`/queue/visits/${visit.id}/recall`, { version: called.version }).expect(200)).body;
      expect(recalled.calledTo).toBe("Room 4");
      expect(new Date(recalled.calledAt).getTime()).toBeGreaterThanOrEqual(new Date(called.calledAt).getTime());
      expect(recalled.version).toBe(called.version + 1);
      expect((await auditRows(ctx.pool, `action = 'visit.recall' AND resource_id = $1`, [visit.id])).length).toBe(1);
    });

    it("refuses a stale version, and a closed visit", async () => {
      const { visit } = await queued("recallstale");
      const called = await call(visit.id);
      await staff(desk)
        .post(`/queue/visits/${visit.id}/recall`, { version: called.version - 1 })
        .expect(409);
      const closed = await noShow(visit.id);
      expect((await staff(desk).post(`/queue/visits/${visit.id}/recall`, { version: closed.version }).expect(422)).body.error.code).toBe("visit_closed");
    });
  });

  describe("no-show", () => {
    it("closes a called patient as left-without-being-seen and marks it a no-show", async () => {
      const { visit } = await queued("noshow");
      const row = await read(visit.id);
      const early = await staff(desk).post(`/queue/visits/${visit.id}/no-show`, { version: row.version }).expect(422);
      expect(early.body.error.code).toBe("not_called");

      const closed = await noShow(visit.id);
      expect(closed).toMatchObject({ status: "left_without_being_seen", calledAt: null, calledTo: null, closedReason: "No-show after being called" });
      expect(closed.noShowAt).toEqual(expect.any(String));
      expect(closed.completedAt).toEqual(expect.any(String));

      // It leaves the open queue and shows with the closed ones.
      const open = (await staff(desk).get("/queue").expect(200)).body as Array<{ id: string }>;
      expect(open.some((r) => r.id === visit.id)).toBe(false);
      const all = (await staff(desk).get("/queue?includeClosed=true").expect(200)).body as Array<{ id: string; noShowAt: string | null }>;
      expect(all.find((r) => r.id === visit.id)?.noShowAt).toEqual(expect.any(String));
      expect((await auditRows(ctx.pool, `action = 'visit.no-show' AND resource_id = $1`, [visit.id])).length).toBe(1);
    });

    it("keeps a reason the desk gave", async () => {
      const { visit } = await queued("reason");
      const called = await call(visit.id);
      const closed = (await staff(desk).post(`/queue/visits/${visit.id}/no-show`, { version: called.version, reason: "Not in the waiting area" }).expect(200))
        .body;
      expect(closed.closedReason).toBe("Not in the waiting area");
    });

    it("is refused for a patient with the provider", async () => {
      const { visit } = await queued("withprovider");
      await call(visit.id);
      // A consultation starts through the encounter workflow; here the visit is put in that state directly.
      await ctx.pool.query(`UPDATE visit SET status = 'in_consultation' WHERE id = $1`, [visit.id]);
      const row = await read(visit.id);
      const refused = await staff(desk).post(`/queue/visits/${visit.id}/no-show`, { version: row.version }).expect(422);
      expect(refused.body.error.code).toBe("not_waiting");
    });
  });

  describe("requeue", () => {
    it("puts a no-show back in line behind those who arrived since, with the same ticket", async () => {
      const first = await queued("first");
      const second = await queued("second");
      const closed = await noShow(first.visit.id);

      const back = (await staff(desk).post(`/queue/visits/${first.visit.id}/requeue`, { reason: "Patient came back", version: closed.version }).expect(200))
        .body;
      expect(back).toMatchObject({
        status: "waiting",
        closedReason: null,
        completedAt: null,
        noShowAt: null,
        calledAt: null,
        requeuedCount: 1,
        ticket: first.visit.ticket,
      });

      const order = (await staff(desk).get("/queue").expect(200)).body.map((r: { id: string }) => r.id) as string[];
      expect(order.indexOf(second.visit.id)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(second.visit.id)).toBeLessThan(order.indexOf(first.visit.id));
      const audit = await auditRows(ctx.pool, `action = 'visit.requeue' AND resource_id = $1`, [first.visit.id]);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.reason).toBe("Patient came back");
    });

    it("needs a reason and a visit closed as left-without-being-seen", async () => {
      const { visit } = await queued("needs");
      await staff(desk).post(`/queue/visits/${visit.id}/requeue`, { version: visit.version }).expect(400);
      const refused = await staff(desk).post(`/queue/visits/${visit.id}/requeue`, { reason: "Not closed yet", version: visit.version }).expect(422);
      expect(refused.body.error.code).toBe("not_left");

      // A visit cancelled (checked in by mistake) never reopens.
      const cancelled = (
        await staff(desk).post(`/queue/visits/${visit.id}/move`, { status: "cancelled", reason: "Wrong patient", version: visit.version }).expect(200)
      ).body;
      expect(
        (await staff(desk).post(`/queue/visits/${visit.id}/requeue`, { reason: "Try anyway", version: cancelled.version }).expect(422)).body.error.code,
      ).toBe("not_left");
    });

    it("refuses yesterday's visits and a patient who is already back in the queue", async () => {
      const old = await queued("yesterday");
      const closedOld = await noShow(old.visit.id);
      await ctx.pool.query(`UPDATE visit SET queue_date = queue_date - 1 WHERE id = $1`, [old.visit.id]);
      expect(
        (await staff(desk).post(`/queue/visits/${old.visit.id}/requeue`, { reason: "Came back", version: closedOld.version }).expect(422)).body.error.code,
      ).toBe("not_today");

      const again = await queued("again");
      const closed = await noShow(again.visit.id);
      // The patient checked in afresh; the old ticket cannot be put back beside it.
      await staff(desk).post("/queue/walk-ins", { patientId: again.patientId, visitTypeId, priority: "routine" }).expect(201);
      expect(
        (await staff(desk).post(`/queue/visits/${again.visit.id}/requeue`, { reason: "Came back", version: closed.version }).expect(409)).body.error.code,
      ).toBe("already_in_queue");
    });

    it("allows a limited number of times", async () => {
      const { visit } = await queued("limit");
      let latest = await noShow(visit.id);
      for (let time = 1; time <= 3; time += 1) {
        const back = (
          await staff(desk)
            .post(`/queue/visits/${visit.id}/requeue`, { reason: `Back ${time}`, version: latest.version })
            .expect(200)
        ).body;
        expect(back.requeuedCount).toBe(time);
        latest = await noShow(visit.id);
      }
      const refused = await staff(desk).post(`/queue/visits/${visit.id}/requeue`, { reason: "Once more", version: latest.version }).expect(422);
      expect(refused.body.error.code).toBe("requeue_limit_reached");
    });
  });

  describe("who may do it, and where", () => {
    it("needs queue management at the facility", async () => {
      const { visit } = await queued("perms");
      const body = { version: visit.version, reason: "Because it is needed" };
      for (const path of ["recall", "no-show", "requeue"]) {
        await staff(cashier).post(`/queue/visits/${visit.id}/${path}`, body).expect(403);
      }
    });

    it("does not reach another facility's visit", async () => {
      const { visit } = await queued("annex");
      const called = await call(visit.id);
      const body = { version: called.version, reason: "Because it is needed" };
      for (const path of ["recall", "no-show", "requeue"]) {
        await staff(otherDesk, tenant.otherFacilityId).post(`/queue/visits/${visit.id}/${path}`, body).expect(404);
      }
      expect((await read(visit.id)).calledTo).toBe("Room 1");
    });
  });

  describe("two people at once", () => {
    it("lets only one of two simultaneous no-shows through; the other sees the version has moved", async () => {
      const { visit } = await queued("race");
      const called = await call(visit.id);
      const results = await Promise.all([1, 2].map(() => staff(desk).post(`/queue/visits/${visit.id}/no-show`, { version: called.version })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await auditRows(ctx.pool, `action = 'visit.no-show' AND resource_id = $1`, [visit.id])).length).toBe(1);
    });

    it("lets only one of two simultaneous requeues through", async () => {
      const { visit } = await queued("racerequeue");
      const closed = await noShow(visit.id);
      const results = await Promise.all(
        [1, 2].map(() => staff(desk).post(`/queue/visits/${visit.id}/requeue`, { reason: "Back at the desk", version: closed.version })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await read(visit.id)).requeuedCount).toBe(1);
    });

    it("keeps one ticket when a recall and a no-show race: the second sees a closed visit or a stale version", async () => {
      const { visit } = await queued("racemixed");
      const called = await call(visit.id);
      const [recall, closed] = await Promise.all([
        staff(desk).post(`/queue/visits/${visit.id}/recall`, { version: called.version }),
        staff(desk).post(`/queue/visits/${visit.id}/no-show`, { version: called.version }),
      ]);
      expect([recall.status, closed.status].sort()).toEqual([200, 409]);
      const final = await read(visit.id);
      expect(["waiting", "left_without_being_seen"]).toContain(final.status);
    });
  });
});
