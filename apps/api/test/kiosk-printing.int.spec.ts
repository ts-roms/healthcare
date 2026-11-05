import { KioskPrintService } from "../src/app/kiosk/kiosk-print.service";
import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext, underPlatform } from "./harness";

/**
 * Kiosk ticket printing, display devices and the display's settings (migration 0139, docs/domains/kiosk.md "Printing and
 * devices"): a check-in queues one ticket per visit; a restricted print agent claims it under a lease, prints it and reports;
 * staff may print it again with a reason, a limited number of times; displays register and report; and the waiting-room display
 * says what the clinic told it to — none of it about a patient.
 */
describe("kiosk printing, devices and the display's settings", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let annexDesk: string;
  let cashier: string;
  let agent: string;
  let annexAgent: string;
  let screen: string;
  let kioskOne: string;
  let kioskTwo: string;
  let visitTypeId: string;
  let n = 0;

  const staff = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const k = (token: string, session?: string) => {
    const headers = { ...as(token, tenant.facilityId), ...(session ? { "x-kiosk-session": session } : {}) };
    return {
      get: (url: string) => ctx.http().get(`/api/v1/kiosk${url}`).set(headers),
      post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/kiosk${url}`).set(headers).send(body),
      delete: (url: string) => ctx.http().delete(`/api/v1/kiosk${url}`).set(headers),
    };
  };
  const userId = async (email: string) => (await ctx.pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email])).rows[0]!.id;

  /** A patient checks in at the kiosk; returns the ticket as the kiosk screen gets it. */
  async function checkIn(kiosk: string): Promise<{ ticket: string; printJobId: string | null }> {
    n += 1;
    const birthDate = `19${50 + (n % 40)}-0${1 + (n % 9)}-${10 + (n % 18)}`;
    const patient = await staff(desk)
      .post("/patients", { familyName: `Print${n}x`, givenName: `Given${n}`, sex: "female", birthDate })
      .expect(201);
    const session = (await k(kiosk).post("/sessions").expect(201)).body.token as string;
    await k(kiosk, session)
      .post("/identify", { key: patient.body.patientNumber, birthDate, givenName: `Given${n}` })
      .expect(200);
    const ticket = (await k(kiosk, session).post("/check-in", { visitTypeId }).expect(201)).body;
    await k(kiosk, session).delete("/sessions");
    return ticket;
  }
  const claim = (token = agent, deviceCode = "print-1") => staff(token).post("/kiosk/print/claim", { deviceCode });
  const result = (jobId: string, body: object, token = agent) => staff(token).post(`/kiosk/print/jobs/${jobId}/result`, body);
  const jobRow = async (id: string) => (await ctx.pool.query(`SELECT * FROM kiosk_print_job WHERE id = $1`, [id])).rows[0];
  const listed = async (id: string) =>
    ((await staff(desk).get("/kiosk/admin/print-jobs").expect(200)).body.items as Array<Record<string, unknown>>).find((j) => j.id === id);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "printing-org");
    await createStaff(ctx.pool, tenant, "admin@print.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@print.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "annexdesk@print.ph", [{ role: "receptionist", facilityId: tenant.otherFacilityId }]);
    await createStaff(ctx.pool, tenant, "cashier@print.ph", [{ role: "cashier", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "agent@print.ph", [{ role: "kiosk_print_agent", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "annexagent@print.ph", [{ role: "kiosk_print_agent", facilityId: tenant.otherFacilityId }]);
    await createStaff(ctx.pool, tenant, "screen@print.ph", [{ role: "queue_display", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "screen2@print.ph", [{ role: "queue_display", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "kiosk1@print.ph", [{ role: "kiosk_device", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "kiosk2@print.ph", [{ role: "kiosk_device", facilityId: tenant.facilityId }]);
    for (const [name, who] of [
      ["admin", "admin"],
      ["desk", "desk"],
      ["annexDesk", "annexdesk"],
      ["cashier", "cashier"],
      ["agent", "agent"],
      ["annexAgent", "annexagent"],
      ["screen", "screen"],
      ["kioskOne", "kiosk1"],
      ["kioskTwo", "kiosk2"],
    ] as const) {
      const token = (await login(ctx, `${who}@print.ph`)).accessToken;
      if (name === "admin") admin = token;
      if (name === "desk") desk = token;
      if (name === "annexDesk") annexDesk = token;
      if (name === "cashier") cashier = token;
      if (name === "agent") agent = token;
      if (name === "annexAgent") annexAgent = token;
      if (name === "screen") screen = token;
      if (name === "kioskOne") kioskOne = token;
      if (name === "kioskTwo") kioskTwo = token;
    }
    visitTypeId = (
      await staff(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 30, kioskEnabled: true }).expect(201)
    ).body.id;
    await staff(admin)
      .post("/kiosk/admin/devices", { code: "print-1", name: "Front kiosk", userId: await userId("kiosk1@print.ph"), printsTickets: true })
      .expect(201);
    await staff(admin)
      .post("/kiosk/admin/devices", { code: "print-2", name: "Side kiosk", userId: await userId("kiosk2@print.ph"), printsTickets: true })
      .expect(201);
  });
  afterAll(() => ctx.close());

  /** Changes print jobs behind the database's guard, for set-up the application itself never does (back-dating, clearing). */
  async function directly(sqlText: string, params: unknown[] = []) {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE kiosk_print_job DISABLE TRIGGER kiosk_print_job_guard");
      await client.query(sqlText, params);
      await client.query("ALTER TABLE kiosk_print_job ENABLE TRIGGER kiosk_print_job_guard");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  // Every test starts with nothing waiting to be printed, so the agent only ever sees that test's tickets.
  beforeEach(() => directly(`UPDATE kiosk_print_job SET status = 'cancelled', lease_expires_at = NULL WHERE status IN ('queued', 'printing')`));

  describe("devices: kiosks and displays", () => {
    it("registers a display only from a display account, and a kiosk only from a kiosk account", async () => {
      const display = await staff(admin)
        .post("/kiosk/admin/devices", { kind: "display", code: "lobby-tv", name: "Lobby TV", userId: await userId("screen@print.ph") })
        .expect(201);
      expect(display.body).toMatchObject({ kind: "display", status: "active", printer: "none" });

      const kioskAsDisplay = await staff(admin).post("/kiosk/admin/devices", {
        kind: "display",
        code: "bad-1",
        name: "Bad one",
        userId: await userId("kiosk1@print.ph"),
      });
      expect(kioskAsDisplay.body.error.code).toBe("not_a_display_account");
      const displayAsKiosk = await staff(admin).post("/kiosk/admin/devices", { code: "bad-2", name: "Bad two", userId: await userId("screen2@print.ph") });
      expect(displayAsKiosk.body.error.code).toBe("not_a_kiosk_account");

      const list = (await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ code: string; kind: string; printer: string }>;
      expect(list.find((d) => d.code === "print-1")).toMatchObject({ kind: "kiosk", printer: "unknown" });
      expect(list.find((d) => d.code === "lobby-tv")).toMatchObject({ kind: "display" });
    });

    it("lets a registered display report in, and ignores an unregistered one", async () => {
      expect((await staff(screen).post("/kiosk/display/heartbeat").expect(200)).body).toEqual({ registered: true });
      const display = ((await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ code: string; health: string }>).find(
        (d) => d.code === "lobby-tv",
      );
      expect(display?.health).toBe("online");
      const other = (await login(ctx, "screen2@print.ph")).accessToken;
      expect((await staff(other).post("/kiosk/display/heartbeat").expect(200)).body).toEqual({ registered: false });
      // Anyone holding the display permission may report (a receptionist's account is simply not a registered display); a kiosk may not.
      expect((await staff(desk).post("/kiosk/display/heartbeat").expect(200)).body).toEqual({ registered: false });
      await staff(kioskOne).post("/kiosk/display/heartbeat").expect(403);
    });

    it("keeps a display account out of the kiosk's calls", async () => {
      await staff(screen).post("/kiosk/print/claim", { deviceCode: "print-1" }).expect(403);
      await staff(screen).get("/patients?q=x").expect(403);
    });
  });

  describe("the ticket's print job", () => {
    it("is queued once per visit, holds nothing about the patient, and is read by its own kiosk only", async () => {
      const ticket = await checkIn(kioskOne);
      expect(ticket.printJobId).toEqual(expect.any(String));
      const job = await jobRow(ticket.printJobId!);
      expect(job).toMatchObject({ status: "queued", attempts: 0, ticket: ticket.ticket, service_name: "Consultation", reprint_of: null });
      expect(JSON.stringify(job)).not.toMatch(/Print\d+x|Given\d+/);

      // The same visit never queues a second original (the database's unique index).
      await expect(
        ctx.pool.query(
          `INSERT INTO kiosk_print_job (organization_id, facility_id, device_id, visit_id, ticket, service_name, facility_name, issued_at, instructions)
           SELECT organization_id, facility_id, device_id, visit_id, ticket, service_name, facility_name, issued_at, instructions FROM kiosk_print_job WHERE id = $1`,
          [ticket.printJobId],
        ),
      ).rejects.toThrow(/kiosk_print_job_original_uq/);

      expect((await k(kioskOne).get(`/print-jobs/${ticket.printJobId}`).expect(200)).body).toEqual({ status: "queued", attempts: 0, error: null });
      await k(kioskTwo).get(`/print-jobs/${ticket.printJobId}`).expect(404);
    });

    it("is not queued for a kiosk staff have not turned printing on for, and can be turned on and off later", async () => {
      const devices = (await staff(admin).get("/kiosk/admin/devices").expect(200)).body.items as Array<Record<string, unknown>>;
      const side = devices.find((d) => d.code === "print-2")!;
      const off = await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printsTickets: false, version: side.version }).expect(200);
      expect(off.body).toMatchObject({ printsTickets: false, printer: "none" });
      expect((await checkIn(kioskTwo)).printJobId).toBeNull();
      await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { version: off.body.version }).expect(400);
      const on = await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printsTickets: true, version: off.body.version }).expect(200);
      expect(on.body).toMatchObject({ printsTickets: true, printer: "unknown" });
      expect((await checkIn(kioskTwo)).printJobId).not.toBeNull();
      expect((await auditRows(ctx.pool, `action = 'kiosk.device.update'`)).length).toBeGreaterThan(0);
    });

    it("is off for a newly registered kiosk until staff turn it on", async () => {
      await createStaff(ctx.pool, tenant, "kiosk3@print.ph", [{ role: "kiosk_device", facilityId: tenant.facilityId }]);
      const created = await staff(admin)
        .post("/kiosk/admin/devices", { code: "print-3", name: "New kiosk", userId: await userId("kiosk3@print.ph") })
        .expect(201);
      expect(created.body).toMatchObject({ printsTickets: false, printer: "none" });
    });

    it("is immutable in its content and moves only forward, by the database", async () => {
      const ticket = await checkIn(kioskOne);
      await expect(ctx.pool.query(`UPDATE kiosk_print_job SET ticket = 'A-999' WHERE id = $1`, [ticket.printJobId])).rejects.toThrow(/content is fixed/);
      await expect(ctx.pool.query(`UPDATE kiosk_print_job SET status = 'printed', printed_at = now() WHERE id = $1`, [ticket.printJobId])).rejects.toThrow(
        /claimed or cancelled/,
      );
      await expect(ctx.pool.query(`DELETE FROM kiosk_print_job WHERE id = $1`, [ticket.printJobId])).rejects.toThrow();
    });
  });

  describe("the print agent", () => {
    it("claims a ticket under a lease, prints it and reports; its kiosk screen follows", async () => {
      const ticket = await checkIn(kioskOne);
      const claimed = (await claim().expect(200)).body.job;
      expect(Object.keys(claimed).sort()).toEqual(["attempt", "facilityName", "id", "instructions", "issuedAt", "serviceName", "ticket"]);
      expect(claimed).toMatchObject({ id: ticket.printJobId, attempt: 1, ticket: ticket.ticket, serviceName: "Consultation" });
      expect((await k(kioskOne).get(`/print-jobs/${ticket.printJobId}`).expect(200)).body.status).toBe("printing");
      // While it is leased nobody else gets it.
      expect((await claim().expect(200)).body.job).toBeNull();

      expect((await result(ticket.printJobId!, { outcome: "printed" }).expect(200)).body).toEqual({ status: "printed" });
      expect((await k(kioskOne).get(`/print-jobs/${ticket.printJobId}`).expect(200)).body).toEqual({ status: "printed", attempts: 1, error: null });
      // The same answer again changes nothing; any other answer for a finished ticket is refused.
      await result(ticket.printJobId!, { outcome: "printed" }).expect(200);
      expect((await result(ticket.printJobId!, { outcome: "failed", error: "error" }).expect(422)).body.error.code).toBe("print_job_not_active");

      const device = (
        (await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ code: string; printer: string; printerStatus: string }>
      ).find((d) => d.code === "print-1");
      expect(device).toMatchObject({ printerStatus: "ok", printer: "available" });
    });

    it("retries a failed print while attempts remain, then fails it, audited, and says what is wrong with the printer", async () => {
      const ticket = await checkIn(kioskOne);
      const id = ticket.printJobId!;
      await claim().expect(200);
      expect((await result(id, { outcome: "failed", error: "offline", retry: true }).expect(200)).body.status).toBe("queued");
      expect((await claim().expect(200)).body.job).toMatchObject({ id, attempt: 2 });
      expect((await result(id, { outcome: "failed", error: "paper_out", retry: true }).expect(200)).body.status).toBe("queued");
      expect((await claim().expect(200)).body.job).toMatchObject({ id, attempt: 3 });
      // The third attempt is the last: a retry is not allowed any more.
      expect((await result(id, { outcome: "failed", error: "paper_out", retry: true }).expect(200)).body.status).toBe("failed");

      expect(await jobRow(id)).toMatchObject({ status: "failed", last_error: "paper_out", attempts: 3 });
      expect((await k(kioskOne).get(`/print-jobs/${id}`).expect(200)).body).toEqual({ status: "failed", attempts: 3, error: "paper_out" });
      expect((await auditRows(ctx.pool, `action = 'kiosk.print.failed' AND resource_id = $1`, [id])).length).toBe(1);
      const device = (
        (await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ code: string; printer: string; printerStatus: string }>
      ).find((d) => d.code === "print-1");
      expect(device).toMatchObject({ printerStatus: "paper_out", printer: "attention" });
      // A failure needs a cause.
      await result(id, { outcome: "failed" }).expect(400);
    });

    it("offers a ticket again when its lease ran out, and fails one whose attempts ran out", async () => {
      const lost = await checkIn(kioskOne);
      await claim().expect(200);
      await directly(`UPDATE kiosk_print_job SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [lost.printJobId]);
      expect((await claim().expect(200)).body.job).toMatchObject({ id: lost.printJobId, attempt: 2 });
      await result(lost.printJobId!, { outcome: "printed" }).expect(200);

      const tired = await checkIn(kioskOne);
      await ctx.pool.query(`UPDATE kiosk_print_job SET status = 'printing', attempts = 3, lease_expires_at = now() - interval '1 second' WHERE id = $1`, [
        tired.printJobId,
      ]);
      expect((await claim().expect(200)).body.job).toBeNull();
      expect(await jobRow(tired.printJobId!)).toMatchObject({ status: "failed", last_error: "attempts_exhausted" });
    });

    it("drops a ticket nobody printed in time", async () => {
      const old = await checkIn(kioskOne);
      await directly(`UPDATE kiosk_print_job SET created_at = now() - interval '11 minutes' WHERE id = $1`, [old.printJobId]);
      expect((await claim().expect(200)).body.job).toBeNull();
      expect(await underPlatform(ctx.app.get(KioskPrintService)).expireDue()).toBeGreaterThanOrEqual(1);
      expect(await jobRow(old.printJobId!)).toMatchObject({ status: "cancelled", last_error: "expired" });
    });

    it("never gives one ticket to two agents at once", async () => {
      const ticket = await checkIn(kioskOne);
      const answers = await Promise.all([1, 2, 3, 4].map(() => claim()));
      const got = answers.map((a) => a.body.job).filter(Boolean);
      expect(got).toHaveLength(1);
      expect(got[0].id).toBe(ticket.printJobId);
      await result(ticket.printJobId!, { outcome: "printed" }).expect(200);
    });

    it("reports the printer's state, and calls a silent printer unavailable", async () => {
      await staff(agent).post("/kiosk/print/heartbeat", { deviceCode: "print-1", printerStatus: "ok" }).expect(200);
      const find = async () =>
        ((await staff(desk).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ code: string; printer: string }>).find((d) => d.code === "print-1");
      expect(await find()).toMatchObject({ printer: "available" });
      await staff(agent).post("/kiosk/print/heartbeat", { deviceCode: "print-1", printerStatus: "paper_out" }).expect(200);
      expect(await find()).toMatchObject({ printer: "attention" });
      await ctx.pool.query(`UPDATE kiosk_device SET printer_heartbeat_at = now() - interval '5 minutes' WHERE code = 'print-1'`);
      expect(await find()).toMatchObject({ printer: "unavailable" });
    });

    it("is limited to its own facility's kiosks and to printing", async () => {
      // Another facility's agent cannot see or claim this facility's kiosk.
      await staff(annexAgent, tenant.otherFacilityId).post("/kiosk/print/claim", { deviceCode: "print-1" }).expect(404);
      await staff(annexAgent, tenant.otherFacilityId).post("/kiosk/print/heartbeat", { deviceCode: "print-1", printerStatus: "ok" }).expect(404);
      // Nobody else may act as the agent.
      for (const token of [desk, cashier, kioskOne, admin]) await claim(token).expect(403);
      // And the agent does nothing else: no kiosk sessions, no patients, no queue, no registrations.
      await staff(agent).post("/kiosk/sessions").expect(403);
      await staff(agent).get("/patients?q=a").expect(403);
      await staff(agent).get("/queue").expect(403);
      await staff(agent).get("/kiosk/admin/registrations").expect(403);
      await staff(agent).post("/kiosk/admin/print-jobs/00000000-0000-4000-8000-000000000000/reprint", { reason: "Trying it" }).expect(403);
    });
  });

  describe("printing a ticket again", () => {
    async function printed() {
      const ticket = await checkIn(kioskOne);
      await claim().expect(200);
      await result(ticket.printJobId!, { outcome: "printed" }).expect(200);
      return ticket;
    }

    it("is a staff decision with a reason, queued as a new job that points at the original, and audited", async () => {
      const ticket = await printed();
      await staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, {}).expect(400);
      await staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: "no" }).expect(400);
      const again = (await staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: "Patient lost the ticket" }).expect(200)).body;
      expect(again).toMatchObject({ ticket: ticket.ticket, status: "queued", reprint: true, canReprint: false });
      expect(await jobRow(again.id)).toMatchObject({ reprint_of: ticket.printJobId, reprint_reason: "Patient lost the ticket" });
      const audit = await auditRows(ctx.pool, `action = 'kiosk.print.reprint' AND resource_id = $1`, [again.id]);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.reason).toBe("Patient lost the ticket");
      // The agent prints the reprint like any job.
      expect((await claim().expect(200)).body.job).toMatchObject({ id: again.id });
    });

    it("waits for the earlier print to finish, and stops at the limit", async () => {
      const ticket = await checkIn(kioskOne);
      await claim().expect(200);
      expect((await staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: "Printer is slow" }).expect(422)).body.error.code).toBe(
        "print_job_in_progress",
      );
      await result(ticket.printJobId!, { outcome: "printed" }).expect(200);

      for (const time of [1, 2]) {
        const again = (
          await staff(desk)
            .post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: `Lost it ${time}` })
            .expect(200)
        ).body;
        await claim().expect(200);
        await result(again.id, { outcome: "printed" }).expect(200);
      }
      const refused = await staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: "Lost it again" }).expect(422);
      expect(refused.body.error.code).toBe("reprint_limit_reached");
      expect((await listed(ticket.printJobId!))?.canReprint).toBe(false);
    });

    it("counts simultaneous reprints one after the other", async () => {
      const ticket = await printed();
      const answers = await Promise.all(
        [1, 2, 3, 4].map((i) => staff(desk).post(`/kiosk/admin/print-jobs/${ticket.printJobId}/reprint`, { reason: `At the same time ${i}` })),
      );
      expect(answers.filter((a) => a.status === 200)).toHaveLength(2);
      expect(answers.filter((a) => a.status === 422).map((a) => a.body.error.code)).toEqual(["reprint_limit_reached", "reprint_limit_reached"]);
      const reprints = await ctx.pool.query(`SELECT count(*)::int AS n FROM kiosk_print_job WHERE reprint_of = $1`, [ticket.printJobId]);
      expect(reprints.rows[0].n).toBe(2);
    });

    it("is refused once the visit is closed, for a kiosk out of service, and for the wrong people or place", async () => {
      const closed = await printed();
      const visitId = (await jobRow(closed.printJobId!)).visit_id as string;
      await ctx.pool.query(`UPDATE visit SET status = 'left_without_being_seen', completed_at = now(), closed_reason = 'Left' WHERE id = $1`, [visitId]);
      expect((await staff(desk).post(`/kiosk/admin/print-jobs/${closed.printJobId}/reprint`, { reason: "Patient is back" }).expect(422)).body.error.code).toBe(
        "ticket_no_longer_valid",
      );

      const outOfService = await printed();
      await ctx.pool.query(`UPDATE kiosk_device SET status = 'maintenance' WHERE code = 'print-1'`);
      expect(
        (await staff(desk).post(`/kiosk/admin/print-jobs/${outOfService.printJobId}/reprint`, { reason: "Kiosk is down" }).expect(422)).body.error.code,
      ).toBe("kiosk_not_available");
      await ctx.pool.query(`UPDATE kiosk_device SET status = 'active' WHERE code = 'print-1'`);

      const fine = await printed();
      await staff(cashier).post(`/kiosk/admin/print-jobs/${fine.printJobId}/reprint`, { reason: "I would like one" }).expect(403);
      await staff(annexDesk, tenant.otherFacilityId).post(`/kiosk/admin/print-jobs/${fine.printJobId}/reprint`, { reason: "Wrong facility" }).expect(404);
      await staff(annexDesk, tenant.otherFacilityId).get("/kiosk/admin/print-jobs").expect(200);
    });

    it("lists the day's tickets for staff, without patient details", async () => {
      const items = (await staff(desk).get("/kiosk/admin/print-jobs").expect(200)).body.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(3);
      expect(Object.keys(items[0]!).sort()).toEqual(
        ["attempts", "canReprint", "createdAt", "device", "id", "lastError", "printedAt", "reprint", "serviceName", "status", "ticket"].sort(),
      );
      expect(JSON.stringify(items)).not.toMatch(/Print\d+x|Given\d+/);
      const failedOnly = (await staff(desk).get("/kiosk/admin/print-jobs?status=failed").expect(200)).body.items as Array<{ status: string }>;
      expect(failedOnly.every((j) => j.status === "failed")).toBe(true);
      await staff(cashier).get("/kiosk/admin/print-jobs").expect(403);
      // Another facility sees none of these.
      expect(((await staff(annexDesk, tenant.otherFacilityId).get("/kiosk/admin/print-jobs").expect(200)).body.items as unknown[]).length).toBe(0);
    });
  });

  describe("the waiting-room display's settings", () => {
    const settings = () => staff(admin).get(`/clinic/queue-display-settings?facilityId=${tenant.facilityId}`);

    it("starts with the defaults, takes the clinic's own words, and refuses a bad colour or a stale version", async () => {
      expect((await settings().expect(200)).body).toEqual({
        facilityId: tenant.facilityId,
        headline: null,
        footerMessage: null,
        accentColor: null,
        groupByServicePoint: false,
        version: null,
      });
      const saved = (
        await staff(admin)
          .put("/clinic/queue-display-settings", {
            facilityId: tenant.facilityId,
            headline: "Welcome to Barangay Health Center",
            footerMessage: "Please keep your number until you are called.",
            accentColor: "#1A7F8E",
            groupByServicePoint: false,
          })
          .expect(200)
      ).body;
      expect(saved).toMatchObject({ headline: "Welcome to Barangay Health Center", accentColor: "#1A7F8E", version: 1 });
      await staff(admin).put("/clinic/queue-display-settings", { facilityId: tenant.facilityId, accentColor: "teal", groupByServicePoint: false }).expect(400);
      await staff(admin).put("/clinic/queue-display-settings", { facilityId: tenant.facilityId, groupByServicePoint: false, version: 7 }).expect(409);
      // An omitted text keeps the current one; an empty one clears it.
      const kept = (
        await staff(admin)
          .put("/clinic/queue-display-settings", { facilityId: tenant.facilityId, groupByServicePoint: false, version: 1, footerMessage: "" })
          .expect(200)
      ).body;
      expect(kept).toMatchObject({ headline: "Welcome to Barangay Health Center", footerMessage: null, version: 2 });
      expect((await auditRows(ctx.pool, `action = 'queue-display-setting.update'`)).length).toBe(2);
      await staff(desk).put("/clinic/queue-display-settings", { facilityId: tenant.facilityId, groupByServicePoint: true }).expect(403);
    });

    it("is what the display says, with calls grouped by service point when asked, and still nothing about a patient", async () => {
      const display = () => staff(screen).get("/queue/display");
      expect((await display().expect(200)).body).toMatchObject({
        branding: { headline: "Welcome to Barangay Health Center", footerMessage: null, accentColor: "#1A7F8E" },
        groups: null,
      });

      const xray = (
        await staff(admin)
          .post("/clinic/service-points", { facilityId: tenant.facilityId, code: "xray", name: "X-ray", kind: "imaging", location: "Room 4" })
          .expect(201)
      ).body;
      const ticket = await checkIn(kioskOne);
      const visit = (await ctx.pool.query(`SELECT id, version FROM visit WHERE id = (SELECT visit_id FROM kiosk_print_job WHERE id = $1)`, [ticket.printJobId]))
        .rows[0];
      await ctx.pool.query(`UPDATE visit SET service_point_id = $1 WHERE id = $2`, [xray.id, visit.id]);
      await staff(desk).post(`/queue/visits/${visit.id}/call`, { calledTo: "Room 4", version: visit.version }).expect(200);

      await staff(admin).put("/clinic/queue-display-settings", { facilityId: tenant.facilityId, groupByServicePoint: true, version: 2 }).expect(200);
      const body = (await display().expect(200)).body;
      expect(Object.keys(body).sort()).toEqual(["branding", "calls", "date", "facilityName", "groups", "timeZone", "waiting"]);
      const grouped = (body.groups as Array<{ name: string; calls: Array<{ ticket: string; calledTo: string }>; waiting: number }>).find(
        (g) => g.name === "X-ray",
      );
      expect(grouped?.calls).toEqual([expect.objectContaining({ ticket: ticket.ticket, calledTo: "Room 4" })]);
      expect(JSON.stringify(body)).not.toMatch(/Print\d+x|Given\d+|P\d{8}/);
    });
  });

  describe("a kiosk's own print agent (KA-04)", () => {
    it("lets only the named agent account claim, report and heartbeat for a kiosk; an unnamed kiosk is served by any agent", async () => {
      await createStaff(ctx.pool, tenant, "agent3@print.ph", [{ role: "kiosk_print_agent", facilityId: tenant.facilityId }]);
      const agent3 = (await login(ctx, "agent3@print.ph")).accessToken;
      const devices = (await staff(admin).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ id: string; code: string; version: number }>;
      const side = devices.find((d) => d.code === "print-2")!;

      // Only an account holding the print agent role at the facility can be named.
      const notAgent = await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printAgentUserId: await userId("desk@print.ph"), version: side.version });
      expect(notAgent.status).toBe(422);
      expect(notAgent.body.error.code).toBe("not_a_print_agent_account");

      const bound = await staff(admin)
        .patch(`/kiosk/admin/devices/${side.id}`, { printAgentUserId: await userId("agent3@print.ph"), version: side.version })
        .expect(200);
      expect(bound.body.printAgentUserId).toBe(await userId("agent3@print.ph"));

      const ticket = await checkIn(kioskTwo);
      // The other agent of the facility no longer sees this kiosk at all.
      await claim(agent, "print-2").expect(404);
      await staff(agent).post("/kiosk/print/heartbeat", { deviceCode: "print-2", printerStatus: "ok" }).expect(404);
      const claimed = (await claim(agent3, "print-2").expect(200)).body.job;
      expect(claimed).toMatchObject({ id: ticket.printJobId });
      await result(ticket.printJobId!, { outcome: "printed" }, agent).expect(404);
      await result(ticket.printJobId!, { outcome: "printed" }, agent3).expect(200);
      // An unnamed kiosk is still served by any agent of the facility.
      await claim(agent, "print-1").expect(200);
      await claim(agent3, "print-1").expect(200);

      // Letting any agent serve it again.
      const freed = await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printAgentUserId: null, version: bound.body.version }).expect(200);
      expect(freed.body.printAgentUserId).toBeNull();
      await claim(agent, "print-2").expect(200);
      expect((await auditRows(ctx.pool, `action = 'kiosk.device.update'`)).length).toBeGreaterThan(0);
    });
  });

  describe("printer settings (migration 0143)", () => {
    const devices = async () =>
      (await staff(admin).get("/kiosk/admin/devices").expect(200)).body.items as Array<{ id: string; code: string; version: number } & Record<string, unknown>>;

    it("sets where a kiosk's printer is and its roll width, refusing an address outside the clinic's network", async () => {
      const side = (await devices()).find((d) => d.code === "print-2")!;
      const set = (body: object, version = side.version) => staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { ...body, version });

      const refused = await set({ printerConnection: "network", printerHost: "8.8.8.8" });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe("printer_host_not_private");
      expect((await set({ printerConnection: "network", printerHost: "http://192.168.1.50/" })).body.error.code).toBe("printer_host_invalid");
      expect((await set({ printerConnection: "network" })).body.error.code).toBe("printer_host_required");

      const network = await set({ printerConnection: "network", printerHost: "192.168.1.50", printerPort: 9101, paperMm: 58 }).expect(200);
      expect(network.body).toMatchObject({ printerConnection: "network", printerHost: "192.168.1.50", printerPort: 9101, paperMm: 58 });
      // Only the roll width changes: the address stays.
      const narrow = await set({ paperMm: 80 }, network.body.version).expect(200);
      expect(narrow.body).toMatchObject({ printerConnection: "network", printerHost: "192.168.1.50", paperMm: 80 });
      // Back to the printer on the agent's computer: no address is kept.
      const local = await set({ printerConnection: "agent_local" }, narrow.body.version).expect(200);
      expect(local.body).toMatchObject({ printerConnection: "agent_local", printerHost: null, printerPort: null });
      const audited = await ctx.pool.query(
        `SELECT count(*)::int AS n FROM audit_event WHERE action = 'kiosk.device.update' AND changes::text LIKE '%192.168.1.50%'`,
      );
      expect(audited.rows[0].n).toBeGreaterThan(0);
    });

    it("gives a waiting-room screen no printer", async () => {
      const screen = await staff(admin)
        .post("/kiosk/admin/devices", { kind: "display", code: "lobby-cfg", name: "Lobby", userId: await userId("screen2@print.ph") })
        .expect(201);
      const refused = await staff(admin).patch(`/kiosk/admin/devices/${screen.body.id}`, {
        printerConnection: "network",
        printerHost: "192.168.1.60",
        version: screen.body.version,
      });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe("not_a_kiosk");
    });

    it("tells the print agent its kiosks, where each printer is and the facility's time zone, and no one else", async () => {
      const side = (await devices()).find((d) => d.code === "print-2")!;
      await staff(admin)
        .patch(`/kiosk/admin/devices/${side.id}`, { printerConnection: "network", printerHost: "printer-2.local", paperMm: 58, version: side.version })
        .expect(200);

      const config = (await staff(agent).get("/kiosk/print/config").expect(200)).body;
      expect(config.timeZone).toBe("Asia/Manila");
      const codes = config.kiosks.map((k: { code: string }) => k.code);
      expect(codes).toEqual(expect.arrayContaining(["print-1", "print-2"]));
      expect(config.kiosks.find((k: { code: string }) => k.code === "print-2")).toMatchObject({
        printsTickets: true,
        connection: "network",
        host: "printer-2.local",
        paperMm: 58,
      });
      expect(config.kiosks.find((k: { code: string }) => k.code === "print-1")).toMatchObject({ connection: "agent_local", host: null, paperMm: 80 });
      // A display is not a kiosk, and the config carries nothing about a patient.
      expect(codes).not.toContain("lobby-cfg");
      expect(JSON.stringify(config)).not.toMatch(/patientId|visitId|displayName|birth/i);

      // Another facility's agent sees none of this facility's kiosks; staff and kiosk accounts are refused.
      expect((await staff(annexAgent, tenant.otherFacilityId).get("/kiosk/print/config").expect(200)).body.kiosks).toEqual([]);
      await staff(desk).get("/kiosk/print/config").expect(403);
      await staff(kioskOne).get("/kiosk/print/config").expect(403);
    });

    it("leaves out a kiosk that names another agent", async () => {
      const side = (await devices()).find((d) => d.code === "print-2")!;
      const other = await userId("agent3@print.ph");
      await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printAgentUserId: other, version: side.version }).expect(200);
      const seen = (await staff(agent).get("/kiosk/print/config").expect(200)).body.kiosks.map((k: { code: string }) => k.code);
      expect(seen).not.toContain("print-2");
      const bound = (await devices()).find((d) => d.code === "print-2")!;
      await staff(admin).patch(`/kiosk/admin/devices/${side.id}`, { printAgentUserId: null, version: bound.version }).expect(200);
    });
  });
});
