import { extractPdfText } from "@healthcare/pdf";
import {
  as,
  auditRows,
  binary,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

const PATIENT_PASSWORD = "Presyo-ng-ngipin-2026";
const ACKNOWLEDGEMENT = "I discussed this plan with my dentist and understand its options, risks and fees.";

/**
 * Dental fee estimates (docs/domains/dental.md, "Fee estimates"): the work still ahead on a plan at billing's listed
 * prices, the estimate recorded with each decision, the printed estimate, and estimates in MyHealth (opt-in).
 */
describe("dental fee estimates", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let cashier: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const setting = async (body: object) => {
    const current = (await staff(admin).get("/dental/settings/portal").expect(200)).body;
    return (
      await staff(admin)
        .put("/dental/settings/portal", { portalDentalRecords: true, ...body, version: current.version })
        .expect(200)
    ).body;
  };
  const plan = async (items: Array<{ type: string; tooth?: string; surfaces?: string[] }>) =>
    (
      await staff(dentist)
        .post("/dental/treatment-plans", {
          patientId,
          title: "Restorative plan",
          items: items.map((i) => ({ procedureTypeId: ids[i.type], tooth: i.tooth, surfaces: i.surfaces ?? [] })),
        })
        .expect(201)
    ).body as { id: string; version: number; items: Array<{ id: string; procedureTypeId: string }> };
  const itemRows = async (planId: string) =>
    (
      await ctx.pool.query<{ code: string; status: string; decision_estimate: string | null; decision_estimate_on: string | null }>(
        `SELECT t.code, i.status, i.decision_estimate, to_char(i.decision_estimate_on, 'YYYY-MM-DD') AS decision_estimate_on
         FROM dental_treatment_plan_item i JOIN dental_procedure_type t ON t.id = i.procedure_type_id WHERE i.plan_id = $1 ORDER BY t.code`,
        [planId],
      )
    ).rows;
  const portalToken = async () =>
    (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "smile-estimates", email: "juan@estimates.ph", password: PATIENT_PASSWORD })
        .expect(200)
    ).body.accessToken as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "smile-estimates");
    await createStaff(ctx.pool, tenant, "admin@estimates.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@estimates.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "cashier@estimates.ph", ["cashier"]);
    admin = (await login(ctx, "admin@estimates.ph")).accessToken;
    dentist = (await login(ctx, "dentist@estimates.ph")).accessToken;
    cashier = (await login(ctx, "cashier@estimates.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;

    for (const [code, name, site] of [
      ["composite", "Composite restoration", "surface"],
      ["extraction", "Extraction", "tooth"],
      ["sealant", "Pit and fissure sealant", "tooth"],
    ] as const) {
      ids[code] = (await staff(admin).post("/dental/procedure-types", { code, name, site }).expect(201)).body.id;
    }
    // Billing's price list: composite and extraction are mapped and priced; the sealant is not.
    ids.compositeService = (
      await staff(admin)
        .post("/billing/services", {
          code: "d-composite",
          name: "Composite restoration (per surface set)",
          category: "dental",
          sourceKind: "dental_procedure",
          sourceCode: "composite",
          unitPrice: 150_000,
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body.id;
    await staff(admin)
      .post("/billing/services", {
        code: "d-extraction",
        name: "Simple extraction",
        category: "dental",
        sourceKind: "dental_procedure",
        sourceCode: "extraction",
        unitPrice: 80_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(201);

    // Juan uses MyHealth.
    await staff(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "smile-estimates",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@estimates.ph",
        password: PATIENT_PASSWORD,
      })
      .expect(200);
  });
  afterAll(() => ctx.close());

  it("estimates the work still ahead at billing's listed prices today, counting items without a listed price", async () => {
    const created = await plan([
      { type: "composite", tooth: "16", surfaces: ["M", "O"] },
      { type: "extraction", tooth: "48" },
      { type: "sealant", tooth: "36" },
    ]);
    ids.plan = created.id;
    const estimate = (await staff(dentist).get(`/dental/treatment-plans/${created.id}/estimate`).expect(200)).body;
    expect(estimate).toMatchObject({
      planId: created.id,
      pricedOn: manilaDate(0),
      currency: "PHP",
      totals: { awaitingDecision: 230_000, accepted: 0, remaining: 230_000, unpricedItems: 1 },
      note: null,
    });
    expect(estimate.disclaimer).toMatch(/not an invoice or official receipt/);
    const byCode = Object.fromEntries(estimate.items.map((i: { procedure: { code: string } }) => [i.procedure.code, i]));
    expect(byCode.composite).toMatchObject({ part: "awaiting", listed: { serviceCode: "d-composite", unitPrice: 150_000 }, atDecision: null });
    expect(byCode.sealant).toMatchObject({ part: "awaiting", listed: null });

    // The estimate is part of the dental record: billing staff without dental access do not read it.
    await staff(cashier).get(`/dental/treatment-plans/${created.id}/estimate`).expect(403);
    await staff(cashier).get(`/dental/treatment-plans/${created.id}/estimate.pdf`).expect(403);
  });

  it("records each item's estimate with the patient's decision, once", async () => {
    const current = (await staff(dentist).get(`/dental/treatment-plans/${ids.plan}`).expect(200)).body;
    const accept = current.items.filter((i: { procedureTypeId: string }) => i.procedureTypeId !== ids.extraction).map((i: { id: string }) => i.id);
    await staff(dentist)
      .post(`/dental/treatment-plans/${ids.plan}/decision`, { acceptedItemIds: accept, note: "Fees explained at the chair", version: current.version })
      .expect(200);
    expect(await itemRows(ids.plan)).toEqual([
      { code: "composite", status: "accepted", decision_estimate: "150000", decision_estimate_on: manilaDate(0) },
      { code: "extraction", status: "declined", decision_estimate: "80000", decision_estimate_on: manilaDate(0) },
      { code: "sealant", status: "accepted", decision_estimate: null, decision_estimate_on: manilaDate(0) },
    ]);
    const decided = (await auditRows(ctx.pool, "action = 'dental.plan.decide' AND resource_id = $1", [ids.plan]))[0];
    expect(decided?.metadata).toMatchObject({ estimatePricedOn: manilaDate(0) });

    // What was recorded with a decision does not change, and an item awaiting a decision records none.
    await expect(ctx.pool.query("UPDATE dental_treatment_plan_item SET decision_estimate = 1 WHERE plan_id = $1", [ids.plan])).rejects.toThrow(/not changed/);
    const awaiting = await plan([{ type: "composite", tooth: "26", surfaces: ["O"] }]);
    await expect(ctx.pool.query("UPDATE dental_treatment_plan_item SET decision_estimate_on = CURRENT_DATE WHERE plan_id = $1", [awaiting.id])).rejects.toThrow(
      /dental_treatment_plan_item_estimate_decided/,
    );

    // Declined items leave the estimate; accepted ones stay until done.
    const estimate = (await staff(dentist).get(`/dental/treatment-plans/${ids.plan}/estimate`).expect(200)).body;
    expect(estimate.totals).toEqual({
      awaitingDecision: 0,
      accepted: 150_000,
      remaining: 150_000,
      awaitingDecisionHigh: 0,
      acceptedHigh: 150_000,
      remainingHigh: 150_000,
      unpricedItems: 1,
    });
  });

  it("follows the price list while keeping what was recorded at the decision", async () => {
    await staff(admin)
      .post(`/billing/services/${ids.compositeService}/prices`, { unitPrice: 180_000, effectiveFrom: manilaDate(0) })
      .expect(201);
    const estimate = (await staff(dentist).get(`/dental/treatment-plans/${ids.plan}/estimate`).expect(200)).body;
    const composite = estimate.items.find((i: { procedure: { code: string } }) => i.procedure.code === "composite");
    expect(composite).toMatchObject({ listed: { unitPrice: 180_000 }, atDecision: { amount: 150_000, pricedOn: manilaDate(0) } });
    expect(estimate.totals.remaining).toBe(180_000);
  });

  it("prints the estimate for the patient with the organization's note (audited)", async () => {
    await setting({ feeEstimateNote: "Estimates hold for 30 days from printing." });
    const response = await staff(dentist).get(`/dental/treatment-plans/${ids.plan}/estimate.pdf`).buffer(true).parse(binary).expect(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    const text = extractPdfText(response.body as Buffer);
    for (const expected of [
      "Treatment Plan Fee Estimate",
      "Restorative plan",
      "Composite restoration",
      "PHP 1,800.00",
      "Ask the clinic",
      "Estimated total",
      "Estimates hold for 30 days from printing.",
      "not an invoice or official receipt",
    ]) {
      expect(text).toContain(expected);
    }
    // Declined work is not on it.
    expect(text).not.toContain("Extraction");
    const printed = await auditRows(ctx.pool, "action = 'dental.plan.estimate.print' AND resource_id = $1", [ids.plan]);
    expect(printed).toHaveLength(1);
    expect(printed[0]?.metadata).toMatchObject({ remaining: 180_000, unpricedItems: 1 });
  });

  it("keeps estimates out of MyHealth until the organization shows them, and needs dental records shown", async () => {
    await setting({ portalPlanDecisions: true, portalPlanAcknowledgement: ACKNOWLEDGEMENT });
    const token = await portalToken();
    const record = (
      await ctx
        .http()
        .get("/api/v1/portal/dental/record")
        .set({ authorization: `Bearer ${token}` })
        .expect(200)
    ).body;
    expect(record.plans.every((p: { estimate: unknown }) => p.estimate === null)).toBe(true);
    expect(JSON.stringify(record)).not.toContain("estimatedFee");

    const turnedOff = (await staff(admin).get("/dental/settings/portal").expect(200)).body;
    const off = (
      await staff(admin).put("/dental/settings/portal", { portalDentalRecords: false, portalPlanEstimates: true, version: turnedOff.version }).expect(200)
    ).body;
    expect(off).toMatchObject({ portalPlanEstimates: false, feeEstimateNote: "Estimates hold for 30 days from printing." });
    await staff(admin).put("/dental/settings/portal", { portalDentalRecords: true, feeEstimateNote: "Too short", version: off.version }).expect(400);
  });

  it("shows estimates in MyHealth when turned on, and refuses a decision taken on an estimate that has since changed", async () => {
    await setting({ portalPlanDecisions: true, portalPlanAcknowledgement: ACKNOWLEDGEMENT, portalPlanEstimates: true });
    const pending = await plan([
      { type: "composite", tooth: "27", surfaces: ["O"] },
      { type: "extraction", tooth: "38" },
    ]);
    const token = await portalToken();
    const portal = () =>
      ctx
        .http()
        .get("/api/v1/portal/dental/record")
        .set({ authorization: `Bearer ${token}` })
        .expect(200);
    const shown = (await portal()).body.plans.find((p: { id: string }) => p.id === pending.id);
    expect(shown.estimate).toMatchObject({
      pricedOn: manilaDate(0),
      awaitingDecision: 260_000,
      accepted: 0,
      remaining: 260_000,
      unpricedItems: 0,
      note: "Estimates hold for 30 days from printing.",
    });
    expect(shown.items.map((i: { estimatedFee: number }) => i.estimatedFee).sort()).toEqual([180_000, 80_000]);
    // No billing codes or service names reach the patient.
    expect(JSON.stringify(shown)).not.toMatch(/d-composite|per surface set/);

    const decide = (estimateAwaitingDecision: number | null | undefined) =>
      ctx
        .http()
        .post(`/api/v1/portal/dental/plans/${pending.id}/decision`)
        .set({ authorization: `Bearer ${token}` })
        .send({ acceptedItemIds: [pending.items[0]!.id], awaitingItemIds: pending.items.map((i) => i.id), acknowledged: true, estimateAwaitingDecision });
    // An estimate other than the current one (the prices changed since the patient looked), or none: nothing is decided.
    const changed = await decide(250_000).expect(409);
    expect(changed.body.error.code).toBe("estimate_changed");
    await decide(undefined).expect(409);
    expect((await itemRows(pending.id)).every((r) => r.status === "proposed")).toBe(true);

    await decide(260_000).expect(201);
    expect(await itemRows(pending.id)).toEqual([
      { code: "composite", status: "accepted", decision_estimate: "180000", decision_estimate_on: manilaDate(0) },
      { code: "extraction", status: "declined", decision_estimate: "80000", decision_estimate_on: manilaDate(0) },
    ]);
    const after = (await portal()).body.plans.find((p: { id: string }) => p.id === pending.id);
    expect(after.estimate).toMatchObject({ awaitingDecision: 0, accepted: 180_000, remaining: 180_000 });
  });

  it("shows a fee range when a procedure may turn out to be another, and lets the item be carried out as either", async () => {
    ids.surgical = (
      await staff(admin).post("/dental/procedure-types", { code: "surgical-extraction", name: "Surgical extraction", site: "tooth" }).expect(201)
    ).body.id;
    ids.prophylaxis = (
      await staff(admin).post("/dental/procedure-types", { code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" }).expect(201)
    ).body.id;
    await staff(admin)
      .post("/billing/services", {
        code: "d-surgical-extraction",
        name: "Surgical extraction",
        category: "dental",
        sourceKind: "dental_procedure",
        sourceCode: "surgical-extraction",
        unitPrice: 300_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(201);

    // The catalog lists what a procedure may turn out to be (dental.settings.manage).
    const alternatives = (token: string, alternativeIds: string[]) =>
      staff(token).put(`/dental/procedure-types/${ids.extraction}/alternatives`, { alternativeIds });
    await alternatives(cashier, [ids.surgical!]).expect(403);
    await alternatives(admin, [ids.extraction!])
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_alternative"));
    await alternatives(admin, [ids.prophylaxis!])
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_alternative"));
    expect((await alternatives(admin, [ids.surgical!]).expect(200)).body).toMatchObject({ code: "extraction", alternativeIds: [ids.surgical] });
    const types = (await staff(dentist).get("/dental/settings").expect(200)).body.procedureTypes;
    expect(types.find((t: { id: string }) => t.id === ids.extraction).alternativeIds).toEqual([ids.surgical]);
    expect(types.find((t: { id: string }) => t.id === ids.composite).alternativeIds).toEqual([]);
    const audit = await auditRows(ctx.pool, "action = 'dental.procedure-type.alternatives' AND resource_id = $1", [ids.extraction]);
    expect(audit[0]?.metadata).toBeNull();

    // The estimate of an extraction is the range over it and a surgical extraction.
    const ranged = await plan([
      { type: "extraction", tooth: "18" },
      { type: "composite", tooth: "25", surfaces: ["O"] },
    ]);
    const estimate = (await staff(dentist).get(`/dental/treatment-plans/${ranged.id}/estimate`).expect(200)).body;
    const extraction = estimate.items.find((i: { procedure: { code: string } }) => i.procedure.code === "extraction");
    expect(extraction).toMatchObject({
      listed: { unitPrice: 80_000 },
      range: {
        low: 80_000,
        high: 300_000,
        unpricedAlternatives: 0,
        alternatives: [{ code: "surgical-extraction", name: "Surgical extraction", unitPrice: 300_000 }],
      },
    });
    expect(estimate.items.find((i: { procedure: { code: string } }) => i.procedure.code === "composite").range).toBeNull();
    expect(estimate.totals).toMatchObject({ awaitingDecision: 260_000, awaitingDecisionHigh: 480_000, remaining: 260_000, remainingHigh: 480_000 });

    const text = extractPdfText(
      (await staff(dentist).get(`/dental/treatment-plans/${ranged.id}/estimate.pdf`).buffer(true).parse(binary).expect(200)).body as Buffer,
    );
    // Table cells wrap; compare with whitespace (and the extractor's soft-wrap marks) collapsed.
    const flat = text.replace(/·/g, "").replace(/\s+/g, " ");
    expect(flat).toContain("PHP 800.00 to PHP 3,000.00");
    expect(flat).toContain("PHP 2,600.00 to PHP 4,800.00");
    expect(flat).toContain("Extraction may become Surgical extraction");

    // MyHealth shows the range; the patient decides on both ends of it.
    const token = await portalToken();
    const shown = (
      await ctx
        .http()
        .get("/api/v1/portal/dental/record")
        .set({ authorization: `Bearer ${token}` })
        .expect(200)
    ).body.plans.find((p: { id: string }) => p.id === ranged.id);
    expect(shown.estimate).toMatchObject({ awaitingDecision: 260_000, awaitingDecisionHigh: 480_000 });
    const shownExtraction = shown.items.find((i: { procedureName: string }) => i.procedureName === "Extraction");
    expect(shownExtraction).toMatchObject({ estimatedFee: 80_000, estimatedFeeHigh: 300_000, mayBecome: ["Surgical extraction"] });
    expect(JSON.stringify(shown)).not.toContain("surgical-extraction");
    const decide = (body: object) =>
      ctx
        .http()
        .post(`/api/v1/portal/dental/plans/${ranged.id}/decision`)
        .set({ authorization: `Bearer ${token}` })
        .send({ acceptedItemIds: ranged.items.map((i) => i.id), awaitingItemIds: ranged.items.map((i) => i.id), acknowledged: true, ...body });
    await decide({ estimateAwaitingDecision: 260_000 }).expect(409);
    await decide({ estimateAwaitingDecision: 260_000, estimateAwaitingDecisionHigh: 480_000 }).expect(201);
    const recorded = await ctx.pool.query<{ code: string; decision_estimate: string; decision_estimate_high: string | null }>(
      `SELECT t.code, i.decision_estimate, i.decision_estimate_high FROM dental_treatment_plan_item i
       JOIN dental_procedure_type t ON t.id = i.procedure_type_id WHERE i.plan_id = $1 ORDER BY t.code`,
      [ranged.id],
    );
    expect(recorded.rows).toEqual([
      { code: "composite", decision_estimate: "180000", decision_estimate_high: null },
      { code: "extraction", decision_estimate: "80000", decision_estimate_high: "300000" },
    ]);
    await expect(ctx.pool.query("UPDATE dental_treatment_plan_item SET decision_estimate_high = 1 WHERE plan_id = $1", [ranged.id])).rejects.toThrow(
      /not changed/,
    );
    const after = (await staff(dentist).get(`/dental/treatment-plans/${ranged.id}/estimate`).expect(200)).body;
    expect(after.items.find((i: { procedure: { code: string } }) => i.procedure.code === "extraction").atDecision).toMatchObject({
      amount: 80_000,
      high: 300_000,
    });

    // Carried out as the surgical extraction it turned out to be; another procedure still does not match.
    const encounterId = (await staff(dentist).post("/encounters", { patientId, chiefComplaint: "Extraction" }).expect(201)).body.id;
    const itemId = ranged.items.find((i) => i.procedureTypeId === ids.extraction)!.id;
    const record = (procedureTypeId: string) =>
      staff(dentist).post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId, tooth: "18", planItemId: itemId });
    await record(ids.sealant!)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("plan_item_mismatch"));
    await record(ids.surgical!).expect(201);
    const done = (await staff(dentist).get(`/dental/treatment-plans/${ranged.id}`).expect(200)).body;
    expect(done.items.find((i: { id: string }) => i.id === itemId).status).toBe("completed");
  });
});
