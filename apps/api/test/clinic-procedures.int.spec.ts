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

interface Procedure {
  id: string;
  patientId: string;
  encounterId: string;
  code: string;
  name: string;
  description: string;
  quantity: number;
  bodySite: string | null;
  performer: { id: string; name: string };
  lateEntryReason: string | null;
  enteredInError: { reason: string } | null;
  recordedByName: string | null;
}

/**
 * Procedures performed at the clinic (docs/domains/clinic.md, "Procedures"): the organization's own catalogue;
 * procedures recorded in an in-person consultation (a signed one needs encounter.amend and a reason); charged by
 * billing through a mapped service and cancelled when entered in error; immutable in the database; in the timeline,
 * Patient 360 and FHIR.
 */
describe("clinic procedures", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let cashier: string;
  let outsider: string;
  let patientId: string;
  let nursePractitionerId: string;
  const ids: Record<string, string> = {};

  const staff = (t: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
  });
  const events = async (type: string) =>
    (await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = $1 AND organization_id = $2`, [type, tenant.organizationId])).rows.map(
      (r) => r.payload as Record<string, unknown>,
    );
  const code = (status: number, expected: string) => (r: { status: number; body: { error?: { code?: string } } }) => {
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(expected);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "proc-org");
    const other = await createTenant(ctx.pool, "proc-other");
    await createStaff(ctx.pool, tenant, "admin@proc.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@proc.ph", ["physician"]);
    nursePractitionerId = (await createClinician(ctx, tenant, "nurse@proc.ph", ["nurse"], "nurse")).practitionerId;
    await createStaff(ctx.pool, tenant, "cashier@proc.ph", ["cashier"]);
    await createStaff(ctx.pool, other, "admin@proc-other.ph", ["org_admin"]);
    [admin, doctor, nurse, cashier] = await Promise.all(
      ["admin", "doctor", "nurse", "cashier"].map(async (u) => (await login(ctx, `${u}@proc.ph`)).accessToken),
    );
    outsider = (await login(ctx, "admin@proc-other.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    ids.encounter = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Laceration, left forearm" }).expect(201)).body.id;
    // A billing service mapped to the suture repair; the nebulization is not charged automatically.
    await staff(admin)
      .post("/billing/services", {
        code: "SUT",
        name: "Suture repair, simple",
        category: "procedure",
        sourceKind: "clinic_procedure",
        sourceCode: "SUT-S",
        unitPrice: 50_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(201);
  });
  afterAll(() => ctx.close());

  it("keeps the organization's own procedure catalogue (clinic.configure), readable by clinical staff", async () => {
    const suture = { code: "SUT-S", name: "Suture repair, simple", codeSystem: "rvs", externalCode: "12001", requiresBodySite: true };
    await staff(doctor).post("/clinic/procedure-definitions", suture).expect(403);
    await staff(admin)
      .post("/clinic/procedure-definitions", { ...suture, externalCode: undefined })
      .expect(400);
    const created = await staff(admin).post("/clinic/procedure-definitions", suture).expect(201);
    expect(created.body).toMatchObject({ code: "SUT-S", codeSystem: "rvs", externalCode: "12001", requiresBodySite: true, status: "active", version: 1 });
    ids.suture = created.body.id;
    await staff(admin).post("/clinic/procedure-definitions", { code: "sut-s", name: "Another" }).expect(code(422, "procedure_exists"));
    ids.neb = (await staff(admin).post("/clinic/procedure-definitions", { code: "NEB", name: "Nebulization" }).expect(201)).body.id;
    ids.old = (await staff(admin).post("/clinic/procedure-definitions", { code: "OLD", name: "Retired procedure" }).expect(201)).body.id;
    await staff(admin).patch(`/clinic/procedure-definitions/${ids.old}`, { status: "inactive", version: 1 }).expect(200);
    await staff(admin).patch(`/clinic/procedure-definitions/${ids.old}`, { name: "x y", version: 1 }).expect(409);

    expect((await staff(nurse).get("/clinic/procedure-definitions").expect(200)).body.map((d: { code: string }) => d.code)).toEqual(["NEB", "SUT-S"]);
    expect((await staff(nurse).get("/clinic/procedure-definitions?includeInactive=true").expect(200)).body).toHaveLength(3);
    await staff(cashier).get("/clinic/procedure-definitions").expect(403);
    expect((await ctx.http().get("/api/v1/clinic/procedure-definitions").set(as(outsider)).expect(200)).body).toEqual([]);
  });

  it("records procedures in an in-person consultation, with who performed them", async () => {
    const record = (t: string, body: object, encounterId = ids.encounter) => staff(t).post(`/encounters/${encounterId}/procedures`, body);
    await record(nurse, { definitionId: ids.neb }).expect(403);
    await record(cashier, { definitionId: ids.neb }).expect(403);
    await record(doctor, { definitionId: ids.suture }).expect(code(422, "body_site_required"));
    await record(doctor, { definitionId: ids.old }).expect(code(422, "procedure_inactive"));
    await record(doctor, { definitionId: ids.neb, quantity: 100 }).expect(400);
    await record(doctor, { definitionId: ids.neb, performedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(code(422, "performed_in_future"));
    await record(doctor, { definitionId: ids.neb, performedAt: "2020-01-01T00:00:00+08:00" }).expect(code(422, "performed_before_encounter"));

    const sutured = await record(doctor, { definitionId: ids.suture, bodySite: "left forearm", quantity: 2, notes: "3 cm laceration, 4 sutures each" }).expect(
      201,
    );
    expect(sutured.body).toMatchObject({
      patientId,
      code: "SUT-S",
      name: "Suture repair, simple",
      description: "Suture repair, simple × 2 (left forearm)",
      quantity: 2,
      performer: { name: "Dr. doctor" },
      lateEntryReason: null,
      enteredInError: null,
      recordedByName: expect.any(String),
    });
    ids.sutured = sutured.body.id;
    // The nurse performed the nebulization; the physician records it and names her.
    const neb = await record(doctor, { definitionId: ids.neb, performerPractitionerId: nursePractitionerId }).expect(201);
    expect(neb.body.performer).toEqual({ id: nursePractitionerId, name: "Dr. nurse" });
    ids.neb1 = neb.body.id;

    // Not in an online consultation.
    const online = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Follow-up call" }).expect(201)).body.id;
    await ctx.pool.query(`UPDATE encounter SET modality = 'telemedicine' WHERE id = $1`, [online]);
    await record(doctor, { definitionId: ids.neb }, online).expect(code(422, "encounter_online"));

    const listed = (await staff(nurse).get(`/encounters/${ids.encounter}/procedures`).expect(200)).body as Procedure[];
    expect(listed.map((p) => p.id).sort()).toEqual([ids.sutured, ids.neb1].sort());
    expect((await staff(doctor).get(`/patients/${patientId}/procedures`).expect(200)).body).toHaveLength(2);
    await staff(cashier).get(`/patients/${patientId}/procedures`).expect(403);
    expect(await events("ClinicProcedurePerformed")).toHaveLength(2);
    expect(JSON.stringify(await events("ClinicProcedurePerformed"))).not.toMatch(/laceration|forearm/i);
  });

  it("charges a mapped procedure by its quantity, and cancels the charge when it is entered in error", async () => {
    await drainEvents(ctx);
    const charges = (await staff(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200)).body as Array<Record<string, unknown>>;
    const procedureCharges = charges.filter((c) => c.sourceType === "clinic_procedure");
    expect(procedureCharges).toEqual([
      expect.objectContaining({
        sourceId: ids.sutured,
        description: "Suture repair, simple × 2 (left forearm)",
        quantity: 2,
        unitPrice: 50_000,
        status: "pending",
      }),
    ]);

    await staff(nurse).post(`/procedures/${ids.sutured}/entered-in-error`, { reason: "Wrong patient" }).expect(403);
    await staff(doctor).post(`/procedures/${ids.sutured}/entered-in-error`, { reason: "x" }).expect(400);
    const marked = await staff(doctor).post(`/procedures/${ids.sutured}/entered-in-error`, { reason: "Recorded on the wrong consultation" }).expect(200);
    expect(marked.body.enteredInError).toMatchObject({ reason: "Recorded on the wrong consultation" });
    await staff(doctor).post(`/procedures/${ids.sutured}/entered-in-error`, { reason: "Again" }).expect(code(422, "already_entered_in_error"));
    await drainEvents(ctx);
    const after = (await staff(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200)).body as Array<Record<string, unknown>>;
    expect(after.find((c) => c.sourceId === ids.sutured)).toMatchObject({ status: "cancelled", cancelReason: "Procedure entered in error" });
  });

  it("records after signing only with permission to amend and a reason", async () => {
    await staff(doctor).put(`/encounters/${ids.encounter}/note`, { assessment: "Laceration repaired", plan: "Wound care", basedOnRevision: 0 }).expect(200);
    const current = await staff(doctor).get(`/encounters/${ids.encounter}`).expect(200);
    await staff(doctor).post(`/encounters/${ids.encounter}/sign`, { version: current.body.version }).expect(200);

    await staff(doctor).post(`/encounters/${ids.encounter}/procedures`, { definitionId: ids.neb }).expect(code(422, "late_entry_reason_required"));
    const late = await staff(doctor)
      .post(`/encounters/${ids.encounter}/procedures`, { definitionId: ids.neb, lateEntryReason: "Second nebulization not recorded before signing" })
      .expect(201);
    expect(late.body.lateEntryReason).toBe("Second nebulization not recorded before signing");
    const audit = await auditRows(ctx.pool, "action = 'encounter.procedure.record' AND resource_id = $1", [late.body.id]);
    expect(audit[0]).toMatchObject({ patient_id: patientId, reason: "Second nebulization not recorded before signing", metadata: { lateEntry: true } });
  });

  it("keeps records immutable in the database", async () => {
    await expect(ctx.pool.query(`UPDATE clinic_procedure SET quantity = 3 WHERE id = $1`, [ids.neb1])).rejects.toThrow(/only marking entered in error/);
    await expect(ctx.pool.query(`DELETE FROM clinic_procedure WHERE id = $1`, [ids.neb1])).rejects.toThrow(/never deleted/);
    await expect(ctx.pool.query(`UPDATE clinic_procedure SET entered_in_error_reason = 'changed' WHERE id = $1`, [ids.sutured])).rejects.toThrow(
      /only marking entered in error/,
    );
  });

  it("shows procedures in the timeline, Patient 360 and FHIR", async () => {
    const timeline = await staff(doctor).get(`/patients/${patientId}/timeline?kinds=procedure`).expect(200);
    const rows = timeline.body.items as Array<{ title: string; marker: string | null; link: { type: string; id: string } }>;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.title.includes("Suture"))).toMatchObject({ marker: "entered_in_error", link: { type: "encounter", id: ids.encounter } });
    expect(JSON.stringify(rows)).not.toMatch(/4 sutures/);

    const workspace = await staff(doctor).get(`/patients/${patientId}/workspace`).expect(200);
    expect(workspace.body.procedures.map((p: { description: string }) => p.description)).toEqual(["Nebulization", "Nebulization"]);

    const fhir = await ctx.http().get(`/api/v1/fhir/r4/Procedure?patient=${patientId}`).set(as(admin, tenant.facilityId)).expect(200);
    const procedures = (fhir.body.entry ?? []).map((e: { resource: Record<string, unknown> }) => e.resource) as Array<{
      id: string;
      status: string;
      code: { coding: Array<{ code: string }> };
      category: { coding: Array<{ code: string }> };
    }>;
    const suture = procedures.find((p) => p.id === ids.sutured);
    expect(suture).toMatchObject({ status: "entered-in-error", category: { coding: [{ code: "clinic-procedure" }] } });
    expect(suture?.code.coding.map((c) => c.code)).toEqual(["SUT-S", "12001"]);
    expect(JSON.stringify(procedures)).not.toMatch(/4 sutures/);
  });
});
