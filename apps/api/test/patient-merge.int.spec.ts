import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";

interface Preview {
  retired: { id: string; patientNumber: string; version: number; portalAccount: { status: string } | null; mergedRecords: Array<{ id: string }> };
  survivor: { id: string; patientNumber: string; version: number };
  ineligibility: { code: string } | null;
  differences: Array<{ code: string; retired: string | null; survivor: string | null }>;
  blockers: Array<{ kind: string; id: string; link: { type: string; id: string } | null }>;
  warnings: Array<{ kind: string }>;
  portalAccount: string;
  repointed: Array<{ id: string }>;
  canMerge: boolean;
}

/**
 * Patient merge, "link, don't move" (docs/domains/patient.md, ADR-0009): the duplicate is retired into the surviving
 * record without rewriting anything filed under it; every patient view reads both; unmerge is exact.
 */
describe("patient merge", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let records: string;
  let doctor: string;
  let medtech: string;
  let otherOrgAdmin: string;
  let practitionerId: string;
  let survivorId: string;
  let retiredId: string;
  let thirdId: string;
  let retiredNumber: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);
  const version = async (id: string) => (await q(`SELECT version FROM patient WHERE id = $1`, [id])).rows[0].version as number;
  const preview = async (retired: string, into: string, token = records): Promise<Preview> =>
    (await api(token).get(`/patients/${retired}/merge-preview?into=${into}`).expect(200)).body;
  const register = async (body: object) => {
    const first = await api(admin).post("/patients", body);
    if (first.status === 201) return first.body as { id: string; patientNumber: string };
    const candidates = (first.body.error.details?.candidates ?? []) as Array<{ patient: { id: string } }>;
    return (
      await api(admin)
        .post("/patients", {
          ...body,
          duplicateOverride: { reviewedCandidateIds: candidates.map((c) => c.patient.id), reason: "Registered in a hurry at the front desk" },
        })
        .expect(201)
    ).body as { id: string; patientNumber: string };
  };
  const portalLogin = async () =>
    (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "merge-org", email: "juan@merge.ph", password: PATIENT_PASSWORD }).expect(200))
      .body.accessToken as string;
  const portal = (url: string, token: string) =>
    ctx
      .http()
      .get(`/api/v1/portal${url}`)
      .set({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "merge-org");
    await createStaff(ctx.pool, tenant, "admin@merge.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@merge.ph", ["records_officer"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "reyes@merge.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "medtech@merge.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@merge.ph")).accessToken;
    records = (await login(ctx, "records@merge.ph")).accessToken;
    doctor = (await login(ctx, "reyes@merge.ph")).accessToken;
    medtech = (await login(ctx, "medtech@merge.ph")).accessToken;
    const other = await createTenant(ctx.pool, "merge-other");
    await createStaff(ctx.pool, other, "admin@merge-other.ph", ["org_admin"]);
    otherOrgAdmin = (await login(ctx, "admin@merge-other.ph")).accessToken;

    // The surviving record, and a duplicate of the same person registered later with another middle name.
    survivorId = (await register(juan)).id;
    const duplicate = await register({
      familyName: "Dela Cruz",
      givenName: "Juan",
      middleName: "Santo",
      sex: "male",
      birthDate: juan.birthDate,
      contacts: [{ system: "mobile", value: "0918 765 4321" }],
      identifiers: [{ type: "philsys_number", value: "1234-5678-9012-3456" }],
    });
    retiredId = duplicate.id;
    retiredNumber = duplicate.patientNumber;
    thirdId = (await register({ familyName: "Dela Cruz", givenName: "Juan", middleName: "Santos", sex: "male", birthDate: juan.birthDate })).id;

    // Care filed under the duplicate: an allergy, a signed consultation and a released laboratory result.
    await api(doctor).post(`/patients/${retiredId}/allergies`, { category: "medication", substance: "Penicillin", criticality: "high" }).expect(201);
    ids.encounter = (
      await q(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by, status, completed_at, signed_by_practitioner_id, started_at)
         SELECT $1, $2, $3, $4, user_id, 'completed', now() - interval '1 day', $4, now() - interval '1 day' FROM practitioner WHERE id = $4 RETURNING id`,
        [tenant.organizationId, tenant.facilityId, retiredId, practitionerId],
      )
    ).rows[0].id;
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const fbs = (await lab("/tests", { code: "fbs", name: "FBS", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body.id;
    await lab(`/tests/${fbs}/reference-ranges`, { low: 3.9, high: 5.5 });
    const order = (
      await api(doctor)
        .post("/laboratory/orders", { patientId: retiredId, testIds: [fbs] })
        .expect(201)
    ).body;
    ids.order = order.id;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    ids.result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 6.1 }).expect(201)).body.id;

    // MyHealth: only the duplicate has an account.
    await api(admin).post(`/patients/${retiredId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    await api(admin).post(`/patients/${survivorId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${retiredId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "merge-org",
        patientNumber: retiredNumber,
        birthDate: juan.birthDate,
        activationCode: code,
        email: "juan@merge.ph",
        password: PATIENT_PASSWORD,
      })
      .expect(200);
  });

  afterAll(() => ctx.close());

  it("needs patient.merge and stays within the organization", async () => {
    await api(doctor).get(`/patients/${retiredId}/merge-preview?into=${survivorId}`).expect(403);
    await api(doctor)
      .post(`/patients/${retiredId}/merge`, { survivorPatientId: survivorId, reason: "Duplicate", retiredVersion: 1, survivorVersion: 1 })
      .expect(403);
    // Another organization's administrator does not find either record.
    const outsider = (url: string) => ctx.http().post(`/api/v1${url}`).set(as(otherOrgAdmin));
    await ctx.http().get(`/api/v1/patients/${retiredId}/merge-preview?into=${survivorId}`).set(as(otherOrgAdmin)).expect(404);
    await outsider(`/patients/${retiredId}/merge`)
      .send({ survivorPatientId: survivorId, reason: "Duplicate", retiredVersion: 1, survivorVersion: 1 })
      .expect(404);
    const same = await api(records).post(`/patients/${retiredId}/merge`, {
      survivorPatientId: retiredId,
      reason: "Duplicate",
      retiredVersion: 1,
      survivorVersion: 1,
    });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe("same_record");
  });

  it("previews both records with flagged differences and the work in progress that blocks a merge", async () => {
    // A consultation still in progress and a laboratory order not yet released, both under the duplicate.
    ids.open = (await api(doctor).post("/encounters", { patientId: retiredId }).expect(201)).body.id;
    const view = await preview(retiredId, survivorId);
    expect(view.retired).toMatchObject({ id: retiredId, patientNumber: retiredNumber, portalAccount: { status: "active" } });
    expect(view.differences).toEqual([
      expect.objectContaining({ code: "middle_name", retired: "Santo", survivor: "Santos" }),
      // Different identifier types are not a conflict; only the same type with another value would be.
    ]);
    expect(view.blockers.map((b) => b.kind).sort()).toEqual(["encounter_in_progress", "lab_order_open"]);
    expect(view.blockers.find((b) => b.kind === "encounter_in_progress")?.link).toEqual({ type: "encounter", id: ids.open });
    expect(view.portalAccount).toBe("moved_to_survivor");
    expect(view.canMerge).toBe(false);
    expect(await auditRows(ctx.pool, "action = 'patient.merge-preview' AND patient_id = $1", [retiredId])).toHaveLength(1);

    const blocked = await api(records).post(`/patients/${retiredId}/merge`, {
      survivorPatientId: survivorId,
      reason: "Same person registered twice",
      retiredVersion: view.retired.version,
      survivorVersion: view.survivor.version,
      acknowledgedDifferences: ["middle_name"],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("merge_blocked");
    expect(blocked.body.error.details.blockers.map((b: { kind: string }) => b.kind).sort()).toEqual(["encounter_in_progress", "lab_order_open"]);
  });

  it("refuses unacknowledged differences and stale versions", async () => {
    // Finish the work: the consultation is signed, the result released.
    await q(`UPDATE encounter SET status = 'completed', completed_at = now(), signed_by_practitioner_id = practitioner_id WHERE id = $1`, [ids.open]);
    await api(admin).post(`/laboratory/results/${ids.result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${ids.result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${ids.order}/release`).expect(200);
    await drainEvents(ctx);
    const view = await preview(retiredId, survivorId);
    expect(view.blockers).toEqual([]);
    expect(view.canMerge).toBe(true);

    const body = {
      survivorPatientId: survivorId,
      reason: "Same person registered twice",
      retiredVersion: view.retired.version,
      survivorVersion: view.survivor.version,
    };
    const unacknowledged = await api(records).post(`/patients/${retiredId}/merge`, body);
    expect(unacknowledged.status).toBe(422);
    expect(unacknowledged.body.error).toMatchObject({ code: "differences_not_acknowledged", details: { differences: ["middle_name"] } });
    const stale = await api(records).post(`/patients/${retiredId}/merge`, {
      ...body,
      survivorVersion: view.survivor.version + 1,
      acknowledgedDifferences: ["middle_name"],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_conflict");
  });

  it("merges: retires the duplicate, moves its MyHealth account, audits and records PatientMerged", async () => {
    const sessionBefore = await portalLogin();
    const view = await preview(retiredId, survivorId);
    const merged = await api(records)
      .post(`/patients/${retiredId}/merge`, {
        survivorPatientId: survivorId,
        reason: "Same person registered twice",
        retiredVersion: view.retired.version,
        survivorVersion: view.survivor.version,
        acknowledgedDifferences: ["middle_name"],
      })
      .expect(200);
    expect(merged.body).toMatchObject({ retiredPatientId: retiredId, survivorPatientId: survivorId, portalAccount: "moved_to_survivor", repointed: [] });

    const rows = (await q(`SELECT id, status, merged_into_patient_id FROM patient WHERE id = ANY($1) ORDER BY id`, [[retiredId, survivorId]])).rows;
    expect(rows.find((r) => r.id === retiredId)).toMatchObject({ status: "merged", merged_into_patient_id: survivorId });
    expect(rows.find((r) => r.id === survivorId)).toMatchObject({ status: "active", merged_into_patient_id: null });
    // Nothing filed under the duplicate moved.
    expect((await q(`SELECT patient_id FROM encounter WHERE id = $1`, [ids.encounter])).rows[0].patient_id).toBe(retiredId);
    expect((await q(`SELECT patient_id FROM lab_result WHERE id = $1`, [ids.result])).rows[0].patient_id).toBe(retiredId);
    // The account now belongs to the survivor; its sessions were revoked.
    expect((await q(`SELECT patient_id, status FROM patient_portal_account WHERE email = 'juan@merge.ph'`)).rows[0]).toEqual({
      patient_id: survivorId,
      status: "active",
    });
    await portal("/results", sessionBefore).expect(401);

    const audit = await auditRows(ctx.pool, "action = 'patient.merge' AND patient_id = ANY($1)", [[retiredId, survivorId]]);
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.reason === "Same person registered twice" && a.metadata?.["retiredPatientId"] === retiredId)).toBe(true);
    const events = (await q(`SELECT event_type, aggregate_id, payload FROM domain_event WHERE event_type = 'PatientMerged'`)).rows;
    expect(events).toEqual([expect.objectContaining({ aggregate_id: retiredId, payload: expect.objectContaining({ survivorPatientId: survivorId }) })]);
    expect(JSON.stringify(events)).not.toMatch(/Dela Cruz|Penicillin/);
    const history = (await api(records).get(`/patients/${survivorId}/merges`).expect(200)).body;
    expect(history).toEqual([
      expect.objectContaining({ action: "merged", retired: { id: retiredId, patientNumber: retiredNumber }, performedBy: expect.anything() }),
    ]);
  });

  it("shows the retired record read only with its survivor, and resolves its number, phone and identifier to the survivor", async () => {
    const detail = (await api(records).get(`/patients/${retiredId}`).expect(200)).body;
    expect(detail).toMatchObject({ status: "merged", mergedInto: expect.objectContaining({ id: survivorId, mergedAt: expect.any(String) }) });
    const survivor = (await api(records).get(`/patients/${survivorId}`).expect(200)).body;
    expect(survivor.mergedRecords).toEqual([expect.objectContaining({ id: retiredId, patientNumber: retiredNumber })]);

    for (const query of [`q=${retiredNumber}`, "q=09187654321", `identifierType=philsys_number&identifierValue=${encodeURIComponent("1234-5678-9012-3456")}`]) {
      const found = (await api(records).get(`/patients?${query}`).expect(200)).body.items;
      expect(found).toEqual([expect.objectContaining({ id: survivorId, resolvedFrom: { id: retiredId, patientNumber: retiredNumber } })]);
    }
    // Registering someone with the duplicate's identifier finds the survivor.
    const again = await api(admin).post("/patients", {
      familyName: "Cruz",
      givenName: "Jon",
      sex: "male",
      birthDate: "1990-01-01",
      identifiers: [{ type: "philsys_number", value: "1234-5678-9012-3456" }],
    });
    expect(again.status).toBe(409);
    expect(again.body.error.details.candidates).toEqual([
      expect.objectContaining({
        level: "certain",
        patient: expect.objectContaining({ id: survivorId, resolvedFrom: expect.objectContaining({ id: retiredId }) }),
      }),
    ]);
  });

  it("refuses new care and record changes addressed to the retired record", async () => {
    const contact = await api(records).post(`/patients/${retiredId}/contacts`, { system: "mobile", value: "0917 000 0000" });
    expect(contact.status).toBe(422);
    expect(contact.body.error).toMatchObject({ code: "patient_merged", details: { survivorPatientId: survivorId } });
    const allergy = await api(doctor).post(`/patients/${retiredId}/allergies`, { category: "food", substance: "Shrimp" });
    expect(allergy.status).toBe(422);
    expect(allergy.body.error).toMatchObject({ code: "patient_merged", details: { survivorPatientId: survivorId } });
    const encounter = await api(doctor).post("/encounters", { patientId: retiredId });
    expect(encounter.status).toBe(422);
    expect(encounter.body.error.code).toBe("patient_merged");
    const upload = await api(records).post("/documents", {
      patientId: retiredId,
      category: "other",
      title: "Scan",
      fileName: "scan.pdf",
      contentType: "application/pdf",
      sizeBytes: 1000,
    });
    expect(upload.status).toBe(422);
    expect(upload.body.error.code).toBe("patient_merged");
  });

  it("reads the retired record's care with the survivor, marked with the number it was filed under", async () => {
    const summary = (await api(doctor).get(`/patients/${survivorId}/summary`).expect(200)).body;
    expect(summary.allergies).toMatchObject({
      status: "has_allergies",
      allergies: [expect.objectContaining({ substance: "Penicillin", patientId: retiredId })],
    });
    expect(summary.linkedRecords).toEqual([{ id: retiredId, patientNumber: retiredNumber }]);
    // The allergy check for prescribing sees it too.
    const allergies = (await api(doctor).get(`/patients/${survivorId}/allergies`).expect(200)).body;
    expect(allergies.allergies.map((a: { substance: string }) => a.substance)).toEqual(["Penicillin"]);

    const results = (await api(doctor).get(`/laboratory/patients/${survivorId}/results`).expect(200)).body;
    expect(results).toEqual([expect.objectContaining({ testName: "FBS", patientId: retiredId })]);

    const timeline = (await api(doctor).get(`/patients/${survivorId}/timeline`).expect(200)).body;
    const encounterEntry = timeline.items.find((i: { id: string }) => i.id === `encounter:${ids.encounter}`);
    expect(encounterEntry).toMatchObject({ filedUnder: retiredNumber });
    expect(timeline.items.some((i: { kind: string; filedUnder: string | null }) => i.kind === "lab_result_release" && i.filedUnder === retiredNumber)).toBe(
      true,
    );

    const workspace = (await api(doctor).get(`/patients/${survivorId}/workspace`).expect(200)).body;
    expect(workspace.encounterHistory).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.encounter, filedUnder: retiredNumber })]));
    expect(workspace.linkedRecords).toEqual([{ id: retiredId, patientNumber: retiredNumber }]);
  });

  it("exports the linked record over FHIR: the survivor replaces the retired Patient, $everything includes its care", async () => {
    const survivor = (await api(admin).get(`/fhir/r4/Patient/${survivorId}`).expect(200)).body;
    expect(survivor.link).toEqual([{ other: { reference: `Patient/${retiredId}` }, type: "replaces" }]);
    const retired = (await api(admin).get(`/fhir/r4/Patient/${retiredId}`).expect(200)).body;
    expect(retired).toMatchObject({ active: false, link: [{ other: { reference: `Patient/${survivorId}` }, type: "replaced-by" }] });
    const everything = (await api(admin).get(`/fhir/r4/Patient/${survivorId}/$everything`).expect(200)).body;
    const types = everything.entry.map((e: { resource: { resourceType: string; id: string } }) => `${e.resource.resourceType}/${e.resource.id}`);
    expect(types).toEqual(expect.arrayContaining([`Encounter/${ids.encounter}`]));
    expect(everything.entry.some((e: { resource: { resourceType: string } }) => e.resource.resourceType === "AllergyIntolerance")).toBe(true);
  });

  it("gives the survivor's MyHealth account the retired record's released results", async () => {
    const token = await portalLogin();
    const results = (await portal("/results", token).expect(200)).body;
    expect(results).toEqual([expect.objectContaining({ testName: "FBS", valueNumeric: 6.1 })]);
  });

  it("computes the billing account across linked ledgers", async () => {
    // A deposit left on the duplicate would block a merge; one released onto it later (e.g. a void) still counts.
    await q(
      `INSERT INTO billing_account_entry (organization_id, facility_id, patient_id, kind, amount, method, receipt_number, idempotency_key, recorded_by)
       SELECT $1, $2, $3, 'deposit', 50000, 'cash', 'AR-MERGE-1', 'merge-dep-0001', id FROM app_user WHERE email = 'admin@merge.ph'`,
      [tenant.organizationId, tenant.facilityId, retiredId],
    );
    await api(admin).post(`/billing/patients/${survivorId}/deposits`, { amount: 20_000, method: "cash", idempotencyKey: "merge-dep-0002" }).expect(201);
    const account = (await api(admin).get(`/billing/patients/${survivorId}/account`).expect(200)).body;
    expect(account.balance).toBe(70_000);
    expect(account.entries).toHaveLength(2);
  });

  it("keeps chains flat when a survivor is itself merged, and unmerges exactly", async () => {
    // The survivor (with the duplicate merged into it) is merged into a third record: the duplicate follows.
    const view = await preview(survivorId, thirdId);
    expect(view.repointed).toEqual([expect.objectContaining({ id: retiredId })]);
    // A record that is itself merged cannot survive.
    expect((await preview(thirdId, retiredId)).ineligibility).toMatchObject({ code: "survivor_merged" });
    const body = {
      survivorPatientId: thirdId,
      reason: "Registered three times",
      retiredVersion: await version(survivorId),
      survivorVersion: await version(thirdId),
      acknowledgedDifferences: view.differences.map((d) => d.code),
    };
    const blocked = await api(records).post(`/patients/${survivorId}/merge`, body);
    // The survivor's own deposit is a blocker.
    expect(blocked.status).toBe(409);
    await api(admin)
      .post(`/billing/patients/${survivorId}/account-refunds`, {
        amount: 20_000,
        method: "cash",
        reason: "Returned before merge",
        idempotencyKey: "merge-ref-0001",
      })
      .expect(201);
    const merged = await api(records).post(`/patients/${survivorId}/merge`, body).expect(200);
    expect(merged.body.repointed).toEqual([retiredId]);
    const pointers = async () =>
      Object.fromEntries(
        (await q(`SELECT id, status, merged_into_patient_id FROM patient WHERE id = ANY($1)`, [[retiredId, survivorId, thirdId]])).rows.map((r) => [
          r.id,
          [r.status, r.merged_into_patient_id],
        ]),
      );
    expect(await pointers()).toEqual({ [retiredId]: ["merged", thirdId], [survivorId]: ["merged", thirdId], [thirdId]: ["active", null] });
    // The third record now reads both.
    const summary = (await api(doctor).get(`/patients/${thirdId}/summary`).expect(200)).body;
    expect(summary.allergies.allergies.map((a: { substance: string }) => a.substance)).toEqual(["Penicillin"]);
    // The database refuses a chain.
    await expect(q(`UPDATE patient SET merged_into_patient_id = $1 WHERE id = $2`, [survivorId, retiredId])).rejects.toThrow(/chains must stay flat/);

    // Unmerging the middle record restores it and brings the duplicate back under it; its MyHealth account stays on the
    // record it was moved to at the first merge only if that is still where it is.
    const unmerged = await api(records).post(`/patients/${survivorId}/unmerge`, { reason: "Merged by mistake" }).expect(200);
    expect(unmerged.body).toMatchObject({ restoredStatus: "active", repointed: [retiredId] });
    expect(await pointers()).toEqual({ [retiredId]: ["merged", survivorId], [survivorId]: ["active", null], [thirdId]: ["active", null] });

    // Unmerging the duplicate: its status comes back, the account moved at the merge goes back to it.
    const back = await api(records).post(`/patients/${retiredId}/unmerge`, { reason: "Different people after all" }).expect(200);
    expect(back.body).toMatchObject({ restoredStatus: "active", portalAccountReturned: true });
    expect(await pointers()).toEqual({ [retiredId]: ["active", null], [survivorId]: ["active", null], [thirdId]: ["active", null] });
    expect((await q(`SELECT patient_id FROM patient_portal_account WHERE email = 'juan@merge.ph'`)).rows[0].patient_id).toBe(retiredId);
    const summary2 = (await api(doctor).get(`/patients/${survivorId}/summary`).expect(200)).body;
    expect(summary2.allergies.status).not.toBe("has_allergies");
    expect(summary2.linkedRecords).toEqual([]);
    // Nothing more to undo.
    const again = await api(records).post(`/patients/${retiredId}/unmerge`, { reason: "Once more" });
    expect(again.status).toBe(422);
    expect(await auditRows(ctx.pool, "action = 'patient.unmerge'")).toHaveLength(4);
    expect((await q(`SELECT count(*)::int AS n FROM domain_event WHERE event_type = 'PatientUnmerged'`)).rows[0].n).toBe(2);
    // History is append-only.
    await expect(q(`UPDATE patient_merge SET reason = 'x'`)).rejects.toThrow(/append-only/);
  });
});
