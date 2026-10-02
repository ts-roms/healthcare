import { extractPdfText } from "@healthcare/pdf";
import {
  as,
  auditRows,
  binary,
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
  encounterId: string | null;
  visitId: string | null;
  consent: { capturedVia: string; givenBy: string; representativeName: string | null; wording: { version: number } | null; documentId: string | null } | null;
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

  // ---- consent, note templates and procedures outside a consultation (migration 0095) ---------------------------

  it("keeps the organization's own consent wording per procedure, versioned, and prints a form for a patient", async () => {
    const wording = { title: "Consent to suture repair", body: "I understand the procedure, its risks and alternatives, and I agree to it being performed." };
    await staff(doctor).post(`/clinic/procedure-definitions/${ids.suture}/consent-wordings`, wording).expect(403);
    await staff(admin).post(`/clinic/procedure-definitions/${ids.suture}/consent-wordings`, { title: "x", body: "short" }).expect(400);
    const v1 = await staff(admin).post(`/clinic/procedure-definitions/${ids.suture}/consent-wordings`, wording).expect(201);
    expect(v1.body).toMatchObject({ definitionId: ids.suture, version: 1, title: wording.title });
    const v2 = await staff(admin)
      .post(`/clinic/procedure-definitions/${ids.suture}/consent-wordings`, { ...wording, body: `${wording.body} Questions were answered.` })
      .expect(201);
    expect(v2.body.version).toBe(2);
    ids.wordingV1 = v1.body.id;
    ids.wordingV2 = v2.body.id;
    expect(
      (await staff(nurse).get(`/clinic/procedure-definitions/${ids.suture}/consent-wordings`).expect(200)).body.map((w: { version: number }) => w.version),
    ).toEqual([2, 1]);
    const catalogue = (await staff(nurse).get("/clinic/procedure-definitions").expect(200)).body as Array<{
      code: string;
      consentWording: { version: number } | null;
    }>;
    expect(catalogue.find((d) => d.code === "SUT-S")?.consentWording).toMatchObject({ version: 2 });
    expect(catalogue.find((d) => d.code === "NEB")?.consentWording).toBeNull();
    await expect(ctx.pool.query(`UPDATE clinic_procedure_consent_wording SET body = 'changed' WHERE id = $1`, [ids.wordingV1])).rejects.toThrow();

    // The printable form: letterhead, the patient, the procedure, the current wording and its version. Audited.
    await staff(nurse)
      .get(`/clinic/procedure-definitions/${ids.neb}/consent-form.pdf?patientId=${patientId}`)
      .expect(code(422, "consent_wording_not_published"));
    const pdf = await staff(nurse)
      .get(`/clinic/procedure-definitions/${ids.suture}/consent-form.pdf?patientId=${patientId}`)
      .buffer()
      .parse(binary)
      .expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const text = extractPdfText(pdf.body as Buffer);
    expect(text).toContain("Consent to suture repair");
    expect(text).toContain("Questions were answered");
    expect(text).toContain("DELA CRUZ, Juan");
    expect(text).toContain("Consent to suture repair, version 2");
    await staff(cashier).get(`/clinic/procedure-definitions/${ids.suture}/consent-form.pdf?patientId=${patientId}`).expect(403);
    expect(await auditRows(ctx.pool, "action = 'clinic.procedure-consent-form.print' AND patient_id = $1", [patientId])).toHaveLength(1);
  });

  it("requires consent with a procedure when the catalogue says so, and records how it was obtained", async () => {
    const current = (await staff(admin).get("/clinic/procedure-definitions?includeInactive=true").expect(200)).body as Array<{ id: string; version: number }>;
    const version = (id: string) => current.find((d) => d.id === id)!.version;
    const updated = await staff(admin)
      .patch(`/clinic/procedure-definitions/${ids.suture}`, { consentRequired: true, noteTemplate: "Anaesthetic:\nSutures:", version: version(ids.suture) })
      .expect(200);
    expect(updated.body).toMatchObject({ consentRequired: true, noteTemplate: "Anaesthetic:\nSutures:", allowedOutsideConsultation: false });

    const encounterId = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Laceration, right hand" }).expect(201)).body.id;
    ids.encounter2 = encounterId;
    const record = (body: object) => staff(doctor).post(`/encounters/${encounterId}/procedures`, body);
    const suture = { definitionId: ids.suture, bodySite: "right hand", notes: "Anaesthetic: lidocaine 2%\nSutures: 3" };
    await record(suture).expect(code(422, "procedure_consent_required"));
    await record({ ...suture, consent: { capturedVia: "paper", givenBy: "representative" } }).expect(400);
    await record({ ...suture, consent: { capturedVia: "electronic", wordingId: ids.neb } }).expect(code(422, "consent_wording_unknown"));
    await record({ ...suture, consent: { capturedVia: "paper", obtainedAt: new Date(Date.now() + 3_600_000).toISOString() } }).expect(
      code(422, "consent_after_procedure"),
    );
    // A scan must be a consent form of this patient.
    const other = await staff(admin)
      .post("/documents", {
        category: "clinical_attachment",
        title: "Not a consent",
        fileName: "x.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        patientId,
      })
      .expect(201);
    await record({ ...suture, consent: { capturedVia: "paper", documentId: other.body.document.id } }).expect(code(422, "document_not_consent_form"));
    const form = await staff(admin)
      .post("/documents", {
        category: "consent_form",
        title: "Signed consent",
        fileName: "consent.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        patientId,
      })
      .expect(201);
    const formId = form.body.document.id as string;
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [formId]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 100, contentType: "application/pdf" });
    await staff(admin).post(`/documents/${formId}/complete`).expect(200);

    const recorded = await record({
      ...suture,
      consent: {
        capturedVia: "electronic",
        givenBy: "representative",
        representativeName: "Maria Dela Cruz",
        representativeRelationship: "mother",
        documentId: formId,
        notes: "Explained in Filipino",
      },
    }).expect(201);
    expect(recorded.body.consent).toMatchObject({
      capturedVia: "electronic",
      givenBy: "representative",
      representativeName: "Maria Dela Cruz",
      wording: { version: 2 },
      documentId: formId,
      obtainedBy: { name: "Dr. doctor" },
    });
    expect(recorded.body.encounterId).toBe(encounterId);
    ids.consented = recorded.body.id;
    const audit = await auditRows(ctx.pool, "action = 'clinic.procedure-consent.record' AND patient_id = $1", [patientId]);
    expect(audit[0]).toMatchObject({ metadata: { procedureId: ids.consented, wordingVersion: 2, documentLinked: true } });
    expect(JSON.stringify(audit)).not.toMatch(/Maria|Filipino/);
    await expect(ctx.pool.query(`UPDATE clinic_procedure_consent SET notes = 'x' WHERE procedure_id = $1`, [ids.consented])).rejects.toThrow();

    // Consent added once to a procedure recorded without one (the nurse may: procedure.record).
    const neb = (await record({ definitionId: ids.neb })).body as Procedure;
    expect(neb.consent).toBeNull();
    await staff(cashier).post(`/procedures/${neb.id}/consent`, { capturedVia: "verbal" }).expect(403);
    const added = await staff(nurse).post(`/procedures/${neb.id}/consent`, { capturedVia: "verbal" }).expect(201);
    expect(added.body.consent).toMatchObject({ capturedVia: "verbal", givenBy: "patient", wording: null, obtainedBy: { name: "Dr. doctor" } });
    await staff(nurse).post(`/procedures/${neb.id}/consent`, { capturedVia: "verbal" }).expect(code(422, "consent_already_recorded"));
  });

  it("records a procedure under a queue visit without a consultation when the catalogue allows it (procedure.record)", async () => {
    const visitTypeId = (
      await staff(admin).post("/clinic/visit-types", { code: "nurse", name: "Nursing visit", defaultDurationMinutes: 10, requiresTriage: false }).expect(201)
    ).body.id;
    const visitId = (await staff(nurse).post("/queue/walk-ins", { patientId, visitTypeId, chiefComplaint: "Wound check" }).expect(201)).body.id as string;
    ids.visit = visitId;
    const record = (t: string, body: object) => staff(t).post(`/visits/${visitId}/procedures`, body);
    const dressing = { definitionId: ids.suture, bodySite: "right hand", consent: { capturedVia: "verbal" } };
    await record(cashier, dressing).expect(403);
    await record(nurse, dressing).expect(code(422, "procedure_requires_consultation"));
    const current = (await staff(admin).get("/clinic/procedure-definitions").expect(200)).body as Array<{ id: string; version: number }>;
    await staff(admin)
      .patch(`/clinic/procedure-definitions/${ids.suture}`, { allowedOutsideConsultation: true, version: current.find((d) => d.id === ids.suture)!.version })
      .expect(200);
    await record(nurse, { ...dressing, performedAt: "2020-01-01T00:00:00+08:00" }).expect(code(422, "performed_before_visit"));

    const done = await record(nurse, dressing).expect(201);
    expect(done.body).toMatchObject({
      encounterId: null,
      visitId,
      patientId,
      performer: { name: "Dr. nurse" },
      consent: { capturedVia: "verbal" },
      lateEntryReason: null,
    });
    ids.onVisit = done.body.id;
    expect((await staff(doctor).get(`/visits/${visitId}/procedures`).expect(200)).body.map((p: Procedure) => p.id)).toEqual([ids.onVisit]);
    await staff(cashier).get(`/visits/${visitId}/procedures`).expect(403);

    // Billed like any other, without a consultation.
    await drainEvents(ctx);
    const charges = (await staff(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200)).body as Array<Record<string, unknown>>;
    expect(charges.find((c) => c.sourceId === ids.onVisit)).toMatchObject({ sourceType: "clinic_procedure", quantity: 1, status: "pending" });

    // Never free-floating, and not once the visit is closed.
    await expect(ctx.pool.query(`UPDATE clinic_procedure SET visit_id = NULL WHERE id = $1`, [ids.onVisit])).rejects.toThrow();
    await ctx.pool.query(`UPDATE visit SET status = 'completed', completed_at = now() WHERE id = $1`, [visitId]);
    await record(nurse, dressing).expect(code(422, "visit_closed"));
  });

  it("shows procedures outside a consultation in the patient's list, the timeline, Patient 360, FHIR and the copy of the record", async () => {
    const listed = (await staff(doctor).get(`/patients/${patientId}/procedures`).expect(200)).body as Procedure[];
    expect(listed.find((p) => p.id === ids.onVisit)).toMatchObject({ encounterId: null, visitId: ids.visit });
    const timeline = await staff(doctor).get(`/patients/${patientId}/timeline?kinds=procedure`).expect(200);
    const row = (timeline.body.items as Array<{ detail: string; link: { type: string; id: string }; sourceIds: Record<string, unknown> }>).find(
      (r) => r.sourceIds.procedureId === ids.onVisit,
    );
    expect(row).toMatchObject({ detail: "SUT-S · outside a consultation", link: { type: "patient_record", id: patientId }, sourceIds: { visitId: ids.visit } });
    const workspace = await staff(doctor).get(`/patients/${patientId}/workspace`).expect(200);
    expect(workspace.body.procedures.find((p: { id: string }) => p.id === ids.onVisit)).toMatchObject({ encounterId: null, visitId: ids.visit });
    const fhir = await ctx.http().get(`/api/v1/fhir/r4/Procedure?patient=${patientId}`).set(as(admin, tenant.facilityId)).expect(200);
    const resource = (fhir.body.entry as Array<{ resource: { id: string; encounter?: unknown; status: string } }>)
      .map((e) => e.resource)
      .find((r) => r.id === ids.onVisit);
    expect(resource).toMatchObject({ status: "completed" });
    expect(resource).not.toHaveProperty("encounter");
  });
});
