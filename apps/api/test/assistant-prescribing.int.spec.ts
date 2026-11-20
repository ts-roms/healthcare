import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  severity: string;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; value?: string }>;
  action?: { href: string };
}

/**
 * The organization's medicine settings (migration 0156) and the assistant's prescribing rules (docs/domains/assistant.md):
 * a prescription being written is checked before it is issued against the patient's earlier prescriptions and those
 * settings. Off until turned on; it blocks and changes nothing; the audit holds rule ids, never a medicine.
 */
describe("prescribing checks", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let nurse: string;
  let patientId: string;
  let encounterId: string;
  let ibuprofenRx: { id: string; prescriptionNumber: string };

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const turnOn = (ruleId: string) => api(admin).put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
  const check = async (token: string, medicines: object[], extra: object = {}) =>
    (
      await api(token)
        .post("/assistant/suggestions/check", { surface: "prescribing", encounterId, medicines, ...extra })
        .expect(200)
    ).body as {
      items: Suggestion[];
      withheld: Array<{ ruleId: string }>;
    };
  /** A prescription line, with the fields the prescribing rules compare typed. */
  interface Line {
    genericName: string;
    frequency: string;
    strength?: string;
    doseAmount?: number;
    doseUnit?: string;
    [field: string]: unknown;
  }
  const item = (genericName: string, values: Partial<Line> = {}): Line => ({
    genericName,
    route: "oral",
    frequency: "three_times_daily",
    quantity: 21,
    quantityUnit: "tablets",
    instructions: "After meals",
    ...values,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-rx");
    await createStaff(ctx.pool, tenant, "admin@rx.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@rx.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "nurse@rx.ph", ["nurse"]);
    admin = (await login(ctx, "admin@rx.ph")).accessToken;
    doctor = (await login(ctx, "doctor@rx.ph")).accessToken;
    nurse = (await login(ctx, "nurse@rx.ph")).accessToken;
    patientId = (
      await api(admin)
        .post("/patients", { ...juan, identifiers: [], familyName: "Garcia", givenName: "Liza", sex: "female", birthDate: "1996-05-05" })
        .expect(201)
    ).body.id;
    encounterId = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Knee pain" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("keeps the organization's own medicine settings, one per medicine, versioned and audited", async () => {
    const metformin = (await api(admin).post("/prescribing/medicines", { name: "Metformin HCl", checkRenal: true, note: "Look at the last eGFR" }).expect(201))
      .body;
    expect(metformin).toMatchObject({ name: "Metformin HCl", checkRenal: true, checkPregnancy: false, maxDailyDose: null, status: "active", version: 1 });
    // The same medicine written another way is the same setting.
    await api(admin)
      .post("/prescribing/medicines", { name: "metformin  HCL 500 mg tablet", className: "Biguanide" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("duplicate_medicine_setting"));
    await api(admin).post("/prescribing/medicines", { name: "Paracetamol", maxDailyDose: 4000 }).expect(400);
    await api(admin).post("/prescribing/medicines", { name: "Paracetamol" }).expect(400);
    await api(admin).post("/prescribing/medicines", { name: "Paracetamol", maxDailyDose: 4000, doseUnit: "mg" }).expect(201);
    await api(admin).post("/prescribing/medicines", { name: "Ibuprofen", className: "NSAID", maxDailyDose: 3200, doseUnit: "mg" }).expect(201);
    await api(admin).post("/prescribing/medicines", { name: "Naproxen", className: "NSAID" }).expect(201);
    await api(admin).post("/prescribing/medicines", { name: "Isotretinoin", checkPregnancy: true }).expect(201);

    // Doctors read them; changing them needs clinic.configure.
    expect((await api(doctor).get("/prescribing/medicines").expect(200)).body.map((m: { name: string }) => m.name)).toEqual([
      "Ibuprofen",
      "Isotretinoin",
      "Metformin HCl",
      "Naproxen",
      "Paracetamol",
    ]);
    await api(doctor).post("/prescribing/medicines", { name: "Codeine", checkRenal: true }).expect(403);

    const update = { name: "Metformin HCl", checkRenal: true, note: "Look at the last eGFR and creatinine", status: "active", version: 1 };
    expect((await api(admin).put(`/prescribing/medicines/${metformin.id}`, update).expect(200)).body).toMatchObject({ version: 2 });
    await api(admin).put(`/prescribing/medicines/${metformin.id}`, update).expect(409);
    const audit = await auditRows(ctx.pool, "action LIKE 'prescription.medicine-setting.%' AND resource_id = $1", [metformin.id]);
    expect(audit.map((a) => a.action).sort()).toEqual(["prescription.medicine-setting.create", "prescription.medicine-setting.update"]);
  });

  it("checks a prescription before it is issued, only with the rules turned on, and blocks nothing", async () => {
    ibuprofenRx = (
      await api(doctor)
        .post("/prescriptions", {
          encounterId,
          items: [item("Ibuprofen", { strength: "400 mg", doseAmount: 1, doseUnit: "tablet", durationValue: 7, durationUnit: "days" })],
        })
        .expect(201)
    ).body;
    const draft = [
      item("Naproxen sodium", { strength: "550 mg", doseAmount: 1, doseUnit: "tablet", frequency: "twice_daily" }),
      item("Paracetamol", { strength: "500 mg", doseAmount: 2, doseUnit: "tablets", frequency: "every_4_hours" }),
      item("Isotretinoin", { frequency: "once_daily" }),
    ];
    const medicines = draft.map(({ genericName, strength, doseAmount, doseUnit, frequency }) => ({ genericName, strength, doseAmount, doseUnit, frequency }));
    expect((await check(doctor, medicines)).items).toEqual([]);

    await turnOn("prescription.duplicate-therapy");
    await turnOn("prescription.dose-limit");
    await turnOn("prescription.check-prompts");
    const found = (await check(doctor, medicines)).items;
    expect(found.map((s) => [s.ruleId, s.severity, s.title])).toEqual([
      [
        "prescription.duplicate-therapy",
        "warning",
        expect.stringMatching(
          new RegExp(
            `^Naproxen sodium and Ibuprofen are both NSAID \\(your organization's class\\): ${ibuprofenRx.prescriptionNumber} \\(\\d{4}-\\d{2}-\\d{2}\\)$`,
          ),
        ),
      ],
      ["prescription.dose-limit", "warning", "Paracetamol: 6,000 mg a day, above your organization's maximum of 4,000 mg"],
      ["prescription.check-prompts", "advice", "Isotretinoin: check whether the patient may be pregnant before prescribing"],
    ]);
    expect(found.every((s) => s.action === undefined)).toBe(true);

    // A nurse may use the assistant but does not prescribe: the rules are withheld, without findings.
    const theirs = await check(nurse, medicines);
    expect(theirs.items).toEqual([]);
    expect(theirs.withheld.map((w) => w.ruleId).sort()).toEqual(["prescription.check-prompts", "prescription.dose-limit", "prescription.duplicate-therapy"]);

    // Nothing is blocked: the same prescription is issued as written.
    await api(doctor).post("/prescriptions", { encounterId, items: draft }).expect(201);
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'prescribing'");
    expect(audit.map((a) => a.metadata)).toContainEqual(
      expect.objectContaining({
        encounterId,
        medicines: 3,
        rules: ["prescription.duplicate-therapy", "prescription.dose-limit", "prescription.check-prompts"],
      }),
    );
    expect(JSON.stringify(audit)).not.toMatch(/Naproxen|Paracetamol|Isotretinoin/i);
  });

  it("leaves the prescription being replaced out, and answers 404 for a consultation it cannot find", async () => {
    const ibuprofen = [{ genericName: "Ibuprofen", strength: "400 mg", doseAmount: 1, doseUnit: "tablet", frequency: "three_times_daily" }];
    const duplicates = async (extra: object = {}) =>
      (await check(doctor, ibuprofen, extra)).items.filter((s) => s.ruleId === "prescription.duplicate-therapy").map((s) => s.title);
    expect(await duplicates()).toEqual([expect.stringMatching(new RegExp(`^Ibuprofen is already prescribed: ${ibuprofenRx.prescriptionNumber} `))]);
    // Replacing that prescription: it is left out, and the naproxen issued since still counts (same class).
    expect(await duplicates({ replacesPrescriptionId: ibuprofenRx.id })).toEqual([
      expect.stringMatching(/^Ibuprofen and Naproxen sodium are both NSAID \(your organization's class\): /),
    ]);
    await api(doctor)
      .post("/assistant/suggestions/check", { surface: "prescribing", encounterId: "00000000-0000-4000-8000-000000000000", medicines: ibuprofen })
      .expect(404);
    // A live screen request without a draft reads nothing; a replay reads past days' prescriptions.
    expect((await api(doctor).get("/assistant/suggestions?surface=prescribing").expect(200)).body.items).toEqual([]);
    const replay = (await api(admin).post("/assistant/rules/prescription.dose-limit/replay", { days: 2 }).expect(200)).body;
    expect(replay).toMatchObject({ readAt: "23:59" });
    expect(replay.days).toHaveLength(2);
  });
});
