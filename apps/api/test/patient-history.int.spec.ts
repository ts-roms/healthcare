import { randomBytes, randomUUID } from "node:crypto";
import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();
function schemaErrors(resource: { resourceType: string }): unknown[] {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource) ? [] : (validate.errors ?? []);
}

const PASSWORD = "Kasaysayan-ng-kalusugan-2026";
const ORG = "hist-org";
const KEY = randomBytes(32).toString("base64");

interface History {
  patientId: string;
  sensitiveAccess: boolean;
  procedures: Array<{ id: string; patientId: string; description: string; performed: string | null; source: string; enteredInError: object | null }>;
  conditions: Array<{ id: string; description: string; onset: string | null; status: string }>;
  medications: Array<{
    id: string;
    medication: string;
    dose: string | null;
    started: string | null;
    reportedStatus: string;
    status: string;
    stopped: string | null;
    stopRecorded: { at: string; byName: string | null; note: string | null } | null;
    enteredInError: object | null;
  }>;
  family: {
    state: string;
    latestReview: { outcome: string; unknownReason: string | null } | null;
    entries: Array<{ id: string; relative: string; condition: string; deceased: boolean | null; causeOfDeath: string | null; source: string }>;
  };
  social: {
    current: Record<string, unknown> & { id: string; substanceUse: string | null; sexualHistory: string | null; sensitiveWithheld: boolean };
    versions: Array<{ id: string; current: boolean; enteredInError: object | null }>;
  };
}

/**
 * Patient history (docs/domains/patient-history.md): past procedures and conditions as reported or documented here,
 * family history with its review state, social history versions with sensitive parts withheld from users without
 * encounter.write; immutable rows corrected by entered in error; merged records; Patient 360, FHIR export and
 * import, MyHealth (the patient, and a guardian acting for them) and the copy of the record.
 */
