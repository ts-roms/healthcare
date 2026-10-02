import { randomUUID } from "node:crypto";
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

const PASSWORD = "Pamamaraan-2026";

/**
 * Compliance configuration (docs/architecture/compliance-configuration.md): nothing encodes a government rule; the
 * organization enters its own codes, methods, periods, deadlines and requirements, and records who validated them.
 */
describe("compliance configuration", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  let nurse: string;
  let records: string;
  let doctor: string;
  let dentist: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const key = () => randomUUID();

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "compliance-org");
    await createStaff(ctx.pool, tenant, "admin@comply.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@comply.ph", ["inventory_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@comply.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "records@comply.ph", ["records_officer"]);
    await createClinician(ctx, tenant, "doctor@comply.ph", ["physician"]);
    await createClinician(ctx, tenant, "dentist@comply.ph", ["dentist"], "dentist");
    [admin, officer, nurse, records, doctor, dentist] = await Promise.all(
      ["admin", "officer", "nurse", "records", "doctor", "dentist"].map(async (u) => (await login(ctx, `${u}@comply.ph`)).accessToken),
    );
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  describe("compliance reviews", () => {
    it("lists every area as not reviewed until the organization records who validated it", async () => {
      await api(nurse).get("/compliance/reviews").expect(403);
      const before = (await api(admin).get("/compliance/reviews").expect(200)).body;
      expect(before.areas).toHaveLength(7);
      expect(before.areas.every((a: { latest: unknown }) => a.latest === null)).toBe(true);

      const review = {
        area: "billing_tax",
        outcome: "validated",
        reviewerName: "Maria Santos, CPA",
        reviewerRole: "External accountant",
        reference: "Engagement letter 2026-07; configuration as of September",
        reviewedOn: manilaDate(0),
      };
      await api(admin)
        .post("/compliance/reviews", { ...review, reviewedOn: manilaDate(2) })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("reviewed_in_future"));
      await api(admin)
        .post("/compliance/reviews", { ...review, area: "tax" })
        .expect(400);
      await api(admin).post("/compliance/reviews", review).expect(201);
      const after = (await api(admin).get("/compliance/reviews").expect(200)).body;
      expect(after.areas.find((a: { area: string }) => a.area === "billing_tax").latest).toMatchObject({
        outcome: "validated",
        reviewerName: "Maria Santos, CPA",
      });
      await expect(ctx.pool.query("DELETE FROM compliance_review")).rejects.toThrow();
      expect(await auditRows(ctx.pool, "action = 'compliance.review.record'")).toHaveLength(1);
    });
  });

  describe("tax and procurement", () => {
    it("asks for the organization's own procurement method and its reference once it has defined some", async () => {
      const post = async (url: string, body: object) => (await api(admin).post(url, body).expect(201)).body.id as string;
      ids.tramadol = await post("/inventory/items", {
        code: "tramadol-50",
        name: "Tramadol 50 mg",
        category: "medicine",
        stockUnit: "capsule",
        controlled: true,
      });
      ids.supplier = await post("/inventory/suppliers", { code: "pharma", name: "Pharma Distributors Inc." });
      ids.pharmacy = await post("/inventory/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" });

      await api(officer).post("/inventory/procurement-methods", { code: "SVP", name: "Small value procurement" }).expect(403);
      ids.method = await post("/inventory/procurement-methods", { code: "SVP", name: "Small value procurement", referenceLabel: "Posting reference" });
      await api(admin).post("/inventory/procurement-methods", { code: "svp ", name: "Duplicate" }).expect(409);

      const order = await api(officer)
        .post("/inventory/purchase-orders", {
          supplierId: ids.supplier,
          locationId: ids.pharmacy,
          lines: [{ itemId: ids.tramadol, quantity: 100, unitCost: 1_200 }],
        })
        .expect(201);
      ids.po = order.body.id;
      ids.poLine = order.body.lines[0].id;
      await api(officer)
        .post(`/inventory/purchase-orders/${ids.po}/submit`, { version: 1 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("procurement_method_required"));
      const withMethod = await api(officer)
        .put(`/inventory/purchase-orders/${ids.po}`, {
          supplierId: ids.supplier,
          locationId: ids.pharmacy,
          procurementMethodId: ids.method,
          lines: [{ itemId: ids.tramadol, quantity: 100, unitCost: 1_200 }],
          version: 1,
        })
        .expect(200);
      await api(officer)
        .post(`/inventory/purchase-orders/${ids.po}/submit`, { version: withMethod.body.version })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("procurement_reference_required"));
      const withReference = await api(officer)
        .put(`/inventory/purchase-orders/${ids.po}`, {
          supplierId: ids.supplier,
          locationId: ids.pharmacy,
          procurementMethodId: ids.method,
          procurementReference: "PR-2026-0042",
          lines: [{ itemId: ids.tramadol, quantity: 100, unitCost: 1_200 }],
          version: withMethod.body.version,
        })
        .expect(200);
      expect(withReference.body.procurementMethod).toMatchObject({ code: "SVP", referenceLabel: "Posting reference" });
      // A draft's lines are replaced as a whole.
      ids.poLine = withReference.body.lines[0].id;
      const submitted = await api(officer).post(`/inventory/purchase-orders/${ids.po}/submit`, { version: withReference.body.version }).expect(200);
      await api(admin).post(`/inventory/purchase-orders/${ids.po}/approve`, { version: submitted.body.version }).expect(200);
    });

    it("records what was withheld at payment under the organization's own code (entered, never computed)", async () => {
      await api(officer)
        .post(`/inventory/purchase-orders/${ids.po}/receipts`, {
          reference: "DR-77",
          reason: "Delivery for the controlled register",
          lines: [{ lineId: ids.poLine, quantity: 100, lotNumber: "TRM1", expiryDate: manilaDate(400) }],
          idempotencyKey: key(),
        })
        .expect(200);
      const invoice = await api(officer)
        .post(`/inventory/purchase-orders/${ids.po}/invoices`, {
          invoiceNumber: "SI-500",
          invoiceDate: manilaDate(-1),
          lines: [{ purchaseOrderLineId: ids.poLine, quantity: 100, unitPrice: 1_200 }],
        })
        .expect(201);
      await api(admin).post(`/inventory/supplier-invoices/${invoice.body.id}/approve`, { version: 1 }).expect(200);
      ids.code = (
        await api(admin)
          .post("/inventory/withholding-codes", { code: "WC-GOODS", description: "Withholding on goods (per our accountant)", rateBasisPoints: 100 })
          .expect(201)
      ).body.id;
      const pay = { version: 2, paidOn: manilaDate(0), paymentReference: "CHK-9" };
      await api(admin)
        .post(`/inventory/supplier-invoices/${invoice.body.id}/payment`, { ...pay, withholding: { codeId: ids.code, amount: 200_000 } })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("withheld_above_total"));
      const paid = await api(admin)
        .post(`/inventory/supplier-invoices/${invoice.body.id}/payment`, { ...pay, withholding: { codeId: ids.code, amount: 1_200, reference: "CERT-1" } })
        .expect(200);
      expect(paid.body).toMatchObject({
        status: "paid",
        withheldAmount: 1_200,
        netPaid: 118_800,
        withholdingReference: "CERT-1",
        withholdingCode: { code: "WC-GOODS" },
      });
    });
  });

  describe("register of controlled items", () => {
    it("lists every movement with running balances, and exports it", async () => {
      await api(nurse)
        .post("/inventory/issues", {
          locationId: ids.pharmacy,
          itemId: ids.tramadol,
          quantity: 10,
          issuedTo: "Ward A",
          reason: "Post-operative pain",
          reference: "RX-00012",
          idempotencyKey: key(),
        })
        .expect(201);
      await api(nurse)
        .get(`/inventory/controlled-register?from=${manilaDate(0)}&to=${manilaDate(0)}`)
        .expect(403);
      await api(admin)
        .put("/inventory/controlled-register/setting", { licenceReference: "S2-0000-TEST", responsiblePerson: "R. Cruz, RPh (PRC 0000000)", version: 0 })
        .expect(200);
      const register = (
        await api(officer)
          .get(`/inventory/controlled-register?from=${manilaDate(0)}&to=${manilaDate(0)}`)
          .expect(200)
      ).body;
      expect(register.setting).toMatchObject({ licenceReference: "S2-0000-TEST" });
      expect(register.sections).toHaveLength(1);
      expect(register.sections[0]).toMatchObject({ opening: 0, received: 100, removed: 10, closing: 90 });
      expect(register.sections[0].lines.map((l: { kind: string; balance: number; reference: string | null }) => [l.kind, l.balance, l.reference])).toEqual([
        ["receipt", 100, "DR-77"],
        ["issue", 90, "RX-00012"],
      ]);
      expect(register.sections[0].lines[1].recordedByName).toBeTruthy();
      // The day after, the balance carries into the opening balance.
      const later = (
        await api(officer)
          .get(`/inventory/controlled-register?from=${manilaDate(1)}&to=${manilaDate(1)}`)
          .expect(200)
      ).body;
      expect(later.sections[0]).toMatchObject({ opening: 90, closing: 90, lines: [] });

      const csv = await api(officer)
        .get(`/inventory/controlled-register/export?from=${manilaDate(0)}&to=${manilaDate(0)}`)
        .expect(200);
      expect(csv.headers["content-type"]).toMatch(/text\/csv/);
      expect(csv.text).toContain("S2-0000-TEST");
      expect(csv.text).toContain("RX-00012");
      const audit = await auditRows(ctx.pool, "action LIKE 'inventory.controlled-register.%'");
      expect(audit.map((a) => a.action)).toEqual([
        "inventory.controlled-register.setting",
        "inventory.controlled-register.view",
        "inventory.controlled-register.view",
        "inventory.controlled-register.export",
      ]);
    });
  });

  describe("laboratory licence and DOH reporting deadlines", () => {
    it("records the licence as issued and reminds within the organization's own window", async () => {
      expect((await api(admin).get("/laboratory/licence").expect(200)).body).toMatchObject({ state: "missing", current: null });
      await api(admin)
        .post("/laboratory/licence", { licenceNumber: "LAB-1", validFrom: manilaDate(10), validUntil: manilaDate(0) })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("invalid_validity"));
      const licence = await api(admin)
        .post("/laboratory/licence", {
          licenceNumber: "LAB-2026-0001",
          classification: "As written on the licence",
          issuedBy: "Regional office as printed",
          validFrom: manilaDate(-300),
          validUntil: manilaDate(20),
          reminderDays: 30,
        })
        .expect(201);
      expect(licence.body).toMatchObject({ state: "expiring", current: { licenceNumber: "LAB-2026-0001" } });
      const summary = (await api(admin).get("/laboratory/quality/summary").expect(200)).body;
      expect(summary.licence).toEqual({ state: "expiring", validUntil: manilaDate(20) });
    });

    it("gives a case report the due time of the organization's own deadline", async () => {
      await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
      await api(admin).post("/doh/rules", { codePrefix: "A91", category: "Dengue", reportWithinDays: 0 }).expect(400);
      await api(admin).post("/doh/rules", { codePrefix: "A91", category: "Dengue", reportWithinDays: 3 }).expect(201);
      await api(admin).post("/doh/rules", { codePrefix: "B05", category: "Measles" }).expect(201);
      const encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Fever" }).expect(201)).body.id;
      await api(doctor).post(`/encounters/${encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "A91", display: "Dengue haemorrhagic fever" }).expect(201);
      await api(doctor).post(`/encounters/${encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "B05.9", display: "Measles" }).expect(201);
      await drainEvents(ctx);
      const reports = (await api(admin).get("/doh/case-reports").expect(200)).body as Array<{ diagnosisCode: string; dueAt: string | null; overdue: boolean }>;
      const dengue = reports.find((r) => r.diagnosisCode === "A91")!;
      const measles = reports.find((r) => r.diagnosisCode === "B05.9")!;
      const days = (new Date(dengue.dueAt!).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(2.9);
      expect(days).toBeLessThan(3.01);
      expect(dengue.overdue).toBe(false);
      expect(measles).toMatchObject({ dueAt: null, overdue: false });
    });
  });

  describe("Data Privacy Act: retention and the records-request procedure", () => {
    it("lists documents past the organization's retention period and deletes nothing", async () => {
      const old = randomUUID();
      const recent = randomUUID();
      for (const [id, uploaded] of [
        [old, "now() - interval '6 years'"],
        [recent, "now()"],
      ] as const) {
        await ctx.pool.query(
          `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, source, scan_status, scanned_at)
           VALUES ($1, $2, $3, $4, 'consent_form', 'Consent', 'consent.pdf', 'application/pdf', 1000, $5, 'available', ${uploaded}, 'generated', 'clean', ${uploaded})`,
          [id, tenant.organizationId, tenant.facilityId, patientId, `org/${tenant.organizationId}/documents/${id}`],
        );
      }
      await api(nurse).get("/document-retention").expect(403);
      await api(records).put("/document-retention", { category: "consent_form", retainYears: 5 }).expect(400);
      const set = await api(records)
        .put("/document-retention", { category: "consent_form", retainYears: 5, basisNote: "Our retention schedule, approved by the DPO" })
        .expect(200);
      expect(set.body.policies).toEqual([expect.objectContaining({ category: "consent_form", retainYears: 5, pastPeriod: 1 })]);
      const review = (await api(records).get("/document-retention/review?category=consent_form").expect(200)).body;
      expect(review.documents.map((d: { id: string }) => d.id)).toEqual([old]);
      // A new period keeps the old one as history.
      const changed = await api(records).put("/document-retention", { category: "consent_form", retainYears: 10, basisNote: "Revised schedule" }).expect(200);
      expect(changed.body.policies[0]).toMatchObject({ retainYears: 10, pastPeriod: 0 });
      expect(changed.body.ended).toHaveLength(1);
      const stillThere = await ctx.pool.query("SELECT count(*)::int AS n FROM document WHERE id = ANY($1)", [[old, recent]]);
      expect(stillThere.rows[0].n).toBe(2);
    });

    it("dates requests from the organization's response time and asks how the requester's identity was confirmed", async () => {
      await api(records).put("/records-requests/setting", { responseDays: 15, identityCheckRequired: true, patientNotice: null, version: 0 }).expect(403);
      await api(admin)
        .put("/records-requests/setting", {
          responseDays: 15,
          identityCheckRequired: true,
          patientNotice: "Bring a valid ID when you collect printed copies. Our fees are posted at the records office.",
          version: 0,
        })
        .expect(200);

      await api(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
      const code = (await api(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
      const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
        "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
        [patientId],
      );
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: "compliance-org",
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "juan@comply.ph",
          password: PASSWORD,
        })
        .expect(200);
      const token = (
        await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "compliance-org", email: "juan@comply.ph", password: PASSWORD }).expect(200)
      ).body.accessToken;
      const portal = (url: string) =>
        ctx
          .http()
          .get(`/api/v1/portal${url}`)
          .set({ authorization: `Bearer ${token}` });
      expect((await portal("/documents").expect(200)).body).toMatchObject({ requestNotice: expect.stringContaining("valid ID"), responseDays: 15 });
      const request = await ctx
        .http()
        .post("/api/v1/portal/records-requests")
        .set({ authorization: `Bearer ${token}` })
        .send({ scope: ["certificates"] })
        .expect(201);
      const due = new Date(`${manilaDate(0)}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + 15);
      expect(request.body).toMatchObject({ respondBy: due.toISOString().slice(0, 10), overdue: false });

      const doc = randomUUID();
      await ctx.pool.query(
        `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, source, scan_status, scanned_at)
         VALUES ($1, $2, $3, $4, 'other', 'Copy', 'copy.pdf', 'application/pdf', 1000, $5, 'available', now(), 'generated', 'clean', now())`,
        [doc, tenant.organizationId, tenant.facilityId, patientId, `org/${tenant.organizationId}/documents/${doc}`],
      );
      await api(records)
        .post(`/records-requests/${request.body.id}/fulfil`, { documentIds: [doc], version: 1 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("identity_check_required"));
      const fulfilled = await api(records)
        .post(`/records-requests/${request.body.id}/fulfil`, {
          documentIds: [doc],
          identityCheckMethod: "Portal sign-in and ID shown at the counter",
          version: 1,
        })
        .expect(200);
      expect(fulfilled.body).toMatchObject({ status: "fulfilled", identityCheckMethod: "Portal sign-in and ID shown at the counter" });
    });
  });

  describe("dental written estimates", () => {
    it("prints a validity date and, when the organization requires it, needs the patient's signed estimate before a decision", async () => {
      const composite = (await api(admin).post("/dental/procedure-types", { code: "composite", name: "Composite restoration", site: "surface" }).expect(201))
        .body.id;
      const settings = (await api(admin).get("/dental/settings/portal").expect(200)).body;
      const updated = await api(admin)
        .put("/dental/settings/portal", {
          portalDentalRecords: false,
          writtenEstimateValidityDays: 30,
          writtenEstimateRequired: true,
          version: settings.version,
        })
        .expect(200);
      expect(updated.body).toMatchObject({ writtenEstimateValidityDays: 30, writtenEstimateRequired: true });

      const plan = (
        await api(dentist)
          .post("/dental/treatment-plans", { patientId, title: "Restorative plan", items: [{ procedureTypeId: composite, tooth: "16", surfaces: ["O"] }] })
          .expect(201)
      ).body;
      const validUntil = new Date(`${manilaDate(0)}T00:00:00Z`);
      validUntil.setUTCDate(validUntil.getUTCDate() + 30);
      const estimate = (await api(dentist).get(`/dental/treatment-plans/${plan.id}/estimate`).expect(200)).body;
      expect(estimate).toMatchObject({ validUntil: validUntil.toISOString().slice(0, 10), writtenRequired: true, written: [] });
      const pdf = await api(dentist).get(`/dental/treatment-plans/${plan.id}/estimate.pdf`).buffer(true).parse(binary).expect(200);
      expect(extractPdfText(pdf.body as Buffer)).toContain("VALID UNTIL");

      const decide = { acceptedItemIds: [plan.items[0].id], note: "Fees explained", version: plan.version };
      await api(dentist)
        .post(`/dental/treatment-plans/${plan.id}/decision`, decide)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("written_estimate_required"));
      const signed = await api(dentist).post(`/dental/treatment-plans/${plan.id}/written-estimates`, { version: plan.version }).expect(201);
      expect(signed.body.written).toEqual([expect.objectContaining({ itemIds: [plan.items[0].id], validUntil: validUntil.toISOString().slice(0, 10) })]);
      await api(dentist).post(`/dental/treatment-plans/${plan.id}/decision`, decide).expect(200);
      expect(await auditRows(ctx.pool, "action = 'dental.plan.estimate.signed'")).toHaveLength(1);
    });
  });
});
