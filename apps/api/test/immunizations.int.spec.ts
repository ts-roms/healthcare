import { randomBytes, randomUUID } from "node:crypto";
import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Bakuna-sa-tamang-oras-2026";
const KEY = randomBytes(32).toString("base64");

interface Immunization {
  id: string;
  patientId: string;
  status: string;
  source: string;
  vaccineName: string;
  occurrence: string;
  occurrencePrecision: string;
  lotNumber: string | null;
  expiryDate: string | null;
  performerName: string | null;
  notes: string | null;
  stock: { returned: boolean } | null;
  enteredInError: { reason: string } | null;
  sourceReference: string | null;
  adverseReaction: string | null;
}

/**
 * Immunization history (docs/domains/immunizations.md): the organization's own vaccine catalogue, doses given here
 * (optionally from stock, in the same transaction), not given, reported and imported; immutable records corrected by
 * entered in error (stock back once); read through merged records; in the timeline, Patient 360, FHIR, MyHealth and the
 * copy of the record.
 */
describe("immunizations", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let cashier: string;
  let officer: string;
  let outsider: string;
  let token: string;
  let patientId: string;
  let otherPatientId: string;
  const ids: Record<string, string> = {};

  const staff = (t: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(t, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(t, tenant.facilityId)).send(body),
  });
  const portal = {
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` }),
    post: (url: string, body: object = {}) =>
      ctx
        .http()
        .post(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` })
        .send(body),
  };
  const stockOf = async (lotNumber: string): Promise<number> =>
    Number(
      (
        await ctx.pool.query(
          `SELECT coalesce(sum(b.quantity), 0) AS q FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id WHERE b.location_id = $1 AND l.lot_number = $2`,
          [ids.location, lotNumber],
        )
      ).rows[0].q,
    );
  const history = async (id = patientId): Promise<Immunization[]> => (await staff(nurse).get(`/patients/${id}/immunizations`).expect(200)).body;
  const events = async (type: string) =>
    (await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = $1 AND organization_id = $2`, [type, tenant.organizationId])).rows.map(
      (r) => r.payload as Record<string, unknown>,
    );

  beforeAll(async () => {
    ctx = await createTestApp({}, { INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ k1: KEY }), INTEGRATION_PAYLOAD_KEY_ID: "k1" });
    tenant = await createTenant(ctx.pool, "imm-org");
    const other = await createTenant(ctx.pool, "imm-other");
    await createStaff(ctx.pool, tenant, "admin@imm.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@imm.ph", ["physician"]);
    await createClinician(ctx, tenant, "nurse@imm.ph", ["nurse"], "nurse");
    await createStaff(ctx.pool, tenant, "cashier@imm.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "records@imm.ph", ["records_officer"]);
    await createStaff(ctx.pool, other, "admin@imm-other.ph", ["org_admin"]);
    [admin, doctor, nurse, cashier, officer] = await Promise.all(
      ["admin", "doctor", "nurse", "cashier", "records"].map(async (u) => (await login(ctx, `${u}@imm.ph`)).accessToken),
    );
    outsider = (await login(ctx, "admin@imm-other.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
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

    // Vaccine stock in the clinic's refrigerator, and a medicine kept beside it (never given as a dose).
    const inv = async (url: string, body: object) => (await staff(admin).post(`/inventory${url}`, body).expect(201)).body;
    ids.location = (await inv("/locations", { facilityId: tenant.facilityId, code: "vaccine-fridge", name: "Vaccine refrigerator" })).id;
    ids.fluItem = (await inv("/items", { code: "flu-vial", name: "Influenza vaccine vial", category: "vaccine", stockUnit: "vial" })).id;
    ids.medicine = (await inv("/items", { code: "paracetamol", name: "Paracetamol 500 mg", category: "medicine", stockUnit: "tablet" })).id;
    const receive = (itemId: string, lotNumber: string, days: number, quantity: number) =>
      inv("/receipts", { locationId: ids.location, itemId, lotNumber, expiryDate: manilaDate(days), quantity, idempotencyKey: randomUUID() });
    await receive(ids.fluItem, "FL-1", 200, 5);
    await receive(ids.medicine, "PCM-1", 200, 50);
    ids.encounter = (await staff(doctor).post("/encounters", { patientId, chiefComplaint: "Annual check-up" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("keeps the organization's own vaccine catalogue (clinic.configure), readable by clinical staff", async () => {
    const vaccine = {
      name: "Influenza vaccine",
      productName: "Quadrivalent",
      code: "FLU-Q",
      routes: ["Intramuscular", " intramuscular "],
      sites: ["Left deltoid", "Right deltoid"],
    };
    await staff(nurse).post("/immunizations/catalog", vaccine).expect(403);
    await staff(admin)
      .post("/immunizations/catalog", { ...vaccine, name: "x" })
      .expect(400);
    const created = await staff(admin).post("/immunizations/catalog", vaccine).expect(201);
    expect(created.body).toMatchObject({ codeSystem: "vaccine", code: "FLU-Q", routes: ["Intramuscular"], status: "active", dosesInSeries: null });
    ids.flu = created.body.id;
    await staff(admin)
      .post("/immunizations/catalog", vaccine)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("vaccine_exists"));
    ids.hepb = (await staff(admin).post("/immunizations/catalog", { name: "Hepatitis B vaccine", dosesInSeries: 3 }).expect(201)).body.id;
    const updated = await staff(admin).patch(`/immunizations/catalog/${ids.hepb}`, { manufacturer: "Example Biologics", version: 1 }).expect(200);
    expect(updated.body).toMatchObject({ manufacturer: "Example Biologics", version: 2 });
    await staff(admin).patch(`/immunizations/catalog/${ids.hepb}`, { manufacturer: "Other", version: 1 }).expect(409);

    expect((await staff(nurse).get("/immunizations/catalog").expect(200)).body.map((v: { name: string }) => v.name)).toEqual([
      "Hepatitis B vaccine",
      "Influenza vaccine",
    ]);
    await staff(cashier).get("/immunizations/catalog").expect(403);
    expect((await ctx.http().get("/api/v1/immunizations/catalog").set(as(outsider)).expect(200)).body).toEqual([]);
    const audit = await auditRows(ctx.pool, "action LIKE 'immunization.catalog.%' AND organization_id = $1", [tenant.organizationId]);
    expect(audit.map((a) => a.action).sort()).toEqual(["immunization.catalog.create", "immunization.catalog.create", "immunization.catalog.update"]);
  });

  it("records a dose given from stock in the same transaction: the lot is the stock lot, and only vaccines are taken", async () => {
    const lots = (await staff(nurse).get("/immunizations/stock").expect(200)).body as Array<{ lotId: string; lotNumber: string; quantity: number }>;
    expect(lots.map((l) => [l.lotNumber, l.quantity])).toEqual([["FL-1", 5]]);
    ids.lot = lots[0]!.lotId;
    const medicineLot = (await ctx.pool.query(`SELECT id FROM inventory_lot WHERE lot_number = 'PCM-1' AND organization_id = $1`, [tenant.organizationId]))
      .rows[0].id as string;

    const dose = {
      vaccineId: ids.flu,
      encounterId: ids.encounter,
      doseNumber: 1,
      route: "Intramuscular",
      site: "Left deltoid",
      doseQuantity: 0.5,
      doseUnit: "mL",
      notes: "Given after the consultation",
    };
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...dose, stock: { locationId: ids.location, lotId: medicineLot } })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("item_category_not_allowed"));
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...dose, route: "Oral", stock: { locationId: ids.location, lotId: ids.lot } })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("route_not_listed"));
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...dose, lotNumber: "OTHER", stock: { locationId: ids.location, lotId: ids.lot } })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("lot_mismatch"));
    expect(await stockOf("FL-1")).toBe(5);
    expect(await stockOf("PCM-1")).toBe(50);
    await staff(cashier)
      .post(`/patients/${patientId}/immunizations`, { ...dose, lotNumber: "X" })
      .expect(403);

    const given = await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...dose, stock: { locationId: ids.location, lotId: ids.lot } })
      .expect(201);
    expect(given.body).toMatchObject({
      status: "completed",
      source: "administered_here",
      vaccineName: "Influenza vaccine",
      vaccineProduct: "Quadrivalent",
      lotNumber: "FL-1",
      expiryDate: manilaDate(200),
      occurrencePrecision: "time",
      dose: "Dose 1",
      performerName: "Dr. nurse",
      facility: { id: tenant.facilityId },
      encounterId: ids.encounter,
      stock: { quantity: 1, returned: false },
      recordedByName: expect.any(String),
    });
    ids.stockDose = given.body.id;
    expect(await stockOf("FL-1")).toBe(4);
    const movements = await ctx.pool.query(`SELECT kind, source_type, quantity FROM inventory_movement WHERE source_id = $1`, [ids.stockDose]);
    expect(movements.rows).toEqual([{ kind: "issue", source_type: "immunization", quantity: -1 }]);
    const [event] = await events("ImmunizationRecorded");
    expect(event).toEqual({ immunizationId: ids.stockDose, vaccineId: ids.flu, encounterId: ids.encounter, source: "administered_here", status: "completed" });
  });

  it("records a dose given without stock: a lot number is required, the expiry is not before the day given, and no future date", async () => {
    const base = { vaccineId: ids.hepb, doseNumber: 2 };
    await staff(nurse).post(`/patients/${patientId}/immunizations`, base).expect(400);
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...base, lotNumber: "HB-7", occurrence: manilaDate(-1), expiryDate: manilaDate(-2) })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("lot_expired"));
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...base, lotNumber: "HB-7", occurrence: manilaDate(2) })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("occurrence_in_future"));
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...base, lotNumber: "HB-7", occurrence: "2026-05" })
      .expect(400);
    // The facility is required for a dose given here.
    await ctx
      .http()
      .post(`/api/v1/patients/${patientId}/immunizations`)
      .set(as(nurse))
      .send({ ...base, lotNumber: "HB-7" })
      .expect(400);
    const given = await staff(nurse)
      .post(`/patients/${patientId}/immunizations`, { ...base, lotNumber: "HB-7", expiryDate: manilaDate(30), occurrence: manilaDate(-1) })
      .expect(201);
    expect(given.body).toMatchObject({ occurrence: manilaDate(-1), occurrencePrecision: "day", lotNumber: "HB-7", stock: null });
    ids.hepbDose = given.body.id;
    // The database holds the same rules.
    await expect(
      ctx.pool.query(
        `INSERT INTO immunization (organization_id, patient_id, facility_id, vaccine_id, vaccine_name, occurrence_date, occurrence_precision, status, source, recorded_by, expiry_date)
         SELECT $1, $2, $3, $4, 'X', DATE '2026-09-01', 'day', 'completed', 'administered_here', recorded_by, DATE '2026-08-01' FROM immunization WHERE id = $5`,
        [tenant.organizationId, patientId, tenant.facilityId, ids.hepb, ids.hepbDose],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("records a dose not given with the clinician's reason", async () => {
    await staff(doctor).post(`/patients/${patientId}/immunizations`, { vaccineId: ids.hepb, status: "not_done", notDoneReason: "other" }).expect(400);
    const notGiven = await staff(doctor)
      .post(`/patients/${patientId}/immunizations`, {
        vaccineId: ids.hepb,
        status: "not_done",
        notDoneReason: "contraindicated",
        notDoneReasonText: "Febrile today; defer",
        encounterId: ids.encounter,
      })
      .expect(201);
    expect(notGiven.body).toMatchObject({ status: "not_done", notDoneReason: "contraindicated", notDoneReasonText: "Febrile today; defer", lotNumber: null });
    ids.notGiven = notGiven.body.id;
  });

  it("records a reported dose with a partial date, where the information comes from and an uploaded scan", async () => {
    ids.scan = randomUUID();
    ids.otherScan = randomUUID();
    for (const [id, patient] of [
      [ids.scan, patientId],
      [ids.otherScan, otherPatientId],
    ] as const) {
      await ctx.pool.query(
        `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, created_by, scan_status, scanned_at)
         SELECT $1, $2, $3, $4, 'clinical_attachment', 'Vaccination card', 'card.jpg', 'image/jpeg', 1000, $5, 'available', now(), id, 'not_scanned', now() FROM app_user LIMIT 1`,
        [id, tenant.organizationId, tenant.facilityId, patient, `org/${tenant.organizationId}/documents/${id}`],
      );
    }
    const reported = {
      vaccineName: "Measles-containing vaccine",
      occurrence: "2019",
      doseLabel: "Booster",
      givenBy: "Barangay health station",
      sourceDescription: "Vaccination card",
    };
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations/historical`, { ...reported, documentId: ids.otherScan })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_not_of_patient"));
    await staff(nurse)
      .post(`/patients/${patientId}/immunizations/historical`, { ...reported, occurrence: "childhood" })
      .expect(400);
    const recorded = await staff(nurse)
      .post(`/patients/${patientId}/immunizations/historical`, { ...reported, documentId: ids.scan })
      .expect(201);
    expect(recorded.body).toMatchObject({
      source: "historical",
      status: "completed",
      occurrence: "2019",
      occurrencePrecision: "year",
      occurrenceDate: "2019-01-01",
      vaccineId: null,
      performerName: "Barangay health station",
      sourceDescription: "Vaccination card",
      documentId: ids.scan,
      facility: null,
    });
    ids.reported = recorded.body.id;
    // Another organization cannot record for this patient.
    await ctx.http().post(`/api/v1/patients/${patientId}/immunizations/historical`).set(as(outsider)).send(reported).expect(404);
  });

  it("adds a reaction once, and a mistake is marked entered in error: stock goes back once, nothing is deleted or rewritten", async () => {
    await staff(nurse).post(`/immunizations/${ids.notGiven}/reaction`, { adverseReaction: "Rash" }).expect(422);
    await staff(nurse).post(`/immunizations/${ids.stockDose}/reaction`, { adverseReaction: "Soreness at the site" }).expect(200);
    await staff(nurse)
      .post(`/immunizations/${ids.stockDose}/reaction`, { adverseReaction: "Fever" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("reaction_recorded"));

    await staff(cashier).post(`/immunizations/${ids.stockDose}/entered-in-error`, { reason: "Wrong patient" }).expect(403);
    await staff(nurse).post(`/immunizations/${ids.stockDose}/entered-in-error`, { reason: "x" }).expect(400);
    const marked = await staff(nurse).post(`/immunizations/${ids.stockDose}/entered-in-error`, { reason: "Recorded on the wrong patient" }).expect(200);
    expect(marked.body).toMatchObject({ enteredInError: { reason: "Recorded on the wrong patient" }, stock: { returned: true } });
    expect(await stockOf("FL-1")).toBe(5);
    await staff(nurse)
      .post(`/immunizations/${ids.stockDose}/entered-in-error`, { reason: "Again" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("already_entered_in_error"));
    expect(await stockOf("FL-1")).toBe(5);
    const movements = await ctx.pool.query(`SELECT kind FROM inventory_movement WHERE source_id = $1 ORDER BY kind`, [ids.stockDose]);
    expect(movements.rows.map((m) => m.kind)).toEqual(["issue", "return"]);

    await expect(ctx.pool.query("UPDATE immunization SET lot_number = 'Z' WHERE id = $1", [ids.hepbDose])).rejects.toThrow(/only marking entered in error/);
    await expect(ctx.pool.query("DELETE FROM immunization WHERE id = $1", [ids.hepbDose])).rejects.toThrow(/never deleted/);
    expect((await events("ImmunizationEnteredInError")).map((e) => e["immunizationId"])).toEqual([ids.stockDose]);
    // Events carry ids, never clinical text.
    for (const e of await events("ImmunizationRecorded")) expect(JSON.stringify(e)).not.toMatch(/Influenza|Measles|Febrile/);
  });

  it("lists the history (latest first, entries in error marked) to clinical staff only, audited", async () => {
    const list = await history();
    expect(list.map((i) => i.id)).toEqual([ids.notGiven, ids.stockDose, ids.hepbDose, ids.reported]);
    expect(list[1]).toMatchObject({ enteredInError: { reason: "Recorded on the wrong patient" }, adverseReaction: "Soreness at the site" });
    await staff(cashier).get(`/patients/${patientId}/immunizations`).expect(403);
    await ctx.http().get(`/api/v1/patients/${patientId}/immunizations`).set(as(outsider)).expect(404);
    expect((await staff(doctor).get(`/encounters/${ids.encounter}/immunizations`).expect(200)).body.map((i: Immunization) => i.id)).toEqual([
      ids.notGiven,
      ids.stockDose,
    ]);
    const audit = await auditRows(ctx.pool, "action = 'immunization.view' AND patient_id = $1", [patientId]);
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const recorded = await auditRows(ctx.pool, "action = 'immunization.record' AND patient_id = $1", [patientId]);
    expect(recorded).toHaveLength(4);
  });

  it("refuses new doses under a merged record and reads the retired record's doses with the survivor", async () => {
    ids.otherDose = (
      await staff(nurse)
        .post(`/patients/${otherPatientId}/immunizations/historical`, { vaccineId: ids.hepb, occurrence: "2020-03", sourceDescription: "Patient's booklet" })
        .expect(201)
    ).body.id;
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
    await staff(nurse)
      .post(`/patients/${otherPatientId}/immunizations/historical`, { vaccineId: ids.hepb, occurrence: "2021", sourceDescription: "Card" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("patient_merged"));
    const list = await history();
    expect(list.find((i) => i.id === ids.otherDose)).toMatchObject({ patientId: otherPatientId, occurrence: "2020-03" });
  });

  it("shows in the timeline, Patient 360 and the FHIR export without notes", async () => {
    const timeline = (await staff(doctor).get(`/patients/${patientId}/timeline?kinds=immunization`).expect(200)).body;
    const titles = timeline.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Immunization given: Influenza vaccine",
        "Immunization not given: Hepatitis B vaccine",
        "Immunization reported: Measles-containing vaccine",
      ]),
    );
    const inError = timeline.items.find((i: { sourceIds: { immunizationId: string } }) => i.sourceIds.immunizationId === ids.stockDose);
    expect(inError).toMatchObject({ marker: "entered_in_error", link: { type: "patient_immunizations", id: patientId } });
    const merged = timeline.items.find((i: { sourceIds: { immunizationId: string } }) => i.sourceIds.immunizationId === ids.otherDose);
    expect(merged.filedUnder).toEqual(expect.any(String));
    expect(JSON.stringify(timeline)).not.toMatch(/Febrile|after the consultation|Soreness/);
    expect((await staff(cashier).get(`/patients/${patientId}/timeline`).expect(200)).body.withheld).toContain("immunization");

    const workspace = (await staff(doctor).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(workspace.immunizations.map((i: { id: string }) => i.id)).not.toContain(ids.stockDose);
    expect(workspace.immunizations.find((i: { id: string }) => i.id === ids.reported)).toMatchObject({
      vaccineName: "Measles-containing vaccine",
      dose: "Booster",
      occurrence: "2019",
      source: "historical",
      filedUnder: null,
    });
    expect(JSON.stringify(workspace.immunizations)).not.toMatch(/Febrile|after the consultation/);
    const forCashier = (await staff(cashier).get(`/patients/${patientId}/workspace`).expect(200)).body;
    expect(forCashier.immunizations).toBeNull();
    expect(forCashier.withheld).toContain("immunizations");

    const search = (await staff(admin).get(`/fhir/r4/Immunization?patient=${patientId}`).expect(200)).body;
    const byId = new Map(search.entry.map((e: { resource: { id: string } }) => [e.resource.id, e.resource]));
    expect(byId.get(ids.stockDose)).toMatchObject({ status: "entered-in-error", primarySource: true, lotNumber: "FL-1" });
    expect(byId.get(ids.notGiven)).toMatchObject({ status: "not-done", statusReason: { coding: [{ code: "MEDPREC" }], text: "Febrile today; defer" } });
    expect(byId.get(ids.reported)).toMatchObject({
      status: "completed",
      primarySource: false,
      occurrenceDateTime: "2019",
      reportOrigin: { text: "Vaccination card" },
    });
    expect(byId.get(ids.otherDose)).toMatchObject({ occurrenceDateTime: "2020-03" });
    expect(JSON.stringify(search)).not.toMatch(/after the consultation/);
    const everything = (await staff(admin).get(`/fhir/r4/Patient/${patientId}/$everything?_count=200`).expect(200)).body;
    expect(everything.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType === "Immunization")).toHaveLength(5);
    const metadata = (await staff(admin).get("/fhir/r4/metadata").expect(200)).body;
    expect(metadata.rest[0].resource.map((r: { type: string }) => r.type)).toContain("Immunization");
  });

  it("accepts an imported Immunization as an immunization record with its external source (not external history)", async () => {
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
            resourceType: "Immunization",
            status: "completed",
            vaccineCode: { coding: [{ system: "http://example.org/codes", code: "TD", display: "Tetanus-diphtheria vaccine" }] },
            patient: { reference: "urn:uuid:p1" },
            occurrenceDateTime: "2021-05",
            primarySource: false,
            reportOrigin: { text: "Previous clinic" },
            lotNumber: "TD-22",
          },
        },
      ],
    };
    const received = await ctx
      .http()
      .post("/api/v1/fhir/r4/imports")
      .set(as(admin, tenant.facilityId))
      .set("content-type", "application/fhir+json")
      .set("idempotency-key", `imm-${randomUUID()}`)
      .send(JSON.stringify(bundle))
      .expect(201);
    const importId = received.body.issue[0].details.coding[0].code as string;
    const review = (url: string, body: object = {}) => ctx.http().post(`/api/v1/fhir-imports${url}`).set(as(officer, tenant.facilityId)).send(body);
    let view = (await ctx.http().get(`/api/v1/fhir-imports/${importId}`).set(as(officer, tenant.facilityId)).expect(200)).body;
    const entry = view.entries.find((e: { resourceType: string }) => e.resourceType === "Immunization");
    expect(entry).toMatchObject({ kind: "immunization", becomes: "immunization", item: { vaccine: "Tetanus-diphtheria vaccine", acceptable: true } });
    view = (await review(`/${importId}/match`, { patientId, version: view.version }).expect(200)).body;
    view = (await review(`/${importId}/entries/${entry.id}/accept`).expect(200)).body;
    const accepted = view.entries.find((e: { id: string }) => e.id === entry.id);
    expect(accepted).toMatchObject({ outcome: "accepted", resultType: "immunization" });
    ids.imported = accepted.resultId;
    const imported = (await history()).find((i) => i.id === ids.imported);
    expect(imported).toMatchObject({
      source: "external_import",
      vaccineName: "Tetanus-diphtheria vaccine",
      occurrence: "2021-05",
      lotNumber: "TD-22",
      sourceReference: `fhir-import:${importId}#1`,
    });
    const external = await ctx.pool.query(`SELECT count(*)::int AS n FROM external_history_entry WHERE patient_id = $1`, [patientId]);
    expect(external.rows[0].n).toBe(0);
    const fhirImported = (await staff(admin).get(`/fhir/r4/Immunization?patient=${patientId}`).expect(200)).body.entry.find(
      (e: { resource: { id: string } }) => e.resource.id === ids.imported,
    ).resource;
    expect(fhirImported.meta.tag[0].code).toBe("external-import");
  });

  it("shows the patient their doses in MyHealth, and the copy of the record includes the immunization history", async () => {
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string }>("SELECT patient_number FROM patient WHERE id = $1", [patientId]);
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "imm-org",
        patientNumber: rows[0]!.patient_number,
        birthDate: juan.birthDate,
        activationCode: code,
        email: "juan@imm.ph",
        password: PASSWORD,
      })
      .expect(200);
    token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "imm-org", email: "juan@imm.ph", password: PASSWORD }).expect(200))
      .body.accessToken;

    const mine = (await portal.get("/immunizations").expect(200)).body as Array<Record<string, unknown>>;
    // Given, reported and imported doses; not the dose not given or the entry in error.
    expect(mine.map((i) => i["id"]).sort()).toEqual([ids.hepbDose, ids.reported, ids.otherDose, ids.imported].sort());
    expect(mine.find((i) => i["id"] === ids.hepbDose)).toEqual({
      id: ids.hepbDose,
      vaccineName: "Hepatitis B vaccine",
      vaccineProduct: null,
      dose: "Dose 2",
      occurrence: manilaDate(-1),
      occurrencePrecision: "day",
      source: "administered_here",
      where: expect.any(String),
    });
    expect(JSON.stringify(mine)).not.toMatch(/notes|lotNumber|Febrile/);
    expect(await auditRows(ctx.pool, "action = 'portal.immunizations-view' AND patient_id = $1", [patientId])).toHaveLength(1);

    const requestId = (await portal.post("/records-requests", { scope: ["other"], purpose: "School enrolment", details: "Vaccination record" }).expect(201))
      .body.id;
    const copy = await staff(officer)
      .post(`/records-requests/${requestId}/copies`, { sections: ["immunizations"] })
      .expect(201);
    expect(copy.body.sections).toEqual(["immunizations"]);
    const text = extractPdfText(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${copy.body.documentId}`)!)
      .replace(/·/g, "")
      .replace(/\s+/g, " ");
    for (const expected of [
      "Immunizations",
      "Hepatitis B vaccine",
      "HB-7",
      "Measles-containing vaccine",
      "2019",
      "Reported",
      "Not given (contraindicated)",
      "From another provider",
    ]) {
      expect(text).toContain(expected);
    }
    // The entry in error is left out.
    expect(text).not.toContain("FL-1");
    expect(text).not.toContain("Febrile");
  });
});
