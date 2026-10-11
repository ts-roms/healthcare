import { FhirImportRetention } from "@healthcare/interoperability";
import { randomBytes } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

const PIN_SYSTEM = "https://ids.test.invalid/philhealth-pin";
const KEY = randomBytes(32).toString("base64");

const patient = {
  resourceType: "Patient",
  id: "p1",
  identifier: [{ system: PIN_SYSTEM, value: "12-345678901-2" }],
  name: [{ use: "official", family: "Dela Cruz", given: ["Juan"] }],
  gender: "male",
  birthDate: "1980-03-04",
};
const allergy = (substance: string, extra: object = {}) => ({
  resourceType: "AllergyIntolerance",
  category: ["medication"],
  criticality: "high",
  code: { text: substance },
  patient: { reference: "Patient/p1" },
  reaction: [{ manifestation: [{ text: "Hives" }], severity: "moderate" }],
  ...extra,
});
const condition = {
  resourceType: "Condition",
  code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9", display: "Type 2 diabetes mellitus" }] },
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
  subject: { reference: "Patient/p1" },
  onsetDateTime: "2019-05",
};
const observation = {
  resourceType: "Observation",
  status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
  code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c" }] },
  subject: { reference: "Patient/p1" },
  valueQuantity: { value: 7.2, unit: "%" },
};

function bundle(id: string, entries: object[], extra: object = {}) {
  return {
    resourceType: "Bundle",
    type: "collection",
    identifier: { system: "https://hospital.test.invalid/bundles", value: id },
    meta: { source: "https://hospital.test.invalid/fhir" },
    entry: entries.map((resource) => ({ resource })),
    ...extra,
  };
}

interface ImportView {
  id: string;
  status: string;
  version: number;
  patientId: string | null;
  contentPurged: boolean;
  registration: { possible: boolean };
  entries: Array<{
    id: string;
    resourceType: string;
    kind: string;
    becomes: string | null;
    outcome: string;
    reason: string | null;
    resultId: string | null;
    item: { acceptable: boolean } | null;
  }>;
}

/**
 * FHIR R4 inbound (docs/interoperability/fhir.md, "Inbound"): content is received into a review queue — validated,
 * idempotent, sealed — and reaches the record only when staff match the patient and accept an entry, through the
 * clinic domain (allergy with its source; external history otherwise). Every step is audited.
 */
