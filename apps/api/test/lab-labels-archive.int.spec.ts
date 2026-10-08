import type { DomainEventRecord } from "@healthcare/core";
import { LabReportArchive } from "@healthcare/laboratory";
import { extractPdfText } from "@healthcare/pdf";
import {
  as,
  auditRows,
  binary,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  type Tenant,
  type TestContext,
  underPlatform,
} from "./harness";

// The official FHIR R4 JSON schema (bundled by this dev dependency); each resource is checked against its own type.
type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validateDocumentReference = fhir.ajv.compile({
  $schema: fhir.schema.$schema,
  definitions: fhir.schema.definitions,
  $ref: "#/definitions/DocumentReference",
});

/**
 * Laboratory follow-ups: specimen tube labels (Code 128 accession barcode,
 * minimal identification) and the archive of released reports in object
 * storage (one archived version per order and set of released result
 * versions; a correction adds a version, nothing is replaced).
 */
describe("laboratory labels and report archive", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let clerk: string;
  let medtech: string;
  let medtech2: string;
  let pathologist: string;
  let patientId: string;
  let patientNumber: string;
  const catalog: Record<string, string> = {};
  let orderId: string;
  let orderNumber: string;
  const items: Record<string, string> = {};
  let specimenId: string;
  let accession: string;
  const results: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-archive-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "clerk@example.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "medtech2@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@example.ph", ["pathologist"]);
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    doctor = (await login(ctx, "doctor@example.ph")).accessToken;
    clerk = (await login(ctx, "clerk@example.ph")).accessToken;
    medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    medtech2 = (await login(ctx, "medtech2@example.ph")).accessToken;
    pathologist = (await login(ctx, "patho@example.ph")).accessToken;
    const patient = await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201);
    patientId = patient.body.id;
    patientNumber = patient.body.patientNumber;

    catalog.chem = (await post("/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    catalog.serum = (await post("/specimen-types", admin, { code: "serum", name: "Serum", container: "Red-top tube" }).expect(201)).body.id;
    for (const [code, name] of [
      ["fbs", "Fasting blood sugar"],
      ["crea", "Creatinine"],
    ] as const) {
      catalog[code] = (
        await post("/tests", pathologist, {
          code,
          name,
          departmentId: catalog.chem,
          specimenTypeId: catalog.serum,
          resultType: "numeric",
          unit: code === "fbs" ? "mmol/L" : "umol/L",
          decimalPlaces: 1,
        }).expect(201)
      ).body.id;
    }
    await post(`/tests/${catalog.fbs}/reference-ranges`, pathologist, { low: 3.9, high: 5.5 }).expect(201);
    await post(`/tests/${catalog.crea}/reference-ranges`, pathologist, { low: 62, high: 106 }).expect(201);

    const order = await post("/orders", medtech, {
      patientId,
      source: "external",
      externalOrderer: "Dr. Reyes",
      priority: "stat",
      clinicalIndication: "Confidential indication",
      testIds: [catalog.fbs, catalog.crea],
    }).expect(201);
    orderId = order.body.id;
    orderNumber = order.body.orderNumber;
    for (const item of order.body.items as Array<{ id: string; testCode: string }>) items[item.testCode] = item.id;
    const collected = await post(`/orders/${orderId}/specimens`, medtech, { specimenTypeId: catalog.serum, itemIds: [items.fbs, items.crea] }).expect(201);
    specimenId = collected.body.specimens[0].id;
    accession = collected.body.specimens[0].accessionNumber;
  });

  afterAll(() => ctx.close());

  const at = (token: string) => as(token, tenant.facilityId);
  function post(path: string, token: string, body: object = {}) {
    return ctx.http().post(`/api/v1/laboratory${path}`).set(at(token)).send(body);
  }
  const pdf = (path: string, token: string, facilityId: string | null = tenant.facilityId) =>
    ctx
      .http()
      .get(`/api/v1/laboratory${path}`)
      .set(as(token, facilityId ?? undefined))
      .buffer(true)
      .parse(binary);
  const archiveRows = async () =>
    (
      await ctx.pool.query<{
        id: string;
        archive_version: number;
        status: string;
        corrected: boolean;
        result_ids: string[];
        attempts: number;
        last_error: string;
      }>(`SELECT * FROM lab_report_archive WHERE order_id = $1 ORDER BY archive_version`, [orderId])
    ).rows;
  const archive = () => underPlatform(ctx.app.get(LabReportArchive));

  describe("specimen labels", () => {
    it("prints tube labels with the accession barcode and only what identifies the specimen", async () => {
      const res = await pdf(`/specimens/${specimenId}/label.pdf?copies=2`, medtech).expect(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toBe(`inline; filename="label-${accession}.pdf"`);
      const body = res.body as Buffer;
      const source = body.toString("latin1");
      // One label per page, on 2.25 x 1.25 in stock.
      expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
      expect(source).toContain("/MediaBox [0 0 162 90]");
      const text = extractPdfText(body);
      expect(text).toContain(accession);
      expect(text).toContain(patientNumber);
      expect(text).toContain("DELA CRUZ, Juan Santos");
      expect(text).toMatch(/M \/ \d+ y/);
      expect(text).toMatch(/STAT {2}· {2}Serum {2}· {2}\d{2} \w{3} \d{4}, \d{2}:\d{2}/);
      expect(text).toContain("CREA, FBS");
      // Minimal PHI: no birth date, address, indication or ordering details.
      expect(text).not.toMatch(/1980|Makati|Poblacion|Confidential|Reyes/);

      const audit = await auditRows(ctx.pool, "action = 'lab.specimen.label-print'");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ patient_id: patientId, metadata: { accessionNumber: accession, copies: 2 } });
    });

    it("is permission-gated like other specimen actions", async () => {
      await pdf(`/specimens/${specimenId}/label.pdf`, doctor).expect(403);
      await pdf(`/specimens/${specimenId}/label.pdf`, medtech, tenant.otherFacilityId).expect(403);
      await pdf(`/specimens/${specimenId}/label.pdf?copies=11`, medtech).expect(400);
      await pdf(`/specimens/00000000-0000-4000-8000-000000000000/label.pdf`, medtech).expect(404);
      const single = await pdf(`/specimens/${specimenId}/label.pdf`, medtech).expect(200);
      expect((single.body as Buffer).toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    });
  });

  describe("report archive", () => {
    beforeAll(async () => {
      await post(`/specimens/${specimenId}/receive`, medtech).expect(200);
      results.fbs = (await post(`/order-items/${items.fbs}/results`, medtech, { valueNumeric: 7.2 }).expect(201)).body.id;
      results.crea = (await post(`/order-items/${items.crea}/results`, medtech, { valueNumeric: 88 }).expect(201)).body.id;
      for (const id of [results.fbs, results.crea]) {
        await post(`/results/${id}/verify`, medtech2).expect(200);
        await post(`/results/${id}/approve`, pathologist).expect(200);
      }
    });

    it("archives the report in object storage when results are released, once per result set", async () => {
      await drainEvents(ctx);
      await post(`/results/${results.fbs}/release`, pathologist).expect(200);
      expect(await archiveRows()).toHaveLength(0);
      await drainEvents(ctx);
      const [first] = await archiveRows();
      expect(first).toMatchObject({ archive_version: 1, status: "pending", corrected: false, result_ids: [results.fbs] });
      expect(ctx.archives.enqueued).toEqual([first!.id]);

      // The outbox is at-least-once: handling the same event again records nothing new.
      const event = await ctx.pool.query(`SELECT * FROM domain_event WHERE event_type = 'LaboratoryReportReleased' AND aggregate_id = $1`, [orderId]);
      expect(event.rows).toHaveLength(1);
      const row = event.rows[0];
      await archive().schedule({ organizationId: row.organization_id, payload: row.payload } as DomainEventRecord);
      expect(await archiveRows()).toHaveLength(1);

      expect(await archive().process(first!.id)).toBe("stored");
      expect(await archive().process(first!.id)).toBe("skipped");
      const [stored] = await archiveRows();
      expect(stored).toMatchObject({ status: "stored", attempts: 1 });

      const document = await ctx.pool.query(`SELECT * FROM document WHERE id = $1`, [first!.id]);
      expect(document.rows[0]).toMatchObject({
        patient_id: patientId,
        category: "laboratory_report",
        source: "generated",
        created_by: null,
        status: "available",
        file_name: `${orderNumber}-v1.pdf`,
      });
      const object = ctx.storage.contents.get(document.rows[0].storage_key)!;
      expect(Number(document.rows[0].size_bytes)).toBe(object.length);
      const text = extractPdfText(object);
      expect(text).toContain("Archived copy, version 1 of this order's report");
      expect(text).toContain("Fasting blood sugar");
      expect(text).toContain("7.2");
      expect(text).toMatch(/Pending[\s\S]*Creatinine/);
    });

    it("retries a failed archive without duplicating it, and adds a version when more results are released", async () => {
      await post(`/results/${results.crea}/release`, pathologist).expect(200);
      await drainEvents(ctx);
      const second = (await archiveRows())[1]!;
      expect(second).toMatchObject({ archive_version: 2, status: "pending", result_ids: [results.fbs, results.crea].sort() });

      // Object storage is down on the first attempt: the archive stays pending with the error; the retry stores it.
      const storage = ctx.storage;
      const original = storage.putIfAbsent.bind(storage);
      storage.putIfAbsent = async () => {
        throw new Error("S3 unavailable");
      };
      await expect(archive().process(second.id)).rejects.toThrow("S3 unavailable");
      storage.putIfAbsent = original;
      expect((await archiveRows())[1]).toMatchObject({ status: "pending", attempts: 1, last_error: "S3 unavailable" });
      expect(await archive().process(second.id)).toBe("stored");
      expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM document WHERE category = 'laboratory_report'`)).rows[0].n).toBe(2);
      const text = extractPdfText(storage.contents.get(`org/${tenant.organizationId}/documents/${second.id}`)!);
      expect(text).toContain("Creatinine");
      expect(text).not.toContain("Pending");
    });

    it("keeps every archived version when a released result is corrected", async () => {
      const before = Buffer.from(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${(await archiveRows())[0]!.id}`)!);
      const corrected = await post(`/results/${results.fbs}/correct`, pathologist, { valueNumeric: 6.2, reason: "Transcription error" }).expect(201);
      await post(`/results/${corrected.body.id}/verify`, medtech2).expect(200);
      await post(`/results/${corrected.body.id}/approve`, admin).expect(200);
      await post(`/results/${corrected.body.id}/release`, pathologist).expect(200);
      await drainEvents(ctx);
      const third = (await archiveRows())[2]!;
      expect(third).toMatchObject({ archive_version: 3, corrected: true, result_ids: [corrected.body.id, results.crea].sort() });
      expect(await archive().process(third.id)).toBe("stored");
      const text = extractPdfText(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${third.id}`)!);
      expect(text).toMatch(/Fasting blood sugar\s+\(corrected\)/);
      expect(text).toContain("Corrected: Transcription error");

      // Earlier versions are untouched, in storage and in the database.
      const [first] = await archiveRows();
      expect(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${first!.id}`)!.equals(before)).toBe(true);
      await expect(ctx.pool.query(`UPDATE lab_report_archive SET result_ids = '{}' WHERE id = $1`, [first!.id])).rejects.toThrow(/cannot change/);
      await expect(ctx.pool.query(`DELETE FROM lab_report_archive WHERE id = $1`, [first!.id])).rejects.toThrow(/not deleted/);
      await expect(ctx.storage.putIfAbsent(`org/${tenant.organizationId}/documents/${first!.id}`, Buffer.from("x"), "application/pdf")).resolves.toBe("exists");
    });

    it("lets staff list and download archived reports from the patient record (audited)", async () => {
      const list = await ctx.http().get(`/api/v1/laboratory/patients/${patientId}/report-archive`).set(as(doctor)).expect(200);
      expect(list.body.map((a: { archiveVersion: number }) => a.archiveVersion)).toEqual([3, 2, 1]);
      expect(list.body[0]).toMatchObject({ orderId, orderNumber, status: "stored", corrected: true, resultCount: 2 });
      await ctx.http().get(`/api/v1/laboratory/patients/${patientId}/report-archive`).set(as(clerk)).expect(403);

      const first = list.body[2];
      const res = await pdf(`/report-archive/${first.id}/report.pdf`, doctor, null).expect(200);
      expect(res.headers["content-disposition"]).toBe(`inline; filename="${orderNumber}-v1.pdf"`);
      expect((res.body as Buffer).equals(ctx.storage.contents.get(`org/${tenant.organizationId}/documents/${first.id}`)!)).toBe(true);
      await pdf(`/report-archive/${first.id}/report.pdf`, clerk, null).expect(403);

      // Another organization cannot reach it.
      const other = await createTenant(ctx.pool, "other-lab-org");
      await createStaff(ctx.pool, other, "doctor2@example.ph", ["physician"]);
      const outsider = (await login(ctx, "doctor2@example.ph")).accessToken;
      await pdf(`/report-archive/${first.id}/report.pdf`, outsider, null).expect(404);

      const actions = (await auditRows(ctx.pool, "patient_id = $1", [patientId])).map((a) => a.action);
      expect(actions.filter((a) => a === "lab.report.archive.schedule")).toHaveLength(3);
      expect(actions.filter((a) => a === "lab.report.archive")).toHaveLength(3);
      expect(actions.filter((a) => a === "document.generate")).toHaveLength(3);
      expect(actions).toContain("lab.report.archive.list");
      expect(actions).toContain("lab.report.archive.download");
      expect(actions).toContain("document.download");
    });

    it("exports the archived versions as DocumentReferences of the order's report, the latest current", async () => {
      const versions = (await archiveRows()).map((a) => a.id as string);
      const res = await ctx.http().get(`/api/v1/fhir/r4/DocumentReference?patient=${patientId}`).set(as(admin, tenant.facilityId)).expect(200);
      const byId = new Map((res.body.entry as Array<{ resource: { id: string } & Record<string, unknown> }>).map((e) => [e.resource.id, e.resource]));
      const [v1, v2, v3] = versions.map((id) => byId.get(id)!);
      for (const doc of [v1, v2, v3]) {
        expect(validateDocumentReference(doc) ? [] : validateDocumentReference.errors).toEqual([]);
        expect(doc).toMatchObject({
          type: { coding: expect.arrayContaining([expect.objectContaining({ system: "http://loinc.org", code: "11502-2" })]) },
          context: { related: [{ reference: `DiagnosticReport/${orderId}` }] },
        });
      }
      const stored = await ctx.pool.query(`SELECT id, stored_at FROM lab_report_archive WHERE order_id = $1 ORDER BY archive_version`, [orderId]);
      expect([v1!["status"], v2!["status"], v3!["status"]]).toEqual(["superseded", "superseded", "current"]);
      // Superseded when the next version was stored (stored archives never change: a reliable last-updated time).
      expect((v1!["meta"] as { lastUpdated: string }).lastUpdated).toBe(stored.rows[1].stored_at.toISOString());
      expect(v1).not.toHaveProperty("relatesTo");
      expect(v2).toMatchObject({ relatesTo: [{ code: "replaces", target: { reference: `DocumentReference/${versions[0]}` } }] });
      expect(v3).toMatchObject({ relatesTo: [{ code: "replaces", target: { reference: `DocumentReference/${versions[1]}` } }] });
      const current = await ctx
        .http()
        .get(
          `/api/v1/fhir/r4/DocumentReference?patient=${patientId}&_lastUpdated=ge${encodeURIComponent((v3!["meta"] as { lastUpdated: string }).lastUpdated)}`,
        )
        .set(as(admin, tenant.facilityId))
        .expect(200);
      expect(current.body.entry.map((e: { resource: { id: string } }) => e.resource.id).sort()).toEqual([versions[1], versions[2]].sort());
    });
  });
});
