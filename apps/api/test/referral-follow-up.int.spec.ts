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
  PASSWORD,
  type Tenant,
  type TestContext,
} from "./harness";

/**
 * Referral follow-up (docs/domains/clinic.md, "Referrals"; migration 0080): the organization's overdue flag, the
 * Patient 360 panel, FHIR ServiceRequest, MyHealth (list, letter link, notice) and merged records.
 */
describe("referral follow-up", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let specialist: string;
  let nurse: string;
  let reception: string;
  let records: string;
  let portalToken: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (url: string) =>
    ctx
      .http()
      .get(`/api/v1/portal${url}`)
      .set({ authorization: `Bearer ${portalToken}` });
  const q = <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) => ctx.pool.query<T>(sql, params);
  const refer = (encounterId: string, body: object) => api(doctor).post(`/encounters/${encounterId}/referrals`, body).expect(201);
  /** Moves a referral's issue date back (the guard keeps it fixed; only the test moves it). */
  const issuedDaysAgo = async (referralId: string, days: number) => {
    await q("ALTER TABLE referral DISABLE TRIGGER referral_history");
    try {
      await q(`UPDATE referral SET issued_at = now() - make_interval(days => $2) WHERE id = $1`, [referralId, days]);
    } finally {
      await q("ALTER TABLE referral ENABLE TRIGGER referral_history");
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "referral-follow");
    await createStaff(ctx.pool, tenant, "admin@follow.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@follow.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "reception@follow.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "records@follow.ph", ["records_officer"]);
    const doctorRecord = await createClinician(ctx, tenant, "doctor@follow.ph", ["physician"]);
    ids.doctor = doctorRecord.practitionerId;
    ids.doctorUser = doctorRecord.userId;
    ids.specialist = (await createClinician(ctx, tenant, "specialist@follow.ph", ["physician"])).practitionerId;
    [admin, doctor, specialist, nurse, reception, records] = await Promise.all(
      ["admin", "doctor", "specialist", "nurse", "reception", "records"].map(async (u) => (await login(ctx, `${u}@follow.ph`)).accessToken),
    );
    ids.patient = (await api(admin).post("/patients", juan).expect(201)).body.id;
    await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
    ids.encounter = (await api(doctor).post("/encounters", { patientId: ids.patient, chiefComplaint: "Chest pain on exertion" }).expect(201)).body.id;
    ids.diagnosis = (
      await api(doctor)
        .post(`/encounters/${ids.encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "I20.9", display: "Angina pectoris", rank: "primary" })
        .expect(201)
    ).body.id;

    // MyHealth for the patient.
    await api(admin).post(`/patients/${ids.patient}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${ids.patient}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await q<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [ids.patient],
    );
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "referral-follow",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@follow.ph",
        password: PASSWORD,
      })
      .expect(200);
    portalToken = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "referral-follow", email: "juan@follow.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;

    ids.internal = (
      await refer(ids.encounter, {
        kind: "internal",
        toPractitionerId: ids.specialist,
        specialty: "Cardiology",
        urgency: "emergency",
        reason: "Exertional chest pain; please evaluate",
        clinicalSummary: "ECG unremarkable at rest",
        diagnosisIds: [ids.diagnosis],
      })
    ).body.id;
    ids.external = (
      await refer(ids.encounter, {
        kind: "external",
        externalProvider: "Dr. R. Reyes",
        externalFacility: "Heart Center",
        externalContact: "0917 000 0000",
        urgency: "routine",
        reason: "Stress test",
      })
    ).body.id;
    ids.cancelled = (
      await refer(ids.encounter, { kind: "external", externalProvider: "Somewhere Clinic", urgency: "urgent", reason: "Second opinion" })
    ).body.id;
    await api(doctor).post(`/referrals/${ids.cancelled}/cancel`, { reason: "Patient prefers to wait", version: 1 }).expect(200);
  });
  afterAll(() => ctx.close());

  it("flags referrals still awaiting the recipient once the organization chooses a number of days (off by default)", async () => {
    expect((await api(doctor).get("/referrals/settings").expect(200)).body).toEqual({ overdueAfterDays: null, version: 0 });
    await issuedDaysAgo(ids.internal, 10);
    await issuedDaysAgo(ids.external, 2);
    // Off: nothing is overdue, however old.
    expect((await api(doctor).get("/referrals?view=overdue").expect(200)).body).toEqual([]);
    expect((await api(doctor).get(`/referrals/${ids.internal}`).expect(200)).body.overdue).toBe(false);

    // clinic.configure only; 1–365 days; optimistic version.
    await api(doctor).put("/referrals/settings", { overdueAfterDays: 7, version: 0 }).expect(403);
    await api(admin).put("/referrals/settings", { overdueAfterDays: 0, version: 0 }).expect(400);
    await api(admin).put("/referrals/settings", { overdueAfterDays: 366, version: 0 }).expect(400);
    expect((await api(admin).put("/referrals/settings", { overdueAfterDays: 7, version: 0 }).expect(200)).body).toEqual({ overdueAfterDays: 7, version: 1 });
    await api(admin).put("/referrals/settings", { overdueAfterDays: 5, version: 0 }).expect(409);
    const [audit] = await auditRows(ctx.pool, "action = 'encounter.referral.settings'", []);
    expect(audit).toMatchObject({ outcome: "success" });
    const changes = await q<{ changes: unknown }>("SELECT changes FROM audit_event WHERE action = 'encounter.referral.settings'");
    expect(changes.rows[0]?.changes).toEqual({ overdueAfterDays: { from: null, to: 7 } });

    // Sent 10 days ago: overdue; sent 2 days ago: not yet; cancelled: never.
    const overdue = (await api(doctor).get("/referrals?view=overdue").expect(200)).body;
    expect(overdue.map((r: { id: string; overdue: boolean }) => [r.id, r.overdue])).toEqual([[ids.internal, true]]);
    const all = (await api(doctor).get(`/referrals?view=all&patientId=${ids.patient}`).expect(200)).body as Array<{ id: string; overdue: boolean }>;
    expect(Object.fromEntries(all.map((r) => [r.id, r.overdue]))).toEqual({ [ids.internal]: true, [ids.external]: false, [ids.cancelled]: false });
    expect((await api(doctor).get(`/referrals/${ids.internal}`).expect(200)).body.overdue).toBe(true);

    // Answered: no longer waiting for the recipient.
    await api(specialist).post(`/referrals/${ids.internal}/answer`, { decision: "accept", version: 1 }).expect(200);
    expect((await api(doctor).get(`/referrals/${ids.internal}`).expect(200)).body.overdue).toBe(false);
    expect((await api(doctor).get("/referrals?view=overdue").expect(200)).body).toEqual([]);

    // Turned off again.
    await issuedDaysAgo(ids.external, 30);
    expect((await api(doctor).get("/referrals?view=overdue").expect(200)).body.map((r: { id: string }) => r.id)).toEqual([ids.external]);
    expect((await api(admin).put("/referrals/settings", { overdueAfterDays: null, version: 1 }).expect(200)).body).toEqual({
      overdueAfterDays: null,
      version: 2,
    });
    expect((await api(doctor).get("/referrals?view=overdue").expect(200)).body).toEqual([]);
    await api(admin).put("/referrals/settings", { overdueAfterDays: 7, version: 2 }).expect(200);
  });

  it("shows referrals in Patient 360 to those who read consultations, open ones first, without the reason", async () => {
    const workspace = (await api(doctor).get(`/patients/${ids.patient}/workspace`).expect(200)).body;
    expect(workspace.withheld).not.toContain("referrals");
    expect(workspace.referrals.map((r: { id: string; status: string; overdue: boolean }) => [r.id, r.status, r.overdue])).toEqual([
      [ids.external, "sent", true],
      [ids.internal, "accepted", false],
      [ids.cancelled, "cancelled", false],
    ]);
    expect(workspace.referrals[1]).toMatchObject({
      referralNumber: "RF00000001",
      urgency: "emergency",
      kind: "internal",
      specialty: "Cardiology",
      recipient: "Dr. specialist",
      referringPractitionerName: "Dr. doctor",
      filedUnder: null,
    });
    expect(workspace.referrals[0]).toMatchObject({ recipient: "Dr. R. Reyes, Heart Center" });
    expect(JSON.stringify(workspace.referrals)).not.toMatch(/chest pain|Stress test|ECG/i);

    const forReception = (await api(reception).get(`/patients/${ids.patient}/workspace`).expect(200)).body;
    expect(forReception.referrals).toBeNull();
    expect(forReception.withheld).toContain("referrals");
    const [view] = (await auditRows(ctx.pool, "action = 'patient.workspace.view' AND patient_id = $1", [ids.patient])).slice(-2);
    expect((view?.metadata as { counts: Record<string, unknown> }).counts.referrals).toBe(3);
  });

  it("exports referrals as FHIR ServiceRequest (category Patient referral; emergency as stat) in $everything and ServiceRequest?patient=", async () => {
    const everything = (await api(admin).get(`/fhir/r4/Patient/${ids.patient}/$everything?_count=200`).expect(200)).body;
    const referrals = everything.entry
      .map((e: { resource: { resourceType: string; id: string; category?: Array<{ coding?: Array<{ code: string }> }> } }) => e.resource)
      .filter((r: { resourceType: string; category?: Array<{ coding?: Array<{ code: string }> }> }) => r.category?.[0]?.coding?.[0]?.code === "3457005");
    expect(referrals.map((r: { id: string }) => r.id).sort()).toEqual([ids.internal, ids.external, ids.cancelled].sort());
    const internal = referrals.find((r: { id: string }) => r.id === ids.internal);
    expect(internal).toMatchObject({
      resourceType: "ServiceRequest",
      status: "active",
      intent: "order",
      priority: "stat",
      subject: { reference: `Patient/${ids.patient}` },
      encounter: { reference: `Encounter/${ids.encounter}` },
      requester: { reference: `Practitioner/${ids.doctor}` },
      performer: [{ reference: `Practitioner/${ids.specialist}` }],
      reasonReference: [{ reference: `Condition/${ids.diagnosis}` }],
      supportingInfo: [{ reference: `DocumentReference/${ids.internal}` }],
    });
    expect(referrals.find((r: { id: string }) => r.id === ids.cancelled)).toMatchObject({ status: "revoked", priority: "urgent" });
    // Every reference inside the Bundle resolves (the specialist is included as a Practitioner).
    const present = new Set(everything.entry.map((e: { resource: { resourceType: string; id: string } }) => `${e.resource.resourceType}/${e.resource.id}`));
    const references = (JSON.stringify(everything).match(/"reference":"([A-Za-z]+\/[^"]+)"/g) ?? []).map((r) => r.slice(13, -1));
    expect(references.filter((r) => !present.has(r))).toEqual([]);

    const search = (await api(admin).get(`/fhir/r4/ServiceRequest?patient=${ids.patient}`).expect(200)).body;
    expect(search.entry.map((e: { resource: { id: string } }) => e.resource.id)).toEqual(expect.arrayContaining([ids.internal, ids.external, ids.cancelled]));
    const capability = (await api(admin).get("/fhir/r4/metadata").expect(200)).body;
    const serviceRequest = capability.rest[0].resource.find((r: { type: string }) => r.type === "ServiceRequest");
    expect(serviceRequest.documentation).toContain("3457005");
  });

  it("lists the patient's referrals in MyHealth with the letter behind a short-lived audited link, and tells them without clinical detail", async () => {
    const documents = (await portal("/documents").expect(200)).body;
    const mine = documents.referrals as Array<{ id: string; status: string; letterAvailable: boolean; recipient: string; urgency: string }>;
    // Newest first (the internal referral was moved to 10 days ago, the external one to 30).
    expect(mine.map((r) => r.id)).toEqual([ids.cancelled, ids.internal, ids.external]);
    expect(mine.find((r) => r.id === ids.internal)).toMatchObject({
      referralNumber: "RF00000001",
      status: "accepted",
      urgency: "emergency",
      recipient: "Dr. specialist",
      specialty: "Cardiology",
      referringPractitionerName: "Dr. doctor",
      letterAvailable: true,
    });
    expect(mine.find((r) => r.id === ids.cancelled)).toMatchObject({ status: "cancelled", letterAvailable: false });
    expect(JSON.stringify(mine)).not.toMatch(/chest pain|Stress test|ECG|0917/i);
    const [view] = (await auditRows(ctx.pool, "action = 'portal.documents-view' AND patient_id = $1", [ids.patient])).slice(-1);
    expect(view?.metadata).toMatchObject({ referrals: 3 });

    const link = (await portal(`/referrals/${ids.internal}/link`).expect(200)).body;
    expect(link.url).toBeTruthy();
    expect(link.expiresAt).toBeTruthy();
    await portal(`/referrals/${ids.cancelled}/link`).expect(404);
    const downloads = await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1 AND actor_type = 'patient'", [ids.internal]);
    expect(downloads).toHaveLength(1);

    await drainEvents(ctx);
    const notices = await q<{ channel: string; variables: Record<string, string> }>(
      "SELECT channel, variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'records.update' ORDER BY created_at, channel",
      [ids.patient],
    );
    const inApp = notices.rows.filter((n) => n.channel === "in_app");
    expect(inApp.map((n) => n.variables.kind)).toEqual(["referral-ready", "referral-ready", "referral-ready"]);
    expect(JSON.stringify(notices.rows)).not.toMatch(/chest pain|Cardiology|Heart Center|Reyes/i);
    // One per referral and channel, however often the outbox delivers.
    await drainEvents(ctx);
    expect(
      (await q("SELECT 1 FROM notification WHERE recipient_patient_id = $1 AND template_key = 'records.update' AND channel = 'in_app'", [ids.patient]))
        .rowCount,
    ).toBe(3);
  });

  it("reads a merged record's referrals with the survivor, warns about open ones, and refuses new ones on the retired record", async () => {
    const duplicate = (
      await api(admin)
        .post("/patients", {
          ...juan,
          givenName: "Juanito",
          birthDate: "1985-01-01",
          contacts: [{ system: "mobile", value: "0917 222 3333" }],
          identifiers: [],
        })
        .expect(201)
    ).body;
    const encounter = (
      await q<{ id: string }>(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by, status, completed_at, signed_by_practitioner_id)
         VALUES ($1, $2, $3, $4, $5, 'completed', now(), $4) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, duplicate.id, ids.doctor, ids.doctorUser],
      )
    ).rows[0]!.id;
    const onDuplicate = (await refer(encounter, { kind: "external", externalProvider: "Eye Center", urgency: "routine", reason: "Visual acuity" })).body;

    const preview = (await api(records).get(`/patients/${duplicate.id}/merge-preview?into=${ids.patient}`).expect(200)).body;
    expect(preview.blockers).toEqual([]);
    expect(preview.warnings).toEqual([expect.objectContaining({ kind: "referral_open", id: onDuplicate.id, link: { type: "referral", id: onDuplicate.id } })]);
    expect(JSON.stringify(preview.warnings)).not.toContain("Visual acuity");
    await api(records)
      .post(`/patients/${duplicate.id}/merge`, {
        survivorPatientId: ids.patient,
        reason: "Same person registered twice",
        retiredVersion: preview.retired.version,
        survivorVersion: preview.survivor.version,
        acknowledgedDifferences: preview.differences.map((d: { code: string }) => d.code),
      })
      .expect(200);

    // New referrals are refused under the retired record (database trigger, PM001).
    await api(doctor)
      .post(`/encounters/${encounter}/referrals`, { kind: "external", externalProvider: "Eye Center", reason: "Again" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("patient_merged"));

    // Read with the survivor: the list, Patient 360 (filed under the retired number), FHIR and MyHealth.
    const list = (await api(doctor).get(`/referrals?view=all&patientId=${ids.patient}`).expect(200)).body.map((r: { id: string }) => r.id);
    expect(list).toContain(onDuplicate.id);
    const workspace = (await api(doctor).get(`/patients/${ids.patient}/workspace`).expect(200)).body;
    expect(workspace.referrals.find((r: { id: string }) => r.id === onDuplicate.id)).toMatchObject({ filedUnder: duplicate.patientNumber });
    const search = (await api(admin).get(`/fhir/r4/ServiceRequest?patient=${ids.patient}`).expect(200)).body;
    expect(search.entry.map((e: { resource: { id: string } }) => e.resource.id)).toContain(onDuplicate.id);
    expect((await portal("/documents").expect(200)).body.referrals.map((r: { id: string }) => r.id)).toContain(onDuplicate.id);
    expect((await portal(`/referrals/${onDuplicate.id}/link`).expect(200)).body.url).toBeTruthy();
    // Existing referrals are still handled: the reply is recorded.
    await api(doctor).post(`/referrals/${onDuplicate.id}/complete`, { outcomeNote: "Refraction done", version: 1 }).expect(200);
    void nurse;
  });
});
