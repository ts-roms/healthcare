import { PatientRecordService } from "@healthcare/patient";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

describe("patient master", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let token: string;
  let juanId: string;

  const api = () => ({
    get: (url: string) => ctx.http().get(url).set(as(token, tenant.facilityId)),
    post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)),
    patch: (url: string) => ctx.http().patch(url).set(as(token, tenant.facilityId)),
    put: (url: string) => ctx.http().put(url).set(as(token, tenant.facilityId)),
    delete: (url: string) => ctx.http().delete(url).set(as(token, tenant.facilityId)),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "patient-org");
    await createStaff(ctx.pool, tenant, "records@example.ph", ["org_admin"]);
    token = (await login(ctx, "records@example.ph")).accessToken;
  });

  afterAll(() => ctx.close());

  it("requires a facility context to register", async () => {
    const response = await ctx.http().post("/api/v1/patients").set(as(token)).send(juan).expect(400);
    expect(response.body.error.code).toBe("facility_required");
  });

  it("validates input server-side", async () => {
    const response = await api()
      .post("/api/v1/patients")
      .send({ ...juan, birthDate: "2999-01-01", contacts: [{ system: "mobile", value: "12" }] })
      .expect(400);
    expect(response.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["birthDate", "contacts.0.value"]));
    const invalidMobile = await api()
      .post("/api/v1/patients")
      .send({ ...juan, contacts: [{ system: "mobile", value: "12345678" }] })
      .expect(422);
    expect(invalidMobile.body.error.code).toBe("invalid_contact");
  });

  it("registers a patient with a sequential patient number and normalized contacts", async () => {
    const response = await api().post("/api/v1/patients").set("idempotency-key", "register-juan-1").send(juan).expect(201);
    expect(response.body.patientNumber).toBe("P00000001");
    juanId = response.body.id;

    const detail = await api().get(`/api/v1/patients/${juanId}`).expect(200);
    expect(detail.body).toMatchObject({
      displayName: "DELA CRUZ, Juan Santos",
      registeredFacilityId: tenant.facilityId,
      contacts: [expect.objectContaining({ system: "mobile", value: "0917 123 4567", isPrimary: true })],
      identifiers: [expect.objectContaining({ type: "philhealth_pin", value: "12-345678901-2" })],
    });
    const stored = await ctx.pool.query(`SELECT value_normalized FROM patient_contact_point WHERE patient_id = $1`, [juanId]);
    expect(stored.rows[0].value_normalized).toBe("+639171234567");
    expect((await auditRows(ctx.pool, `action = 'patient.view' AND patient_id = $1`, [juanId])).length).toBe(1);
  });

  it("replays an idempotent retry instead of registering twice", async () => {
    const retry = await api().post("/api/v1/patients").set("idempotency-key", "register-juan-1").send(juan).expect(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body.id).toBe(juanId);
    const reused = await api()
      .post("/api/v1/patients")
      .set("idempotency-key", "register-juan-1")
      .send({ ...juan, givenName: "Pedro" })
      .expect(422);
    expect(reused.body.error.code).toBe("idempotency_key_reused");
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM patient`);
    expect(count.rows[0].n).toBe(1);
  });

  it("blocks likely duplicates until reviewed, then audits the override", async () => {
    const variant = { familyName: "Dela Cruz", givenName: "Juan", sex: "male", birthDate: "1980-03-04" };
    const blocked = await api().post("/api/v1/patients").send(variant).expect(409);
    expect(blocked.body.error.code).toBe("possible_duplicates");
    const [candidate] = blocked.body.error.details.candidates;
    expect(candidate).toMatchObject({ level: "high", patient: { id: juanId, primaryMobileMasked: "********4567" } });
    // Summaries are minimal: no full contact details, addresses or identifiers.
    expect(candidate.patient).not.toHaveProperty("contacts");

    const created = await api()
      .post("/api/v1/patients")
      .send({
        ...variant,
        duplicateOverride: { reviewedCandidateIds: [juanId], reason: "Different person: father of patient, verified ID" },
      })
      .expect(201);
    const override = await auditRows(ctx.pool, `action = 'patient.duplicate-override' AND patient_id = $1`, [created.body.id]);
    expect(override[0]?.reason).toContain("verified ID");
  });

  it("never allows an identifier already assigned to another patient", async () => {
    const response = await api()
      .post("/api/v1/patients")
      .send({
        familyName: "Santos",
        givenName: "Maria",
        sex: "female",
        birthDate: "1990-07-15",
        identifiers: [{ type: "philhealth_pin", value: "123456789012" }],
      })
      .expect(409);
    expect(response.body.error.code).toBe("identifier_in_use");
  });

  it("flags transposed birth dates as possible duplicates", async () => {
    const check = await api()
      .post("/api/v1/patients/duplicate-check")
      .send({ familyName: "Dela Cruz", givenName: "Juan", middleName: "Santos", sex: "male", birthDate: "1980-04-03" })
      .expect(200);
    expect(check.body[0].level).toBe("possible");
    expect(check.body[0].reasons).toContain("similar_name_and_transposed_birth_date");
  });

  it("finds patients by number, mobile, misspelled name and identifier", async () => {
    await api().post("/api/v1/patients").send({ familyName: "Peña", givenName: "Ma. Teresa", sex: "female", birthDate: "1975-12-01" }).expect(201);
    const byNumber = await api().get("/api/v1/patients?q=P1").expect(200);
    expect(byNumber.body.items.map((p: { id: string }) => p.id)).toEqual([juanId]);
    const byMobile = await api().get("/api/v1/patients?q=%2B63%20917%20123%204567").expect(200);
    expect(byMobile.body.items.map((p: { id: string }) => p.id)).toEqual([juanId]);
    const byTypo = await api().get("/api/v1/patients?q=pena%20teresa").expect(200);
    expect(byTypo.body.items[0].displayName).toBe("PEÑA, Ma. Teresa");
    const byIdentifier = await api().get("/api/v1/patients?identifierType=philhealth_pin&identifierValue=123456789012").expect(200);
    expect(byIdentifier.body.items.map((p: { id: string }) => p.id)).toEqual([juanId]);
    await api().get("/api/v1/patients").expect(400);
    expect((await auditRows(ctx.pool, `action = 'patient.search'`)).length).toBeGreaterThanOrEqual(4);
  });

  it("leaves inactive records out of search unless asked, and reactivates them with a reason", async () => {
    const created = await api()
      .post("/api/v1/patients")
      .send({ familyName: "Villanueva", givenName: "Rosario", sex: "female", birthDate: "1950-03-03" })
      .expect(201);
    await api()
      .post(`/api/v1/patients/${created.body.id}/status`)
      .send({ status: "inactive", reason: "Moved abroad", version: created.body.version })
      .expect(200);
    expect((await api().get("/api/v1/patients?q=villanueva%20rosario").expect(200)).body.items).toEqual([]);
    const found = await api().get("/api/v1/patients?q=villanueva%20rosario&includeInactive=true").expect(200);
    expect(found.body.items).toEqual([expect.objectContaining({ id: created.body.id, status: "inactive" })]);
    await api()
      .post(`/api/v1/patients/${created.body.id}/status`)
      .send({ status: "active", reason: "Back in the Philippines", version: created.body.version + 1 })
      .expect(200);
    expect((await api().get("/api/v1/patients?q=villanueva%20rosario").expect(200)).body.items).toHaveLength(1);
    const events = await auditRows(ctx.pool, `action = 'patient.change-status' AND resource_id = $1`, [created.body.id]);
    expect(events.map((e) => e.reason)).toEqual(["Moved abroad", "Back in the Philippines"]);
  });

  it("records communication preferences chosen at the desk", async () => {
    await api()
      .put(`/api/v1/patients/${juanId}/communication-preferences`)
      .send({ preferences: [{ channel: "email", category: "outreach", optedIn: true }] })
      .expect(200);
    const detail = await api().get(`/api/v1/patients/${juanId}`).expect(200);
    expect(detail.body.communicationPreferences).toContainEqual({ channel: "email", category: "outreach", optedIn: true });
  });

  it("uses optimistic locking and audits field-level changes", async () => {
    await api().patch(`/api/v1/patients/${juanId}`).send({ occupation: "Teacher", version: 1 }).expect(200);
    const stale = await api().patch(`/api/v1/patients/${juanId}`).send({ occupation: "Engineer", version: 1 }).expect(409);
    expect(stale.body.error.code).toBe("version_conflict");
    const [update] = await auditRows(ctx.pool, `action = 'patient.update-demographics'`);
    expect(update).toBeDefined();
    const changes = await ctx.pool.query(`SELECT changes FROM audit_event WHERE action = 'patient.update-demographics'`);
    expect(changes.rows[0].changes).toEqual({ occupation: { from: null, to: "Teacher" } });
  });

  it("retires sub-records instead of deleting them", async () => {
    const added = await api().post(`/api/v1/patients/${juanId}/contacts`).send({ system: "mobile", value: "09181112222", isPrimary: true }).expect(201);
    const detail = await api().get(`/api/v1/patients/${juanId}`).expect(200);
    expect(detail.body.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary)).toEqual([expect.objectContaining({ id: added.body.id })]);

    await api().delete(`/api/v1/patients/${juanId}/contacts/${added.body.id}`).send({ reason: "Number no longer in use" }).expect(204);
    const rows = await ctx.pool.query(`SELECT status, retired_by FROM patient_contact_point WHERE id = $1`, [added.body.id]);
    expect(rows.rows[0]).toMatchObject({ status: "retired", retired_by: expect.any(String) });
    await api().delete(`/api/v1/patients/${juanId}/unknown/${added.body.id}`).send({ reason: "whatever reason" }).expect(404);
  });

  it("keeps consent history append-only", async () => {
    await api().post(`/api/v1/patients/${juanId}/consents`).send({ consentType: "data_processing", decision: "granted", capturedVia: "paper" }).expect(201);
    await api()
      .post(`/api/v1/patients/${juanId}/consents`)
      .send({ consentType: "data_processing", decision: "withdrawn", capturedVia: "electronic" })
      .expect(201);
    const detail = await api().get(`/api/v1/patients/${juanId}`).expect(200);
    expect(detail.body.consents).toEqual([expect.objectContaining({ consentType: "data_processing", decision: "withdrawn" })]);
    const history = await api().get(`/api/v1/patients/${juanId}/consents`).expect(200);
    expect(history.body.map((c: { decision: string }) => c.decision)).toEqual(["withdrawn", "granted"]);
    await expect(ctx.pool.query(`UPDATE patient_consent SET decision = 'granted'`)).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query(`DELETE FROM patient_consent`)).rejects.toThrow(/append-only/);
  });

  it("records a death and blocks changes to merged records at the database level", async () => {
    const current = await api().get(`/api/v1/patients/${juanId}`).expect(200);
    await api()
      .post(`/api/v1/patients/${juanId}/status`)
      .send({
        status: "deceased",
        deceasedAt: "2026-09-01T08:00:00+08:00",
        reason: "Death certificate received",
        version: current.body.version,
      })
      .expect(200);
    await expect(ctx.pool.query(`UPDATE patient SET status = 'merged' WHERE id = $1`, [juanId])).rejects.toThrow(/patient_check/);
  });

  it("reads the address and phone for case reporting only within the patient's organization", async () => {
    const other = await createTenant(ctx.pool, "patient-other");
    // Read by DOH case reporting from its event handler, under the outbox relay's platform scope.
    const records = underPlatform(ctx.app.get(PatientRecordService));
    const own = await records.primaryAddressAndPhone(tenant.organizationId, juanId);
    expect(own.contactNumber).toEqual(expect.any(String));
    expect(await records.primaryAddressAndPhone(other.organizationId, juanId)).toEqual({ address: null, contactNumber: null });
  });
});
