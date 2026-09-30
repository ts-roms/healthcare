import { astmChecksum } from "@healthcare/interoperability";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Analyzer interfaces (docs/domains/laboratory-instruments.md): an integration account posts HL7 v2 or ASTM messages;
 * each result is matched to a specimen and an ordered test and waits for review; staff accept it into the ordinary
 * result workflow (attributed to the instrument) or dismiss it. Nothing an analyzer sends becomes a result by itself.
 */
describe("laboratory instrument interface", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let pathologist: string;
  const ids: Record<string, string> = {};

  const lab = (method: "get" | "post" | "put", path: string, token: string, body?: object) => {
    const call = ctx.http()[method](`/api/v1/laboratory${path}`).set(as(token, tenant.facilityId));
    return body ? call.send(body) : call;
  };
  // The gateway's integration account sends without a facility.
  const send = (message: string, token = admin) =>
    ctx
      .http()
      .post(`/api/v1/laboratory/instruments/${ids.analyzer}/messages`)
      .set({ authorization: `Bearer ${token}` })
      .send({ message });
  const oru = (control: string, accession: string, units = "mmol/L") =>
    `MSH|^~\\&|ANALYZER||||20260930101500||ORU^R01^ORU_R01|${control}|P|2.5.1\rOBR|1|${accession}\r` +
    `OBX|1|NM|GLU^Glucose||6.1|${units}|3.9-5.6|H|||F\rOBX|2|NM|CHOL^Cholesterol||4.2|mmol/L|||||F`;
  const pending = async () =>
    (await lab("get", "/instrument-results", medtech).expect(200)).body as Array<{
      id: string;
      analyzerCode: string;
      matchProblem: string | null;
      orderItemId: string | null;
      value: string;
      flags: string | null;
      status: string | null;
      patient: { patientNumber: string } | null;
    }>;
  const order = async () => {
    const created = await lab("post", "/orders", medtech, {
      patientId: ids.patient,
      source: "external",
      externalOrderer: "Dr. Reyes",
      testIds: [ids.glu],
    }).expect(201);
    const collected = await lab("post", `/orders/${created.body.id}/specimens`, medtech, {
      specimenTypeId: ids.serum,
      itemIds: [created.body.items[0].id],
    }).expect(201);
    const specimen = collected.body.specimens[0];
    await lab("post", `/specimens/${specimen.id}/receive`, medtech).expect(200);
    return { itemId: created.body.items[0].id as string, accession: specimen.accessionNumber as string };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-interface-org");
    await createStaff(ctx.pool, tenant, "admin@interface.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "medtech@interface.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@interface.ph", ["pathologist"]);
    admin = (await login(ctx, "admin@interface.ph")).accessToken;
    medtech = (await login(ctx, "medtech@interface.ph")).accessToken;
    pathologist = (await login(ctx, "patho@interface.ph")).accessToken;
    ids.patient = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
    ids.chem = (await lab("post", "/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    ids.serum = (await lab("post", "/specimen-types", admin, { code: "serum", name: "Serum" }).expect(201)).body.id;
    ids.glu = (
      await lab("post", "/tests", pathologist, {
        code: "glu",
        name: "Glucose",
        departmentId: ids.chem,
        specimenTypeId: ids.serum,
        resultType: "numeric",
        unit: "mmol/L",
        decimalPlaces: 1,
      }).expect(201)
    ).body.id;
    ids.analyzer = (await lab("post", "/instruments", pathologist, { code: "chem-1", name: "Chemistry analyzer 1" }).expect(201)).body.id;
    Object.assign(ids, await order().then((o) => ({ item: o.itemId, accession: o.accession })));
  });
  afterAll(() => ctx.close());

  it("configures the interface and analyzer codes (quality managers only; audited)", async () => {
    await send(oru("C-0", ids.accession))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("interface_not_enabled"));
    await lab("put", `/instruments/${ids.analyzer}/interface`, medtech, { protocol: "hl7v2", specimenIdField: "OBR-2", enabled: true }).expect(403);
    await lab("put", `/instruments/${ids.analyzer}/interface`, pathologist, { protocol: "hl7v2", specimenIdField: "O-3", enabled: true }).expect(400);
    await lab("put", `/instruments/${ids.analyzer}/interface`, pathologist, { protocol: "hl7v2", specimenIdField: "OBR-2", enabled: true }).expect(200);
    const settings = await lab("put", `/instruments/${ids.analyzer}/interface/test-codes`, pathologist, { analyzerCode: "GLU", testId: ids.glu }).expect(200);
    expect(settings.body).toMatchObject({
      interface: { protocol: "hl7v2", specimenIdField: "OBR-2", enabled: true, version: 1 },
      testCodes: [{ analyzerCode: "GLU", testCode: "glu" }],
    });
    expect(
      (
        await auditRows(ctx.pool, "action IN ('lab.instrument.interface.configure', 'lab.instrument.test-code') AND organization_id = $1", [
          tenant.organizationId,
        ])
      ).map((a) => a.action),
    ).toEqual(["lab.instrument.interface.configure", "lab.instrument.test-code"]);
  });

  it("receives an HL7 message once, matching what it can and keeping the rest for review", async () => {
    await send(oru("C-1", ids.accession), medtech).expect(403);
    const received = await send(oru("C-1", ids.accession)).expect(200);
    expect(received.body).toMatchObject({ duplicate: false, results: 2, matched: 1, controlId: "C-1" });
    expect((await send(oru("C-1", ids.accession)).expect(200)).body).toMatchObject({ duplicate: true, messageId: received.body.messageId });

    const rows = await pending();
    expect(rows).toEqual([
      expect.objectContaining({
        analyzerCode: "GLU",
        matchProblem: null,
        orderItemId: ids.item,
        value: "6.1",
        flags: "H",
        status: "F",
        patient: expect.any(Object),
      }),
      expect.objectContaining({ analyzerCode: "CHOL", matchProblem: "unmapped_code", orderItemId: null }),
    ]);
    ids.gluResult = rows[0]!.id;
    ids.cholResult = rows[1]!.id;

    await send("this is not HL7")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("instrument_message_unreadable"));
    const kept = await ctx.pool.query("SELECT outcome, error_code FROM lab_instrument_message WHERE instrument_id = $1 ORDER BY received_at", [ids.analyzer]);
    expect(kept.rows).toEqual([
      { outcome: "read", error_code: null },
      { outcome: "rejected", error_code: "not_hl7" },
    ]);
  });

  it("enters an accepted result through the result workflow, attributed to the instrument", async () => {
    await lab("post", `/instrument-results/${ids.cholResult}/accept`, medtech)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("instrument_result_unmatched"));
    const accepted = await lab("post", `/instrument-results/${ids.gluResult}/accept`, medtech).expect(200);
    expect(accepted.body).toMatchObject({ state: "accepted" });
    const history = (await lab("get", `/order-items/${ids.item}/results`, medtech).expect(200)).body as Array<Record<string, unknown>>;
    expect(history).toEqual([expect.objectContaining({ id: accepted.body.resultId, valueNumeric: 6.1, status: "entered", instrumentId: ids.analyzer })]);
    await lab("post", `/instrument-results/${ids.gluResult}/accept`, medtech)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("instrument_result_decided"));
    await lab("post", `/instrument-results/${ids.cholResult}/dismiss`, medtech, { reason: "Not ordered here" }).expect(200);
    expect(await pending()).toEqual([]);
    const decided = (await lab("get", "/instrument-results?state=decided", medtech).expect(200)).body;
    expect(decided.map((d: { state: string }) => d.state).sort()).toEqual(["accepted", "dismissed"]);
    // What the instrument sent never changes, and nothing is deleted.
    await expect(ctx.pool.query("UPDATE lab_instrument_result SET value_raw = '9.9' WHERE id = $1", [ids.gluResult])).rejects.toThrow(/decided once/);
    await expect(ctx.pool.query("DELETE FROM lab_instrument_message")).rejects.toThrow(/kept as received/);
  });

  it("refuses a value in another unit rather than converting it", async () => {
    const next = await order();
    await send(oru("C-2", next.accession, "mg/dL")).expect(200);
    const row = (await pending()).find((r) => r.analyzerCode === "GLU")!;
    await lab("post", `/instrument-results/${row.id}/accept`, medtech)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("instrument_unit_mismatch"));
  });

  it("reads ASTM transmissions (E1381 frames with checksums)", async () => {
    const current = (await lab("get", `/instruments/${ids.analyzer}/interface`, pathologist).expect(200)).body.interface;
    await lab("put", `/instruments/${ids.analyzer}/interface`, pathologist, {
      protocol: "astm",
      specimenIdField: "O-3",
      enabled: true,
      version: current.version,
    }).expect(200);
    const next = await order();
    const body = `1H|\\^&|ASTM-1\rO|1|${next.accession}\rR|1|^^^GLU|5.4|mmol/L||N||F\rL|1|N\r\x03`;
    const transmission = `\x05\x02${body}${astmChecksum(body)}\r\n\x04`;
    expect((await send(transmission).expect(200)).body).toMatchObject({ results: 1, matched: 1, controlId: "ASTM-1" });
    await send(transmission.replace("5.4", "5.5"))
      .expect(422)
      .expect((r) => expect(r.body.error.details.reason).toBe("checksum_mismatch"));
    const row = (await pending()).find((r) => r.orderItemId === next.itemId)!;
    await lab("post", `/instrument-results/${row.id}/accept`, medtech).expect(200);
  });
});