describe("patient history", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let cashier: string;
  let officer: string;
  let outsider: string;
  let integration: string;
  let patientId: string;
  let otherPatientId: string;
  let guardianId: string;
  let encounterId: string;
  let otherEncounterId: string;
  const ids: Record<string, string> = {};

  const staff = (t: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
  });
  const portal = (token: string, actingFor?: string) => ({
    get: (url: string) => {
      const r = ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`);
      return actingFor ? r.set("X-Acting-For", actingFor) : r;
    },
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const read = async (t = doctor, id = patientId): Promise<History> => (await staff(t).get(`/patients/${id}/history`).expect(200)).body;
  const events = async (type: string) =>
    (await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = $1 AND organization_id = $2`, [type, tenant.organizationId])).rows.map(
      (r) => r.payload as Record<string, unknown>,
    );
  async function register(body: object): Promise<string> {
    const id = (await staff(admin).post("/patients", body).expect(201)).body.id as string;
    await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    return id;
  }
  async function activate(id: string, email: string): Promise<string> {
    const code = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    return (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp({}, { INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ k1: KEY }), INTEGRATION_PAYLOAD_KEY_ID: "k1" });
    tenant = await createTenant(ctx.pool, ORG);
    const other = await createTenant(ctx.pool, "hist-other");
    await createStaff(ctx.pool, tenant, "admin@hist.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@hist.ph", ["physician"]);
    await createClinician(ctx, tenant, "nurse@hist.ph", ["nurse"], "nurse");
    await createStaff(ctx.pool, tenant, "cashier@hist.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "records@hist.ph", ["records_officer"]);
    await createStaff(ctx.pool, other, "admin@hist-other.ph", ["org_admin"]);
    // An integration account that may read FHIR but not the sensitive parts of the social history.
    const integrationUser = await createStaff(ctx.pool, tenant, "integration@hist.ph", []);
    const role = await ctx.pool.query(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'fhir_reader', 'FHIR reader') RETURNING id`, [
      tenant.organizationId,
    ]);
    await ctx.pool.query(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'interop.fhir.read'), ($1, 'history.read')`, [role.rows[0].id]);
    await ctx.pool.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      tenant.organizationId,
      integrationUser,
      role.rows[0].id,
    ]);
    [admin, doctor, nurse, cashier, officer, integration] = await Promise.all(
      ["admin", "doctor", "nurse", "cashier", "records", "integration"].map(async (u) => (await login(ctx, `${u}@hist.ph`)).accessToken),
    );
    outsider = (await login(ctx, "admin@hist-other.ph")).accessToken;
    patientId = await register(juan);
    otherPatientId = (
      await staff(admin)
        .post("/patients", {
          familyName: "Reyes",
          givenName: "Maria",
          sex: "female",
          birthDate: "1992-07-15",
          contacts: [{ system: "mobile", value: "0918 111 2222" }],
        })
        .expect(201)
    ).body.id;
    guardianId = await register({
      familyName: "Dela Cruz",
      givenName: "Rosa",
      sex: "female",
      birthDate: "1955-02-01",
      contacts: [{ system: "mobile", value: "0917 222 3333" }],
    });
    encounterId = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "New patient check-up" }).expect(201)).body.id;
    otherEncounterId = (await staff(doctor).post("/encounters", { patientId: otherPatientId, chiefComplaint: "Cough" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("records past procedures and conditions as reported or documented here, at the precision known", async () => {
    const appendectomy = { description: "Appendectomy", performed: "2010", reportedBy: "patient", performer: "Provincial Hospital", encounterId };
    await staff(cashier).post(`/patients/${patientId}/history/procedures`, appendectomy).expect(403);
    await staff(officer).post(`/patients/${patientId}/history/procedures`, appendectomy).expect(403);
    await staff(nurse).post(`/patients/${patientId}/history/procedures`, { description: "Appendectomy" }).expect(400);
    expect(
      (
        await staff(nurse)
          .post(`/patients/${patientId}/history/procedures`, { ...appendectomy, performed: `${Number(manilaDate(0).slice(0, 4)) + 1}` })
          .expect(422)
      ).body.error.code,
    ).toBe("date_in_future");
    expect(
      (
        await staff(nurse)
          .post(`/patients/${patientId}/history/procedures`, { ...appendectomy, encounterId: otherEncounterId })
          .expect(422)
      ).body.error.code,
    ).toBe("encounter_other_patient");
    const created = (await staff(nurse).post(`/patients/${patientId}/history/procedures`, appendectomy).expect(201)).body;
    expect(created).toMatchObject({ description: "Appendectomy", performed: "2010", performedPrecision: "year", source: "reported", reportedBy: "patient" });
    ids.appendectomy = created.id;
    ids.cholecystectomy = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/procedures`, {
          description: "Laparoscopic cholecystectomy",
          codeSystem: "procedure",
          code: "LAP-CHOLE",
          performed: "2018-11",
          source: "recorded_here",
          sourceDescription: "Discharge summary the patient brought",
          bodySite: "Abdomen",
        })
        .expect(201)
    ).body.id;
    ids.wrong = (
      await staff(nurse).post(`/patients/${patientId}/history/procedures`, { description: "Tonsillectomy", reportedBy: "relative" }).expect(201)
    ).body.id;

    const condition = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/conditions`, {
          description: "Pulmonary tuberculosis",
          onset: "2015-03",
          status: "resolved",
          diagnosedBy: "Rural health unit",
          reportedBy: "patient",
        })
        .expect(201)
    ).body;
    expect(condition).toMatchObject({ onset: "2015-03", onsetPrecision: "month", status: "resolved" });
    ids.tb = condition.id;
    // A reported condition is never a diagnosis of the organization (no problem list entry, no DOH detection).
    const diagnoses = await ctx.pool.query(`SELECT count(*)::int AS n FROM diagnosis WHERE patient_id = $1`, [patientId]);
    expect(diagnoses.rows[0].n).toBe(0);

    const history = await read();
    expect(history.procedures.map((p) => p.id)).toEqual([ids.cholecystectomy, ids.appendectomy, ids.wrong]);
    expect(history.conditions).toEqual([expect.objectContaining({ id: ids.tb, description: "Pulmonary tuberculosis" })]);
    expect(await auditRows(ctx.pool, "action = 'history.record' AND patient_id = $1", [patientId])).toHaveLength(4);
    const recorded = await events("PatientHistoryRecorded");
    expect(recorded).toHaveLength(4);
    for (const payload of recorded) expect(Object.keys(payload).sort()).toEqual(["entryId", "section"]);
  });

  it("says the family history is not recorded until asked, none known only after a review, and records relatives' conditions", async () => {
    expect((await read()).family).toMatchObject({ state: "not_recorded", latestReview: null, entries: [] });
    expect((await staff(nurse).post(`/patients/${patientId}/history/family/review`, { outcome: "reviewed" }).expect(422)).body.error.code).toBe(
      "family_review_conflict",
    );
    await staff(nurse).post(`/patients/${patientId}/history/family/review`, { outcome: "unknown" }).expect(400);
    await staff(nurse).post(`/patients/${patientId}/history/family/review`, { outcome: "none_known", encounterId }).expect(200);
    expect((await read()).family.state).toBe("none_known");

    await staff(nurse).post(`/patients/${patientId}/history/family`, { relationship: "other", condition: "Asthma" }).expect(400);
    await staff(nurse).post(`/patients/${patientId}/history/family`, { relationship: "mother", condition: "Asthma", causeOfDeath: "Asthma" }).expect(400);
    const father = (
      await staff(nurse)
        .post(`/patients/${patientId}/history/family`, {
          relationship: "father",
          condition: "Type 2 diabetes",
          onsetAge: 45,
          deceased: true,
          causeOfDeath: "Stroke",
        })
        .expect(201)
    ).body;
    expect(father).toMatchObject({ relative: "Father", deceased: true, causeOfDeath: "Stroke", source: "reported", reportedBy: "patient" });
    ids.father = father.id;
    ids.sister = (
      await staff(nurse)
        .post(`/patients/${patientId}/history/family`, { relationship: "sister", relationshipText: "older", condition: "Breast cancer", onsetAge: 38 })
        .expect(201)
    ).body.id;
    expect((await read()).family.state).toBe("recorded");
    expect((await staff(nurse).post(`/patients/${patientId}/history/family/review`, { outcome: "none_known" }).expect(422)).body.error.code).toBe(
      "family_review_conflict",
    );
    await staff(nurse).post(`/patients/${patientId}/history/family/review`, { outcome: "reviewed" }).expect(200);
    const family = (await read()).family;
    expect(family.latestReview).toMatchObject({ outcome: "reviewed" });
    expect(family.entries.map((e) => e.relative).sort()).toEqual(["Father", "Sister (older)"]);

    // The other patient does not know their family history (adopted).
    await staff(nurse).post(`/patients/${otherPatientId}/history/family/review`, { outcome: "unknown", unknownReason: "adopted" }).expect(200);
    expect((await read(nurse, otherPatientId)).family).toMatchObject({ state: "unknown", latestReview: { unknownReason: "adopted" } });
  });

  it("keeps the social history as versions; sensitive parts only for users who also hold encounter.write", async () => {
    await staff(nurse).post(`/patients/${patientId}/history/social`, { tobaccoStatus: "current" }).expect(400);
    await staff(nurse).post(`/patients/${patientId}/history/social`, { basedOn: null }).expect(422);
    expect((await staff(nurse).post(`/patients/${patientId}/history/social`, { basedOn: null, substanceUse: "Denies" }).expect(403)).body.error.code).toBe(
      "forbidden",
    );
    const first = (
      await staff(nurse)
        .post(`/patients/${patientId}/history/social`, {
          basedOn: null,
          tobaccoStatus: "current",
          tobaccoType: "Cigarettes",
          tobaccoAmount: "10 sticks a day",
          alcoholStatus: "current",
          alcoholFrequency: "Weekends",
          occupation: "Jeepney driver",
          encounterId,
        })
        .expect(201)
    ).body;
    expect(first).toMatchObject({ current: true, supersedesId: null, effectiveDate: manilaDate(0), sensitiveWithheld: true });
    ids.social1 = first.id;
    expect((await staff(doctor).post(`/patients/${patientId}/history/social`, { basedOn: null, occupation: "Farmer" }).expect(409)).body.error.code).toBe(
      "social_history_changed",
    );
    expect(
      (await staff(doctor).post(`/patients/${patientId}/history/social`, { basedOn: ids.social1, tobaccoStatus: "former", tobaccoQuitYear: 2100 }).expect(422))
        .body.error.code,
    ).toBe("quit_year_in_future");
    expect(
      (await staff(doctor).post(`/patients/${patientId}/history/social`, { basedOn: ids.social1, occupation: "Jeepney driver" }).expect(422)).body.error.code,
    ).toBe("social_history_unchanged");
    expect(
      (
        await staff(doctor)
          .post(`/patients/${patientId}/history/social`, { basedOn: ids.social1, effectiveDate: manilaDate(-3), diet: "Rice" })
          .expect(422)
      ).body.error.code,
    ).toBe("effective_date_before_current");
    const second = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/social`, {
          basedOn: ids.social1,
          tobaccoStatus: "former",
          tobaccoQuitYear: 2025,
          substanceUse: "Cannabis in college, none since",
          sexualHistory: "One partner",
        })
        .expect(201)
    ).body;
    expect(second).toMatchObject({
      supersedesId: ids.social1,
      tobaccoStatus: "former",
      tobaccoType: "Cigarettes",
      tobaccoQuitYear: 2025,
      occupation: "Jeepney driver",
      substanceUse: "Cannabis in college, none since",
      sensitiveWithheld: false,
    });
    ids.social2 = second.id;

    // The nurse and the records office see the rest, never the sensitive parts nor whether any are recorded.
    for (const t of [nurse, officer]) {
      const seen = await read(t);
      expect(seen.sensitiveAccess).toBe(false);
      expect(seen.social.current).toMatchObject({ id: ids.social2, substanceUse: null, sexualHistory: null, sensitiveWithheld: true, tobaccoStatus: "former" });
      expect(JSON.stringify(seen)).not.toMatch(/Cannabis|One partner/);
    }
    // A new version by the nurse carries the sensitive parts over unchanged.
    ids.social3 = (await staff(nurse).post(`/patients/${patientId}/history/social`, { basedOn: ids.social2, occupation: "Farmer" }).expect(201)).body.id;
    const forDoctor = await read();
    expect(forDoctor.sensitiveAccess).toBe(true);
    expect(forDoctor.social.current).toMatchObject({
      id: ids.social3,
      occupation: "Farmer",
      substanceUse: "Cannabis in college, none since",
      sexualHistory: "One partner",
    });
    expect(forDoctor.social.versions.map((v) => v.id)).toEqual([ids.social3, ids.social2, ids.social1]);
    // Audited by field names, never values.
    const audits = await auditRows(ctx.pool, "action = 'history.record' AND patient_id = $1 AND metadata->>'section' = 'social'", [patientId]);
    expect(audits).toHaveLength(3);
    expect(audits[1]!.metadata).toMatchObject({ changedFields: expect.arrayContaining(["substanceUse", "sexualHistory", "tobaccoStatus"]) });
    expect(JSON.stringify(audits)).not.toMatch(/Cannabis|One partner|Farmer/);
    const views = await auditRows(ctx.pool, "action = 'history.view' AND patient_id = $1", [patientId]);
    expect(views.some((v) => v.metadata?.["sensitiveShown"] === false)).toBe(true);
  });

  it("corrects by entered in error (never edits or deletes), organization-scoped", async () => {
    await staff(cashier).post(`/history/${ids.wrong}/entered-in-error`, { reason: "Wrong patient" }).expect(403);
    const elsewhere = {
      get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(outsider)),
      post: (url: string, body: object) => ctx.http().post(`/api/v1${url}`).set(as(outsider)).send(body),
    };
    await elsewhere.post(`/history/${ids.wrong}/entered-in-error`, { reason: "Wrong patient" }).expect(404);
    await elsewhere.get(`/patients/${patientId}/history`).expect(404);
    await elsewhere.post(`/patients/${patientId}/history/procedures`, { description: "X", reportedBy: "patient" }).expect(404);
    await staff(nurse).post(`/history/${ids.wrong}/entered-in-error`, { reason: "x" }).expect(400);
    const marked = (await staff(nurse).post(`/history/${ids.wrong}/entered-in-error`, { reason: "Told about another patient" }).expect(200)).body;
    expect(marked).toMatchObject({ section: "procedure", enteredInError: { reason: "Told about another patient" } });
    expect((await staff(nurse).post(`/history/${ids.wrong}/entered-in-error`, { reason: "Again" }).expect(422)).body.error.code).toBe(
      "already_entered_in_error",
    );
    await expect(ctx.pool.query(`UPDATE past_procedure SET description = 'Changed' WHERE id = $1`, [ids.appendectomy])).rejects.toThrow(
      /only marking entered in error/,
    );
    await expect(ctx.pool.query(`DELETE FROM family_history_entry WHERE id = $1`, [ids.father])).rejects.toThrow(/never deleted/);
    await expect(ctx.pool.query(`UPDATE family_history_review SET outcome = 'unknown' WHERE patient_id = $1`, [patientId])).rejects.toThrow();

    // A social history version in error: the previous one is current again.
    await staff(doctor).post(`/history/${ids.social3}/entered-in-error`, { reason: "Recorded on the wrong patient" }).expect(200);
    const history = await read();
    expect(history.procedures.find((p) => p.id === ids.wrong)?.enteredInError).toMatchObject({ reason: "Told about another patient" });
    expect(history.social.current.id).toBe(ids.social2);
    expect(history.social.versions.find((v) => v.id === ids.social3)).toMatchObject({ current: false, enteredInError: expect.any(Object) });
    // The replaced version can be replaced again.
    ids.social4 = (await staff(doctor).post(`/patients/${patientId}/history/social`, { basedOn: ids.social2, diet: "Low salt" }).expect(201)).body.id;
    const inError = await events("PatientHistoryEnteredInError");
    expect(inError).toEqual(
      expect.arrayContaining([
        { entryId: ids.wrong, section: "procedure" },
        { entryId: ids.social3, section: "social" },
      ]),
    );
  });

  it("records medications taken that were not prescribed here; marks them stopped once; corrects by entered in error", async () => {
    const losartan = {
      medication: "Losartan 50 mg tablet",
      dose: "1 tablet every morning",
      reason: "High blood pressure",
      prescribedBy: "Cardiologist at another hospital",
      started: "2019-05",
      status: "taking",
      reportedBy: "patient",
      encounterId,
    };
    await staff(cashier).post(`/patients/${patientId}/history/medications`, losartan).expect(403);
    await staff(officer).post(`/patients/${patientId}/history/medications`, losartan).expect(403);
    await staff(nurse)
      .post(`/patients/${patientId}/history/medications`, { ...losartan, stopped: "2020" })
      .expect(400);
    const future = await staff(nurse)
      .post(`/patients/${patientId}/history/medications`, { ...losartan, started: "2099" })
      .expect(422);
    expect(future.body.error.code).toBe("date_in_future");
    const backwards = await staff(nurse)
      .post(`/patients/${patientId}/history/medications`, { ...losartan, status: "stopped", started: "2020-05", stopped: "2019" })
      .expect(422);
    expect(backwards.body.error.code).toBe("stop_before_start");

    const created = (await staff(nurse).post(`/patients/${patientId}/history/medications`, losartan).expect(201)).body;
    ids.losartan = created.id;
    expect(created).toMatchObject({
      medication: "Losartan 50 mg tablet",
      dose: "1 tablet every morning",
      started: "2019-05",
      startedPrecision: "month",
      reportedStatus: "taking",
      status: "taking",
      stopRecorded: null,
      source: "reported",
      reportedBy: "patient",
      encounterId,
      recordedByName: expect.any(String),
    });
    ids.metformin = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/medications`, {
          medication: "Metformin 500 mg",
          started: "2018",
          status: "stopped",
          stopped: "2020",
          reportedBy: "patient",
        })
        .expect(201)
    ).body.id;
    ids.lagundi = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/medications`, {
          medication: "Lagundi syrup",
          status: "unknown",
          source: "recorded_here",
          sourceDescription: "Medicine bag the patient brought",
        })
        .expect(201)
    ).body.id;
    ids.aspirin = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/medications`, { medication: "Aspirin 80 mg", started: "2021", status: "taking", reportedBy: "relative" })
        .expect(201)
    ).body.id;

    // Stopped once, with the stop date as known; never before the start.
    expect((await staff(nurse).post(`/history/medications/${ids.aspirin}/stopped`, { stopped: "2020" }).expect(422)).body.error.code).toBe("stop_before_start");
    await staff(cashier).post(`/history/medications/${ids.losartan}/stopped`, {}).expect(403);
    const stopped = (
      await staff(nurse).post(`/history/medications/${ids.losartan}/stopped`, { stopped: "2025", note: "Switched by her cardiologist" }).expect(200)
    ).body;
    expect(stopped).toMatchObject({
      status: "stopped",
      reportedStatus: "taking",
      stopped: "2025",
      stopRecorded: { byName: expect.any(String), note: "Switched by her cardiologist" },
    });
    expect((await staff(nurse).post(`/history/medications/${ids.losartan}/stopped`, {}).expect(422)).body.error.code).toBe("already_stopped");
    expect((await staff(nurse).post(`/history/medications/${ids.metformin}/stopped`, {}).expect(422)).body.error.code).toBe("already_stopped");

    // Entered in error through the history's own endpoint; nothing else changes afterwards.
    const marked = (await staff(doctor).post(`/history/${ids.lagundi}/entered-in-error`, { reason: "Another patient's medicine bag" }).expect(200)).body;
    expect(marked).toMatchObject({ section: "medication" });
    expect((await staff(nurse).post(`/history/medications/${ids.lagundi}/stopped`, {}).expect(422)).body.error.code).toBe("already_entered_in_error");

    const history = await read();
    const byId = new Map(history.medications.map((m) => [m.id, m]));
    expect(byId.get(ids.metformin)).toMatchObject({ status: "stopped", started: "2018", stopped: "2020", stopRecorded: null });
    expect(byId.get(ids.lagundi)).toMatchObject({ status: "unknown", enteredInError: expect.any(Object) });
    expect(byId.get(ids.aspirin)).toMatchObject({ status: "taking" });

    // The database keeps the rules too.
    await expect(ctx.pool.query(`UPDATE reported_medication SET medication = 'Changed' WHERE id = $1`, [ids.aspirin])).rejects.toThrow(/only marking stopped/);
    await expect(ctx.pool.query(`UPDATE reported_medication SET stop_note = 'Again' WHERE id = $1`, [ids.losartan])).rejects.toThrow(/marked stopped once/);
    await expect(
      ctx.pool.query(`UPDATE reported_medication SET stop_recorded_at = now(), stop_recorded_by = recorded_by WHERE id = $1`, [ids.metformin]),
    ).rejects.toThrow(/marked stopped once/);
    await expect(ctx.pool.query(`DELETE FROM reported_medication WHERE id = $1`, [ids.aspirin])).rejects.toThrow(/never deleted/);

    expect(await events("PatientHistoryRecorded")).toEqual(expect.arrayContaining([{ entryId: ids.losartan, section: "medication" }]));
    expect(await events("PatientHistoryMedicationStopped")).toEqual([{ entryId: ids.losartan, section: "medication" }]);
    const audit = await auditRows(ctx.pool, "action = 'history.medication-stopped' AND resource_id = $1", [ids.losartan]);
    expect(audit[0]).toMatchObject({ patient_id: patientId, metadata: { section: "medication", stoppedPrecision: "year" } });
    const changes = await ctx.pool.query("SELECT changes FROM audit_event WHERE action = 'history.medication-stopped' AND resource_id = $1", [ids.losartan]);
    expect(changes.rows[0].changes).toEqual({ status: { from: "taking", to: "stopped" } });
    expect(JSON.stringify(await events("PatientHistoryMedicationStopped"))).not.toMatch(/Losartan|cardiologist/);
  });

  it("refuses new history under a merged record and reads the retired record's history with the survivor", async () => {
    ids.otherProcedure = (
      await staff(nurse)
        .post(`/patients/${otherPatientId}/history/procedures`, { description: "Caesarean section", performed: "2019-04-02", reportedBy: "patient" })
        .expect(201)
    ).body.id;
    await staff(doctor).post(`/encounters/${otherEncounterId}/entered-in-error`, { reason: "Opened for the wrong record" }).expect(200);
    const preview = (await staff(officer).get(`/patients/${otherPatientId}/merge-preview?into=${patientId}`).expect(200)).body;
    expect(preview.blockers).toEqual([]);
    await staff(officer)
      .post(`/patients/${otherPatientId}/merge`, {
        survivorPatientId: patientId,
        reason: "Registered twice",
        retiredVersion: preview.retired.version,
        survivorVersion: preview.survivor.version,
        acknowledgedDifferences: preview.differences.map((d: { code: string }) => d.code),
      })
      .expect(200);
    expect(
      (await staff(nurse).post(`/patients/${otherPatientId}/history/procedures`, { description: "Biopsy", reportedBy: "patient" }).expect(422)).body.error.code,
    ).toBe("patient_merged");
    expect((await staff(nurse).post(`/patients/${otherPatientId}/history/family/review`, { outcome: "none_known" }).expect(422)).body.error.code).toBe(
      "patient_merged",
    );
    const history = await read();
    expect(history.procedures.find((p) => p.id === ids.otherProcedure)).toMatchObject({ patientId: otherPatientId, performed: "2019-04-02" });
  });

  it("shows the history on Patient 360, sensitive parts only with encounter.write, withheld without history.read", async () => {
    const workspace = (await staff(doctor).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(workspace.history.procedures.map((p: { id: string }) => p.id)).not.toContain(ids.wrong);
    expect(workspace.history.procedures.find((p: { id: string }) => p.id === ids.otherProcedure)).toMatchObject({ filedUnder: expect.any(String) });
    expect(workspace.history.family).toMatchObject({ state: "recorded", total: 2 });
    // Medicines still taken (or not known) only: stopped ones and entries in error stay in the full history.
    expect(workspace.history.medications.map((m: { id: string }) => m.id)).toEqual([ids.aspirin]);
    expect(workspace.history.medicationsTotal).toBe(1);
    expect(workspace.history.social).toMatchObject({
      tobacco: "Former — Cigarettes, 10 sticks a day, quit 2025",
      substanceUse: "Cannabis in college, none since",
    });
    const forNurse = (await staff(nurse).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(forNurse.history.social).toMatchObject({ sensitiveWithheld: true, substanceUse: null, sexualHistory: null });
    expect(JSON.stringify(forNurse)).not.toMatch(/Cannabis|One partner/);
    const forCashier = (await staff(cashier).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(forCashier.history).toBeNull();
    expect(forCashier.withheld).toContain("history");
    await staff(cashier).get(`/patients/${patientId}/history`).expect(403);
    // Never in the timeline.
    const timeline = (await staff(doctor).get(`/patients/${patientId}/timeline`).expect(200)).body;
    expect(JSON.stringify(timeline)).not.toMatch(/Appendectomy|Cannabis|Type 2 diabetes/);
  });

  it("exports the history as FHIR R4 (schema-valid); sensitive observations only for a caller who may see them", async () => {
    const search = async (type: string, t = admin) => (await staff(t).get(`/fhir/r4/${type}?patient=${patientId}&_count=200`).expect(200)).body;
    const procedures = await search("Procedure");
    const byId = new Map(procedures.entry.map((e: { resource: { id: string } }) => [e.resource.id, e.resource]));
    expect(byId.get(ids.appendectomy)).toMatchObject({ status: "completed", performedDateTime: "2010", asserter: { reference: `Patient/${patientId}` } });
    expect(byId.get(ids.cholecystectomy)).toMatchObject({ performedDateTime: "2018-11", recorder: { reference: expect.stringMatching(/^Practitioner\//) } });
    expect(byId.get(ids.wrong)).toMatchObject({ status: "entered-in-error" });
    const conditions = await search("Condition");
    const tb = conditions.entry.find((e: { resource: { id: string } }) => e.resource.id === ids.tb).resource;
    expect(tb).toMatchObject({
      verificationStatus: { coding: [{ code: "unconfirmed" }] },
      clinicalStatus: { coding: [{ code: "resolved" }] },
      onsetDateTime: "2015-03",
    });
    expect(tb.category[0].coding[0].code).toBe("past-medical-history");
    const family = await search("FamilyMemberHistory");
    expect(family.total).toBe(2);
    const father = family.entry.find((e: { resource: { id: string } }) => e.resource.id === ids.father).resource;
    expect(father).toMatchObject({ relationship: { coding: [{ code: "FTH" }] }, deceasedBoolean: true });
    const observations = await search("Observation");
    const social = observations.entry.filter((e: { resource: { category?: Array<{ coding: Array<{ code: string }> }> } }) =>
      e.resource.category?.some((c) => c.coding.some((x) => x.code === "social-history")),
    );
    expect(social.map((e: { resource: { id: string } }) => e.resource.id)).toContain(`${ids.social2}-substance-use`);
    const medications = await search("MedicationStatement");
    const losartanStatement = medications.entry.find((e: { resource: { id: string } }) => e.resource.id === ids.losartan).resource;
    expect(losartanStatement).toMatchObject({
      status: "stopped",
      effectivePeriod: { start: "2019-05", end: "2025" },
      medicationCodeableConcept: { text: "Losartan 50 mg tablet" },
      informationSource: { reference: `Patient/${patientId}` },
    });
    expect(losartanStatement.category.coding[0].code).toBe("medication-taken");
    expect(JSON.stringify(losartanStatement)).not.toContain("Switched by her cardiologist");
    expect(medications.entry.find((e: { resource: { id: string } }) => e.resource.id === ids.lagundi).resource.status).toBe("entered-in-error");
    for (const e of [...procedures.entry, ...conditions.entry, ...family.entry, ...social, ...medications.entry]) expect(schemaErrors(e.resource)).toEqual([]);

    const limited = await search("Observation", integration);
    expect(JSON.stringify(limited)).not.toMatch(/Cannabis|One partner|substance-use|sexual-history/);
    expect(
      limited.entry
        .filter((e: { search: { mode: string } }) => e.search.mode === "outcome")
        .map((e: { resource: { issue: Array<{ diagnostics: string }> } }) => e.resource.issue[0]!.diagnostics),
    ).toEqual(expect.arrayContaining([expect.stringContaining("Substance use and sexual history")]));
    const everything = (await staff(integration).get(`/fhir/r4/Patient/${patientId}/$everything?_count=200`).expect(200)).body;
    expect(everything.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType)).toEqual(
      expect.arrayContaining(["Procedure", "Condition", "FamilyMemberHistory", "Observation"]),
    );
    expect(JSON.stringify(everything)).not.toMatch(/Cannabis|One partner/);
    const metadata = (await staff(admin).get("/fhir/r4/metadata").expect(200)).body;
    expect(metadata.rest[0].resource.map((r: { type: string }) => r.type)).toContain("FamilyMemberHistory");
  });

  it("accepts imported Procedure and FamilyMemberHistory entries into the history; Conditions stay external history", async () => {
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      meta: { source: "https://ehr.example.org" },
      entry: [
        {
          fullUrl: "urn:uuid:p1",
          resource: { resourceType: "Patient", id: "p1", name: [{ family: "Dela Cruz", given: ["Juan"] }], gender: "male", birthDate: juan.birthDate },
        },
        {
          resource: {
            resourceType: "Procedure",
            status: "completed",
            code: { coding: [{ system: "http://example.org/procedures", code: "HR-01", display: "Inguinal hernia repair" }] },
            subject: { reference: "urn:uuid:p1" },
            performedDateTime: "2005-08",
          },
        },
        {
          resource: {
            resourceType: "FamilyMemberHistory",
            status: "completed",
            patient: { reference: "urn:uuid:p1" },
            relationship: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "MTH", display: "mother" }] },
            condition: [
              { code: { text: "Hypertension" }, onsetAge: { value: 50, unit: "years", system: "http://unitsofmeasure.org", code: "a" } },
              { code: { text: "Glaucoma" } },
            ],
          },
        },
        { resource: { resourceType: "Condition", code: { text: "Gout" }, subject: { reference: "urn:uuid:p1" } } },
      ],
    };
    const received = await ctx
      .http()
      .post("/api/v1/fhir/r4/imports")
      .set(as(admin, tenant.facilityId))
      .set("content-type", "application/fhir+json")
      .set("idempotency-key", `hist-${randomUUID()}`)
      .send(JSON.stringify(bundle))
      .expect(201);
    const importId = received.body.issue[0].details.coding[0].code as string;
    const review = (url: string, body: object = {}) => ctx.http().post(`/api/v1/fhir-imports${url}`).set(as(officer, tenant.facilityId)).send(body);
    let view = (await ctx.http().get(`/api/v1/fhir-imports/${importId}`).set(as(officer, tenant.facilityId)).expect(200)).body;
    const entryOf = (type: string) => view.entries.find((e: { resourceType: string }) => e.resourceType === type);
    expect(entryOf("Procedure")).toMatchObject({ kind: "procedure", becomes: "past_procedure", item: { display: "Inguinal hernia repair", acceptable: true } });
    expect(entryOf("FamilyMemberHistory")).toMatchObject({ kind: "family_history", becomes: "family_history", item: { relationship: "mother" } });
    view = (await review(`/${importId}/match`, { patientId, version: view.version }).expect(200)).body;
    for (const type of ["Procedure", "FamilyMemberHistory", "Condition"])
      view = (await review(`/${importId}/entries/${entryOf(type).id}/accept`).expect(200)).body;
    expect(entryOf("Procedure")).toMatchObject({ outcome: "accepted", resultType: "past_procedure" });
    expect(entryOf("FamilyMemberHistory")).toMatchObject({ outcome: "accepted", resultType: "family_history_entry" });
    expect(entryOf("Condition")).toMatchObject({ outcome: "accepted", resultType: "external_history_entry" });
    const history = await read();
    expect(history.procedures.find((p) => p.id === entryOf("Procedure").resultId)).toMatchObject({
      source: "external_import",
      performed: "2005-08",
      description: "Inguinal hernia repair",
    });
    const mother = history.family.entries.filter((e) => e.relative === "Mother");
    expect(mother.map((e) => e.condition).sort()).toEqual(["Glaucoma", "Hypertension"]);
    expect(mother.every((e) => e.source === "external_import")).toBe(true);
    const accepted = await auditRows(ctx.pool, "action = 'fhir.import.entry-accept' AND metadata->>'resultType' = 'family_history_entry'");
    expect((accepted[0]!.metadata as { resultIds: string[] }).resultIds).toHaveLength(2);
    const fhirProcedure = (await staff(admin).get(`/fhir/r4/Procedure?patient=${patientId}`).expect(200)).body.entry.find(
      (e: { resource: { id: string } }) => e.resource.id === entryOf("Procedure").resultId,
    ).resource;
    expect(fhirProcedure.meta.tag[0].code).toBe("external-import");
    expect(fhirProcedure.code.coding[0]).toMatchObject({ system: "http://example.org/procedures", code: "HR-01" });
  });

  it("shows the patient their history in MyHealth (sensitive parts to them, not to a guardian) and copies it for a records request", async () => {
    const token = await activate(patientId, "juan@hist.ph");
    const mine = (await portal(token).get("/health-history").expect(200)).body;
    expect(mine.procedures.map((p: { id: string }) => p.id)).not.toContain(ids.wrong);
    expect(mine.procedures.find((p: { id: string }) => p.id === ids.appendectomy)).toEqual({
      id: ids.appendectomy,
      description: "Appendectomy",
      performed: "2010",
      performer: "Provincial Hospital",
      bodySite: null,
      source: "reported",
      recordedVia: "staff",
    });
    expect(mine.family.state).toBe("recorded");
    expect(mine.medications.map((m: { id: string }) => m.id)).not.toContain(ids.lagundi);
    expect(mine.medications.find((m: { id: string }) => m.id === ids.losartan)).toEqual({
      id: ids.losartan,
      medication: "Losartan 50 mg tablet",
      dose: "1 tablet every morning",
      reason: "High blood pressure",
      started: "2019-05",
      status: "stopped",
      stopped: "2025",
      source: "reported",
      recordedVia: "staff",
      canStop: false,
      prescribedBy: expect.anything(),
    });
    expect(mine.social).toMatchObject({ diet: "Low salt", substanceUse: "Cannabis in college, none since", sensitiveWithheld: false });
    expect(JSON.stringify(mine)).not.toMatch(/recordedBy|Discharge summary the patient brought|Told about another patient/);
    expect(await auditRows(ctx.pool, "action = 'portal.health-history-view' AND patient_id = $1", [patientId])).toHaveLength(1);

    // A guardian acting for the patient sees the history without the sensitive parts.
    await activate(guardianId, "rosa@hist.ph");
    const guardianNumber = (await ctx.pool.query("SELECT patient_number FROM patient WHERE id = $1", [guardianId])).rows[0].patient_number;
    await staff(admin)
      .post(`/patients/${patientId}/portal-proxies`, {
        guardianPatientNumber: guardianNumber,
        relationship: "caregiver",
        basis: "authorized_by_patient",
        verificationNote: "Signed authorization letter and IDs seen",
      })
      .expect(201);
    const guardianToken = (
      await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: ORG, email: "rosa@hist.ph", password: PASSWORD }).expect(200)
    ).body.accessToken;
    const asGuardian = (await portal(guardianToken, patientId).get("/health-history").expect(200)).body;
    expect(asGuardian.social).toMatchObject({ sensitiveWithheld: true, substanceUse: null, sexualHistory: null });
    expect(JSON.stringify(asGuardian)).not.toMatch(/Cannabis|One partner/);

    const requestId = (
      await portal(token)
        .post("/records-requests", { scope: ["other"], purpose: "Pre-employment", details: "Medical history" })
        .expect(201)
    ).body.id;
    const copy = await staff(officer)
      .post(`/records-requests/${requestId}/copies`, { sections: ["history"] })
      .expect(201);
    expect(copy.body.sections).toEqual(["history"]);
    const text = extractPdfText(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${copy.body.documentId}`)!)
      .replace(/·/g, "")
      .replace(/\s+/g, " ");
    for (const expected of [
      "Medical, medication, family and social history",
      "Losartan 50 mg tablet",
      "Stopped 2025",
      "Appendectomy",
      "Pulmonary tuberculosis",
      "Father",
      "Type 2 diabetes",
      "Cannabis",
      "Jeepney driver",
    ]) {
      expect(text).toContain(expected);
    }
    // Entries in error are left out (the procedure, and version 3 with "Farmer").
    expect(text).not.toContain("Tonsillectomy");
    expect(text).not.toContain("Farmer");
    expect(text).not.toContain("Lagundi");
  });

  it("lets the patient answer a history questionnaire and report medicines in MyHealth, kept as reported by them", async () => {
    const login = async (email: string) => {
      const response = await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: ORG, email, password: PASSWORD });
      if (response.status !== 200) throw new Error(`login ${email}: ${response.status} ${JSON.stringify(response.body)}`);
      return response.body.accessToken as string;
    };
    const juan = await login("juan@hist.ph");
    const rosa = await login("rosa@hist.ph");
    const send = (token: string, body: object, key?: string, actingFor?: string) => {
      let r = ctx.http().post("/api/v1/portal/health-history/submissions").set("Authorization", `Bearer ${token}`);
      if (key) r = r.set("Idempotency-Key", key);
      if (actingFor) r = r.set("X-Acting-For", actingFor);
      return r.send(body);
    };
    const questionnaire = {
      medications: [
        {
          medication: "Metformin 500 mg tablet",
          dose: "1 tablet twice a day",
          reason: "Sugar",
          prescribedBy: "Barangay health center",
          started: "2024-01",
          status: "taking",
        },
      ],
      conditions: [{ description: "Asthma as a child", status: "resolved", onset: "1990" }],
      procedures: [{ description: "Circumcision", performed: "1995", performer: "Town clinic" }],
      family: [{ relationship: "father", condition: "Hypertension", onsetAge: 55 }],
      social: { tobaccoStatus: "former", tobaccoQuitYear: 2015, occupation: "Tricycle driver" },
    };
    const key = `hh-${randomUUID()}`;
    const first = (await send(juan, questionnaire, key).expect(201)).body;
    expect(first).toMatchObject({ byProxy: false, replayed: false });
    expect(first.sections.sort()).toEqual(["condition", "family", "medication", "procedure", "social"]);
    expect(first.entryIds).toHaveLength(5);
    // A retry with the same key returns the first submission; nothing is written again.
    const again = (await send(juan, questionnaire, key).expect(201)).body;
    expect(again).toMatchObject({ id: first.id, replayed: true, entryIds: first.entryIds });
    expect(await auditRows(ctx.pool, "action = 'portal.health-history-submit' AND patient_id = $1", [patientId])).toHaveLength(1);

    // Staff see the entries as reported by the patient through MyHealth, with nobody of the clinic as recorder.
    const history = await read();
    const metformin = history.medications.find((m) => m.medication === "Metformin 500 mg tablet");
    expect(metformin).toMatchObject({
      source: "reported",
      reportedBy: "patient",
      recordedVia: "patient_portal",
      recordedByName: null,
      status: "taking",
      started: "2024-01",
    });
    expect(history.conditions.find((c) => c.description === "Asthma as a child")).toMatchObject({
      recordedVia: "patient_portal",
      status: "resolved",
      onset: "1990",
    });
    expect(history.procedures.find((p) => p.description === "Circumcision")).toMatchObject({ recordedVia: "patient_portal", performer: "Town clinic" });
    expect(history.family.entries.find((f) => f.condition === "Hypertension")).toMatchObject({
      relative: "Father",
      reportedBy: "patient",
      recordedVia: "patient_portal",
      onsetAge: 55,
    });
    // The social history version from MyHealth builds on the current one: the clinic's sensitive parts are carried over, never set.
    expect(history.social.current).toMatchObject({
      recordedVia: "patient_portal",
      tobaccoStatus: "former",
      tobaccoQuitYear: 2015,
      occupation: "Tricycle driver",
      diet: "Low salt",
      substanceUse: "Cannabis in college, none since",
    });
    const recorded = await auditRows(ctx.pool, "action = 'history.record' AND metadata->>'recordedVia' = 'patient_portal' AND patient_id = $1", [patientId]);
    expect(recorded).toHaveLength(5);
    expect(recorded.every((r) => r.actor_type === "patient")).toBe(true);
    expect((await events("PatientHistoryRecorded")).filter((e) => first.entryIds.includes(e.entryId as string))).toHaveLength(5);

    // The patient sees what they reported, may mark their own medicine stopped, and sees the questionnaires sent.
    const mine = (await portal(juan).get("/health-history").expect(200)).body;
    expect(mine.medications.find((m: { id: string }) => m.id === metformin!.id)).toMatchObject({
      recordedVia: "patient_portal",
      canStop: true,
      prescribedBy: "Barangay health center",
    });
    expect(mine.submissions).toEqual([{ id: first.id, submittedAt: expect.any(String), sections: expect.any(Array), byProxy: false }]);
    const stop = (url: string, body: object, token = juan) =>
      ctx.http().post(`/api/v1/portal/health-history${url}`).set("Authorization", `Bearer ${token}`).send(body);
    await stop(`/medications/${metformin!.id}/stopped`, { stopped: "2023" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("stop_before_start"));
    await stop(`/medications/${metformin!.id}/stopped`, { stopped: "2099" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("date_in_future"));
    expect((await stop(`/medications/${metformin!.id}/stopped`, { stopped: "2026-06" }).expect(201)).body).toMatchObject({
      id: metformin!.id,
      status: "stopped",
    });
    await stop(`/medications/${metformin!.id}/stopped`, {})
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("already_stopped"));
    expect((await read()).medications.find((m) => m.id === metformin!.id)).toMatchObject({
      status: "stopped",
      stopped: "2026-06",
      stopRecorded: { via: "patient_portal", byName: null },
    });
    // What the clinic recorded is changed at the clinic.
    const clinicMed = (
      await staff(doctor)
        .post(`/patients/${patientId}/history/medications`, { medication: "Vitamin C", status: "taking", source: "reported", reportedBy: "patient" })
        .expect(201)
    ).body;
    await stop(`/medications/${clinicMed.id}/stopped`, {})
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("recorded_by_clinic"));
    // Dates in the future and an empty questionnaire are refused before anything is written.
    await send(juan, { medications: [{ medication: "Future pill", status: "taking", started: "2099" }] }).expect(422);
    await send(juan, {}).expect(400);
    // The clinic corrects a patient's entry the usual way.
    await staff(doctor).post(`/history/${metformin!.id}/entered-in-error`, { reason: "Patient meant metformin 850 mg" }).expect(200);
    expect((await portal(juan).get("/health-history").expect(200)).body.medications.map((m: { id: string }) => m.id)).not.toContain(metformin!.id);

    // A guardian with "act" access answers for the patient: recorded as reported by a relative, marked as by proxy.
    const byRosa = (await send(rosa, { family: [{ relationship: "mother", condition: "Glaucoma" }] }, undefined, patientId).expect(201)).body;
    expect(byRosa.byProxy).toBe(true);
    expect((await read()).family.entries.find((f) => f.id === byRosa.entryIds[0])).toMatchObject({ reportedBy: "relative", recordedVia: "patient_portal" });
    // View-only access reads but cannot answer.
    const dependent = await register({ familyName: "Hist", givenName: "Dependent", sex: "male", birthDate: "2015-03-03" });
    const rosaNumber = (await ctx.pool.query("SELECT patient_number FROM patient WHERE id = $1", [guardianId])).rows[0].patient_number;
    await staff(admin)
      .post(`/patients/${dependent}/portal-proxies`, {
        guardianPatientNumber: rosaNumber,
        relationship: "caregiver",
        basis: "authorized_by_patient",
        scopes: ["view"],
        verificationNote: "Signed authorization letter and IDs seen",
      })
      .expect(201);
    await portal(rosa, dependent).get("/health-history").expect(200);
    await send(rosa, { family: [{ relationship: "mother", condition: "Glaucoma" }] }, undefined, dependent)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("proxy_view_only"));
  });
});
