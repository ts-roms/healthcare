import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pribado-at-Ligtas-2026";

/**
 * Data Privacy Act coverage (docs/security/data-privacy-act.md; migration 0114): the breach register with the
 * organization's own notification window, and data-subject requests beyond copies (correction, erasure, objection)
 * answered by the records office with what was done. Nothing decides or deletes on the platform's own.
 */
describe("data privacy", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let records: string;
  let nurse: string;
  let patientId: string;
  let patientToken: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = () => ({
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${patientToken}` }),
    post: (url: string, body: object = {}) =>
      ctx
        .http()
        .post(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${patientToken}` })
        .send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "privacy-org");
    await createStaff(ctx.pool, tenant, "admin@privacy.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@privacy.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@privacy.ph", ["nurse"]);
    [admin, records, nurse] = await Promise.all(["admin", "records", "nurse"].map(async (u) => (await login(ctx, `${u}@privacy.ph`)).accessToken));
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    // A MyHealth account for the patient.
    await api(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "privacy-org",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@privacy.ph",
        password: PASSWORD,
      })
      .expect(200);
    patientToken = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "privacy-org", email: "juan@privacy.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  describe("breach register", () => {
    let incidentId: string;
    let version: number;

    it("keeps the organization's own notification window and DPO, for administrators only", async () => {
      await api(nurse).get("/privacy/setting").expect(403);
      expect((await api(admin).get("/privacy/setting").expect(200)).body).toMatchObject({ breachNotificationHours: 72, dpoName: null, version: 0 });
      const saved = await api(admin)
        .put("/privacy/setting", { breachNotificationHours: 48, dpoName: "Atty. Reyes", dpoContact: "dpo@privacy.ph", version: 0 })
        .expect(200);
      expect(saved.body).toMatchObject({ breachNotificationHours: 48, dpoName: "Atty. Reyes", version: 1 });
      // A stale version is refused.
      await api(admin).put("/privacy/setting", { breachNotificationHours: 72, dpoName: null, dpoContact: null, version: 0 }).expect(409);
      // Patients see the DPO's name and contact in MyHealth.
      expect((await portal().get("/privacy").expect(200)).body).toEqual({ dpoName: "Atty. Reyes", dpoContact: "dpo@privacy.ph" });
    });

    it("records an incident with the window counted from discovery, and keeps what is done in order", async () => {
      const discoveredAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const recorded = await api(admin)
        .post("/privacy/incidents", {
          title: "Laptop with an exported list lost",
          description: "A laptop used at the records office was lost on 19 October; it held an exported appointment list.",
          discoveredAt,
          dataCategories: ["identifiers", "contact"],
          affectedEstimate: 120,
        })
        .expect(201);
      incidentId = recorded.body.id;
      version = recorded.body.version;
      expect(recorded.body).toMatchObject({
        incidentNumber: "PI00000001",
        status: "open",
        assessment: "pending",
        notificationPending: true,
        notificationOverdue: false,
        notifyBy: new Date(new Date(discoveredAt).getTime() + 48 * 3_600_000).toISOString(),
      });
      expect(recorded.body.hoursLeft).toBeGreaterThan(45);
      // Cannot close before assessing.
      await api(admin).post(`/privacy/incidents/${incidentId}/close`, { note: "Nothing to do, laptop found.", version }).expect(422);
      const note = await api(admin)
        .post(`/privacy/incidents/${incidentId}/entries`, { kind: "containment", note: "Remote wipe requested from the device management console.", version })
        .expect(201);
      version = note.body.version;
      const assessed = await api(admin)
        .post(`/privacy/incidents/${incidentId}/assess`, {
          assessment: "notifiable",
          reason: "Names and contact details of 120 patients, device not encrypted; the DPO judges harm likely.",
          version,
        })
        .expect(200);
      version = assessed.body.version;
      expect(assessed.body).toMatchObject({ assessment: "notifiable", notificationPending: true });
      const npc = await api(admin)
        .post(`/privacy/incidents/${incidentId}/npc-notification`, { notifiedAt: new Date().toISOString(), reference: "NPC-2026-0042", version })
        .expect(200);
      version = npc.body.version;
      expect(npc.body).toMatchObject({ npcReference: "NPC-2026-0042", notificationPending: false, hoursLeft: null });
      await api(admin)
        .post(`/privacy/incidents/${incidentId}/npc-notification`, { notifiedAt: new Date().toISOString(), reference: "again", version })
        .expect(422);
      const told = await api(admin)
        .post(`/privacy/incidents/${incidentId}/subjects-notification`, {
          notifiedAt: new Date().toISOString(),
          method: "Letter and SMS to each patient",
          version,
        })
        .expect(200);
      version = told.body.version;
      const closed = await api(admin)
        .post(`/privacy/incidents/${incidentId}/close`, { note: "Device wiped and recovered; procedures updated to forbid exports on laptops.", version })
        .expect(200);
      expect(closed.body).toMatchObject({ status: "closed", notificationPending: false });
      // Closed incidents refuse further changes.
      await api(admin).post(`/privacy/incidents/${incidentId}/entries`, { kind: "note", note: "Late note", version: closed.body.version }).expect(422);

      const detail = await api(admin).get(`/privacy/incidents/${incidentId}`).expect(200);
      expect(detail.body.entries.map((e: { kind: string }) => e.kind)).toEqual([
        "reported",
        "containment",
        "assessment",
        "npc_notified",
        "subjects_notified",
        "closed",
      ]);
      // The register is append-only and audited.
      await expect(ctx.pool.query(`UPDATE privacy_incident_entry SET note = 'x' WHERE incident_id = $1`, [incidentId])).rejects.toThrow(/append-only/);
      await expect(ctx.pool.query(`DELETE FROM privacy_incident WHERE id = $1`, [incidentId])).rejects.toThrow(/append-only/);
      const audits = await auditRows(ctx.pool, "resource_type = 'privacy_incident' AND resource_id = $1", [incidentId]);
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          "privacy.incident.record",
          "privacy.incident.note",
          "privacy.incident.assess",
          "privacy.incident.npc-notified",
          "privacy.incident.close",
          "privacy.incident.view",
        ]),
      );
      // Events carry ids and statuses, never the description.
      const events = await ctx.pool.query(`SELECT payload::text AS p FROM domain_event WHERE aggregate_id = $1`, [incidentId]);
      expect(events.rows.length).toBeGreaterThanOrEqual(2);
      expect(events.rows.some((r) => /laptop/i.test(r.p))).toBe(false);
    });

    it("flags the window as passed for an incident discovered long ago, and lists open and closed ones apart", async () => {
      const old = await api(admin)
        .post("/privacy/incidents", {
          title: "Misdirected email",
          description: "A laboratory report was emailed to the wrong patient and recalled.",
          discoveredAt: new Date(Date.now() - 100 * 3_600_000).toISOString(),
          dataCategories: ["health"],
        })
        .expect(201);
      expect(old.body).toMatchObject({ notificationPending: true, notificationOverdue: true });
      expect(old.body.hoursLeft).toBeLessThan(0);
      const open = await api(admin).get("/privacy/incidents").expect(200);
      expect(open.body.map((i: { incidentNumber: string }) => i.incidentNumber)).toEqual(["PI00000002"]);
      const closed = await api(admin).get("/privacy/incidents").query({ status: "closed" }).expect(200);
      expect(closed.body.map((i: { incidentNumber: string }) => i.incidentNumber)).toEqual(["PI00000001"]);
      await api(records).get("/privacy/incidents").expect(403);
    });
  });

  describe("data-subject requests", () => {
    it("refuses a correction request without saying what is wrong, and keeps copies as before", async () => {
      await portal()
        .post("/records-requests", { kind: "rectification", scope: ["consultations"] })
        .expect(400); // validation: a correction must say what is wrong
      const copies = await portal()
        .post("/records-requests", { scope: ["certificates"] })
        .expect(201);
      expect(copies.body.kind).toBe("access");
      // Copies are still answered only with documents.
      const refused = await api(records)
        .post(`/records-requests/${copies.body.id}/fulfil`, { documentIds: [], note: "Nothing to share", version: copies.body.version })
        .expect(422);
      expect(refused.body.error.code).toBe("answer_incomplete");
    });

    it("answers a correction request with what was done, without changing any record itself", async () => {
      const request = await portal()
        .post("/records-requests", {
          kind: "rectification",
          scope: ["other"],
          details: "My middle name is spelled Santos, not Santo, on my record.",
        })
        .expect(201);
      expect(request.body).toMatchObject({ kind: "rectification", status: "submitted" });
      const listed = await api(records).get("/records-requests").expect(200);
      expect(listed.body.find((r: { id: string }) => r.id === request.body.id)).toMatchObject({ kind: "rectification" });
      // Answering needs a note saying what was done; documents are optional.
      const incomplete = await api(records).post(`/records-requests/${request.body.id}/fulfil`, { documentIds: [], version: request.body.version }).expect(422);
      expect(incomplete.body.error.code).toBe("answer_incomplete");
      const answered = await api(records)
        .post(`/records-requests/${request.body.id}/fulfil`, {
          documentIds: [],
          note: "Your middle name was corrected to Santos.",
          version: request.body.version,
        })
        .expect(200);
      expect(answered.body).toMatchObject({ status: "fulfilled", responseNote: "Your middle name was corrected to Santos." });
      const mine = await portal().get("/documents").expect(200);
      expect(mine.body.requests.find((r: { id: string }) => r.id === request.body.id)).toMatchObject({
        kind: "rectification",
        status: "fulfilled",
        documents: [],
      });
      // The patient's record was not touched by the request itself.
      const { rows } = await ctx.pool.query<{ middle_name: string }>("SELECT middle_name FROM patient WHERE id = $1", [patientId]);
      expect(rows[0]!.middle_name).toBe("Santos");
    });
  });
});