describe("FHIR R4 imports", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  let doctor: string;
  let outsider: string;
  let patientId: string;

  const receive = (body: unknown, token = admin, key?: string) => {
    const req = ctx.http().post("/api/v1/fhir/r4/imports").set(as(token, tenant.facilityId)).set("content-type", "application/fhir+json");
    if (key) req.set("idempotency-key", key);
    return req.send(JSON.stringify(body));
  };
  const review = (token = officer) => ({
    get: (url: string) => ctx.http().get(`/api/v1/fhir-imports${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/fhir-imports${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  // The import id is in the OperationOutcome (a replayed response carries no Location header).
  const importIdOf = (res: { body: { issue: Array<{ details?: { coding?: Array<{ code: string }> } }> } }) => res.body.issue[0]!.details!.coding![0]!.code;
  const entryOf = (view: ImportView, resourceType: string, n = 0) => view.entries.filter((e) => e.resourceType === resourceType)[n]!;

  beforeAll(async () => {
    ctx = await createTestApp(
      {},
      {
        FHIR_IDENTIFIER_SYSTEMS: JSON.stringify({ philhealth_pin: PIN_SYSTEM }),
        INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ k1: KEY }),
        INTEGRATION_PAYLOAD_KEY_ID: "k1",
      },
    );
    tenant = await createTenant(ctx.pool, "import-org");
    const other = await createTenant(ctx.pool, "import-other");
    await createStaff(ctx.pool, tenant, "admin@import.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@import.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "doctor@import.ph", ["physician"]);
    await createStaff(ctx.pool, other, "admin@other-import.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@import.ph")).accessToken;
    officer = (await login(ctx, "records@import.ph")).accessToken;
    doctor = (await login(ctx, "doctor@import.ph")).accessToken;
    outsider = (await login(ctx, "admin@other-import.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
  });

  afterAll(() => ctx.close());

  describe("receiving", () => {
    it("requires interop.fhir.import (clinicians and reviewers cannot submit) and answers with an OperationOutcome", async () => {
      for (const token of [doctor, officer]) {
        const res = await receive(bundle("perm", [patient]), token).expect(403);
        expect(res.headers["content-type"]).toContain("application/fhir+json");
        expect(res.body).toMatchObject({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "forbidden" }] });
      }
      await ctx.http().get("/api/v1/fhir-imports").set(as(doctor, tenant.facilityId)).expect(403);
      await ctx
        .http()
        .post("/api/v1/fhir/r4/imports")
        .send(bundle("anon", [patient]))
        .expect(401);
    });

    it("answers invalid content with an OperationOutcome listing each problem and its location", async () => {
      const bad = bundle("bad", [patient, { ...observation, status: "done" }, { ...allergy("X"), patient: undefined }]);
      const res = await receive(bad).expect(400);
      expect(res.body.resourceType).toBe("OperationOutcome");
      const expressions = res.body.issue.map((i: { expression?: string[] }) => i.expression?.[0]);
      expect(expressions).toEqual(expect.arrayContaining(["Bundle.entry[1].resource.status", "Bundle.entry[2].resource.patient"]));

      const transaction = await receive({ ...bundle("tx", [patient]), type: "transaction" }).expect(422);
      expect(transaction.body.issue[0]).toMatchObject({ code: "not-supported", expression: ["Bundle.type"] });

      const noKey = await receive({ resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] }).expect(400);
      expect(noKey.body.issue[0].code).toBe("required");

      await receive({ hello: "world" }).expect(400);
      const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM fhir_import`);
      expect(rows[0].n).toBe(0);
    });

    it("stores the content sealed, keeps only non-PHI metadata in clear, and is idempotent", async () => {
      const body = bundle("b-1", [patient, allergy("Penicillin"), condition, observation, { resourceType: "Practitioner", name: [{ family: "Reyes" }] }]);
      const first = await receive(body).expect(201);
      expect(first.headers["content-type"]).toContain("application/fhir+json");
      expect(first.body).toMatchObject({
        resourceType: "OperationOutcome",
        issue: [{ severity: "information" }, { severity: "warning", code: "not-supported" }],
      });
      const id = importIdOf(first);
      expect(first.headers["location"]).toMatch(new RegExp(`/api/v1/fhir-imports/${id}$`));

      // Same Bundle.identifier, same content: the same import (200), nothing stored twice.
      const again = await receive(body).expect(200);
      expect(importIdOf(again)).toBe(id);
      // Same Bundle.identifier, other content: refused.
      const conflict = await receive(bundle("b-1", [patient])).expect(409);
      expect(conflict.body.issue[0].code).toBe("conflict");
      // A caller key: replayed as well.
      const keyed = await receive(allergy("Latex"), admin, "import-key-0001").expect(201);
      expect(importIdOf(await receive(allergy("Latex"), admin, "import-key-0001").expect(201))).toBe(importIdOf(keyed));

      const { rows: imports } = await ctx.pool.query(`SELECT * FROM fhir_import WHERE id = $1`, [id]);
      expect(imports[0]).toMatchObject({ status: "pending_review", entry_count: 5, declared_source: "https://hospital.test.invalid/fhir", patient_id: null });
      expect(imports[0].resource_counts).toEqual({ Patient: 1, AllergyIntolerance: 1, Condition: 1, Observation: 1, Practitioner: 1 });
      const { rows: content } = await ctx.pool.query(`SELECT key_id, ciphertext FROM fhir_import_content WHERE import_id = $1`, [id]);
      expect(content[0].key_id).toBe("k1");
      expect(content[0].ciphertext).toMatch(/^v2\.k1\./);
      const { rows: entries } = await ctx.pool.query(`SELECT resource_type, kind, outcome FROM fhir_import_entry WHERE import_id = $1 ORDER BY entry_index`, [
        id,
      ]);
      expect(entries.map((e) => [e.resource_type, e.outcome])).toEqual([
        ["Patient", "pending"],
        ["AllergyIntolerance", "pending"],
        ["Condition", "pending"],
        ["Observation", "pending"],
        ["Practitioner", "not_supported"],
      ]);
      // No PHI anywhere in clear.
      const clear = JSON.stringify([imports, entries, content.map((c) => c.key_id)]);
      for (const phi of ["Dela Cruz", "Penicillin", "12-345678901-2", "Hemoglobin", "1980-03-04"]) expect(clear).not.toContain(phi);
      expect(content[0].ciphertext).not.toContain("Penicillin");

      const audits = await auditRows(ctx.pool, "action = 'fhir.import.receive'");
      expect(audits.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(audits)).not.toContain("Penicillin");
    });
  });

  describe("review", () => {
    let importId: string;
    let view: ImportView;

    beforeAll(async () => {
      const res = await receive(
        bundle("review-1", [
          patient,
          allergy("Amoxicillin"),
          condition,
          observation,
          allergy("Sulfa", { verificationStatus: { coding: [{ code: "refuted" }] } }),
        ]),
      ).expect(201);
      importId = importIdOf(res);
    });

    it("lists pending imports and shows one in readable form (audited)", async () => {
      const list = await review().get("?status=pending_review").expect(200);
      expect(list.body.find((i: { id: string }) => i.id === importId)).toMatchObject({ status: "pending_review", pendingEntries: 5, patient: null });
      view = (await review().get(`/${importId}`).expect(200)).body;
      expect(entryOf(view, "AllergyIntolerance")).toMatchObject({
        becomes: "allergy",
        outcome: "pending",
        item: { substance: "Amoxicillin", acceptable: true },
      });
      expect(entryOf(view, "Condition")).toMatchObject({ becomes: "external_history", item: { display: "Type 2 diabetes mellitus" } });
      expect(entryOf(view, "AllergyIntolerance", 1).item).toMatchObject({ acceptable: false });
      expect(view.registration.possible).toBe(true);
      expect(await auditRows(ctx.pool, "action = 'fhir.import.view' AND resource_id = $1", [importId])).toHaveLength(1);
      // Another organization does not see it.
      await ctx.http().get(`/api/v1/fhir-imports/${importId}`).set(as(outsider)).expect(404);
    });

    it("never links a patient automatically: accepting needs a match; candidates come from duplicate detection", async () => {
      const res = await review()
        .post(`/${importId}/entries/${entryOf(view, "AllergyIntolerance").id}/accept`)
        .expect(422);
      expect(res.body.error.code).toBe("patient_not_matched");
      const candidates = await review().get(`/${importId}/candidates`).expect(200);
      expect(candidates.body.searchable).toBe(true);
      expect(candidates.body.candidates[0]).toMatchObject({ level: "certain", patient: { id: patientId, patientNumber: expect.any(String) } });
      expect(candidates.body.candidates[0].reasons).toContain("identifier_match");
    });

    it("matches the patient (version-checked, audited)", async () => {
      await review()
        .post(`/${importId}/match`, { patientId, version: view.version + 5 })
        .expect(409);
      view = (await review().post(`/${importId}/match`, { patientId, version: view.version }).expect(200)).body;
      expect(view.patientId).toBe(patientId);
      expect(entryOf(view, "Patient")).toMatchObject({ outcome: "accepted", resultId: patientId });
      const [match] = await auditRows(ctx.pool, "action = 'fhir.import.match' AND resource_id = $1", [importId]);
      expect(match).toMatchObject({ patient_id: patientId });
    });

    it("accepts an AllergyIntolerance as an allergy recorded with its external source, unconfirmed", async () => {
      const entry = entryOf(view, "AllergyIntolerance");
      view = (await review().post(`/${importId}/entries/${entry.id}/accept`).expect(200)).body;
      const accepted = entryOf(view, "AllergyIntolerance");
      expect(accepted).toMatchObject({ outcome: "accepted", resultId: expect.any(String) });
      const allergies = await ctx.http().get(`/api/v1/patients/${patientId}/allergies`).set(as(doctor, tenant.facilityId)).expect(200);
      expect(allergies.body.allergies).toEqual([
        expect.objectContaining({
          id: accepted.resultId,
          substance: "Amoxicillin",
          verification: "unconfirmed",
          criticality: "high",
          source: "external_import",
          sourceReference: `fhir-import:${importId}#1`,
        }),
      ]);
      const [added] = await auditRows(ctx.pool, "action = 'allergy.add' AND patient_id = $1", [patientId]);
      expect(added!.metadata).toMatchObject({ source: "external_import", sourceReference: `fhir-import:${importId}#1` });
      expect(await auditRows(ctx.pool, "action = 'fhir.import.entry-accept' AND resource_id = $1", [importId])).toHaveLength(1);
      // Decided once only.
      expect((await review().post(`/${importId}/entries/${entry.id}/accept`).expect(422)).body.error.code).toBe("entry_decided");
    });

    it("never overwrites: an allergy already recorded cannot be accepted again", async () => {
      const other = importIdOf(await receive(bundle("review-dup", [patient, allergy("amoxicillin")])).expect(201));
      let dup: ImportView = (await review().get(`/${other}`).expect(200)).body;
      dup = (await review().post(`/${other}/match`, { patientId, version: dup.version }).expect(200)).body;
      const res = await review()
        .post(`/${other}/entries/${entryOf(dup, "AllergyIntolerance").id}/accept`)
        .expect(409);
      expect(res.body.error.code).toBe("allergy_exists");
      dup = (await review().get(`/${other}`).expect(200)).body;
      expect(entryOf(dup, "AllergyIntolerance").outcome).toBe("pending");
    });

    it("refuses entries that are not acceptable (refuted at the source)", async () => {
      const res = await review()
        .post(`/${importId}/entries/${entryOf(view, "AllergyIntolerance", 1).id}/accept`)
        .expect(422);
      expect(res.body.error.code).toBe("entry_not_acceptable");
    });

    it("accepts a Condition as clearly labelled external history (not a diagnosis)", async () => {
      view = (
        await review()
          .post(`/${importId}/entries/${entryOf(view, "Condition").id}/accept`)
          .expect(200)
      ).body;
      const history = await ctx.http().get(`/api/v1/patients/${patientId}/external-history`).set(as(doctor, tenant.facilityId)).expect(200);
      expect(history.body).toEqual([
        expect.objectContaining({
          id: entryOf(view, "Condition").resultId,
          kind: "condition",
          display: "Type 2 diabetes mellitus",
          code: "E11.9",
          codeSystem: "http://hl7.org/fhir/sid/icd-10",
          source: "external_import",
          sourceReference: `fhir-import:${importId}#2`,
          declaredSource: "https://hospital.test.invalid/fhir",
          status: "active",
        }),
      ]);
      const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM diagnosis WHERE patient_id = $1`, [patientId]);
      expect(rows[0].n).toBe(0);
    });

    it("rejects entries with a reason and completes the import", async () => {
      await review()
        .post(`/${importId}/entries/${entryOf(view, "Observation").id}/reject`, {})
        .expect(400);
      view = (
        await review()
          .post(`/${importId}/entries/${entryOf(view, "Observation").id}/reject`, { reason: "Result already on file" })
          .expect(200)
      ).body;
      expect(entryOf(view, "Observation")).toMatchObject({ outcome: "rejected", reason: "Result already on file" });
      expect(view.status).toBe("pending_review");
      view = (
        await review()
          .post(`/${importId}/entries/${entryOf(view, "AllergyIntolerance", 1).id}/reject`, { reason: "Refuted by the sender" })
          .expect(200)
      ).body;
      expect(view.status).toBe("partially_accepted");
      const [reject] = await auditRows(ctx.pool, "action = 'fhir.import.entry-reject' AND resource_id = $1", [importId]);
      expect(reject).toMatchObject({ reason: "Result already on file", patient_id: patientId });
      // Completed: nothing more can change.
      await review().post(`/${importId}/reject`, { reason: "Too late", version: view.version }).expect(422);
    });

    it("lets reviewers mark accepted external history entered in error", async () => {
      const entryId = entryOf(view, "Condition").resultId!;
      await ctx
        .http()
        .post(`/api/v1/patients/${patientId}/external-history/${entryId}/entered-in-error`)
        .set(as(doctor, tenant.facilityId))
        .send({ reason: "Wrong patient" })
        .expect(403);
      const res = await ctx
        .http()
        .post(`/api/v1/patients/${patientId}/external-history/${entryId}/entered-in-error`)
        .set(as(officer, tenant.facilityId))
        .send({ reason: "Accepted for the wrong patient" })
        .expect(200);
      expect(res.body).toMatchObject({ status: "entered_in_error", enteredInErrorReason: "Accepted for the wrong patient" });
      await expect(ctx.pool.query(`DELETE FROM external_history_entry WHERE id = $1`, [entryId])).rejects.toThrow(/append-only/);
    });
  });

  describe("registering a new patient from an import", () => {
    const maria = { ...patient, id: "m1", identifier: [], name: [{ family: "Santos", given: ["Maria", "Clara"] }], gender: "female", birthDate: "1991-11-20" };

    it("requires patient.register as well, then registers through the normal registration and matches", async () => {
      const id = importIdOf(await receive(bundle("register-1", [maria, allergy("Aspirin", { patient: { reference: "Patient/m1" } })])).expect(201));
      let view: ImportView = (await review().get(`/${id}`).expect(200)).body;
      expect((await review().post(`/${id}/register-patient`, { version: view.version }).expect(403)).body.error.code).toBeDefined();
      view = (await review(admin).post(`/${id}/register-patient`, { version: view.version }).expect(200)).body;
      expect(view.patientId).toEqual(expect.any(String));
      const detail = await ctx.http().get(`/api/v1/patients/${view.patientId}`).set(as(admin, tenant.facilityId)).expect(200);
      expect(detail.body).toMatchObject({ familyName: "Santos", givenName: "Maria Clara", sex: "female", birthDate: "1991-11-20" });
      expect(await auditRows(ctx.pool, "action = 'patient.register' AND patient_id = $1", [view.patientId])).toHaveLength(1);
    });

    it("applies the duplicate review: a likely duplicate is refused unless reviewed with a reason", async () => {
      const id = importIdOf(await receive(bundle("register-2", [{ ...maria, identifier: [] }])).expect(201));
      const view: ImportView = (await review(admin).get(`/${id}`).expect(200)).body;
      const refused = await review(admin).post(`/${id}/register-patient`, { version: view.version }).expect(409);
      expect(refused.body.error.code).toBe("possible_duplicates");
    });
  });

  describe("rejecting and retention", () => {
    it("rejects a whole import with a reason; its sealed content is deleted 30 days later", async () => {
      const id = importIdOf(await receive(bundle("reject-1", [patient, condition])).expect(201));
      let view: ImportView = (await review().get(`/${id}`).expect(200)).body;
      await review().post(`/${id}/reject`, { reason: "no", version: view.version }).expect(400);
      view = (await review().post(`/${id}/reject`, { reason: "Not our patient", version: view.version }).expect(200)).body;
      expect(view.status).toBe("rejected");
      expect(view.entries.every((e) => e.outcome === "rejected")).toBe(true);
      expect((await auditRows(ctx.pool, "action = 'fhir.import.reject' AND resource_id = $1", [id]))[0]).toMatchObject({ reason: "Not our patient" });

      const retention = underPlatform(ctx.app.get(FhirImportRetention));
      expect(await retention.purge()).toBe(0);
      await ctx.pool.query(`UPDATE fhir_import SET completed_at = now() - interval '31 days' WHERE id = $1`, [id]);
      expect(await retention.purge()).toBe(1);
      const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM fhir_import_content WHERE import_id = $1`, [id]);
      expect(rows[0].n).toBe(0);
      view = (await review().get(`/${id}`).expect(200)).body;
      expect(view).toMatchObject({ status: "rejected", contentPurged: true });
      expect(view.entries.every((e) => e.item === null && e.outcome === "rejected")).toBe(true);
      expect(await auditRows(ctx.pool, "action = 'fhir.import.purge' AND resource_id = $1", [id])).toHaveLength(1);
    });
  });
});
