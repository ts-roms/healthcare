import { randomUUID } from "node:crypto";
import { as, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Entry {
  id: string;
  kind: string;
  occurredAt: string;
  facility: { id: string; name: string } | null;
  title: string;
  detail: string | null;
  status: string | null;
  marker: string | null;
  flag: string | null;
  link: { type: string; id: string } | null;
  filedUnder: string | null;
  sourceIds: Record<string, string>;
}
interface Page {
  items: Entry[];
  nextCursor: string | null;
  withheld: string[];
  timeZone: string;
}

/**
 * Patient timeline, further kinds (docs/domains/patient-timeline.md): allergies and allergy reviews, consents, queue
 * visits and triage, specimen events, critical-value communication, dental images and periodontal charts, credit and
 * debit notes, deposits, PhilHealth claims, eligibility and YAKAP answers, DOH case reports, dispensing, medical
 * certificates and records requests — each with short display fields only, gated by its domain's read permission,
 * read through merged records, marked when not valid, and paged stably with the other kinds.
 */
describe("patient timeline: further kinds", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let cashier: string;
  let medtech: string;
  let receptionist: string;
  let patientId: string;
  let otherPatientId: string;
  let otherNumber: string;
  const ids: Record<string, string> = {};
  const users: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const timeline = async (token: string, query = "", id = patientId): Promise<Page> =>
    (await api(token).get(`/patients/${id}/timeline${query}`).expect(200)).body;
  const q = async (sql: string, params: unknown[] = []) => (await ctx.pool.query(sql, params)).rows;
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0].id as string;
  const byId = (page: Page) => new Map(page.items.map((e) => [e.id, e]));

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "timeline-kinds");
    const org = tenant.organizationId;
    const facility = tenant.facilityId;
    users.admin = await createStaff(ctx.pool, tenant, "admin@kinds.ph", ["org_admin"]);
    const doc = await createClinician(ctx, tenant, "reyes@kinds.ph", ["physician"]);
    const dentist = await createClinician(ctx, tenant, "santos@kinds.ph", ["dentist"], "dentist");
    users.cashier = await createStaff(ctx.pool, tenant, "cashier@kinds.ph", ["cashier"]);
    users.medtech = await createStaff(ctx.pool, tenant, "medtech@kinds.ph", [{ role: "medical_technologist", facilityId: facility }]);
    await createStaff(ctx.pool, tenant, "desk@kinds.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@kinds.ph")).accessToken;
    doctor = (await login(ctx, "reyes@kinds.ph")).accessToken;
    const dentistToken = (await login(ctx, "santos@kinds.ph")).accessToken;
    cashier = (await login(ctx, "cashier@kinds.ph")).accessToken;
    medtech = (await login(ctx, "medtech@kinds.ph")).accessToken;
    receptionist = (await login(ctx, "desk@kinds.ph")).accessToken;

    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const other = await api(admin)
      .post("/patients", {
        familyName: "Bautista",
        givenName: "Rosa",
        sex: "female",
        birthDate: "1991-07-08",
        contacts: [{ system: "mobile", value: "0918 765 4321" }],
      })
      .expect(201);
    otherPatientId = other.body.id;
    otherNumber = other.body.patientNumber;

    // Consultation the clinical rows hang on.
    const visitTypeId = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 15 }).expect(201))
      .body.id;
    ids.encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "SECRET-COMPLAINT" }).expect(201)).body.id;

    // 1. Queue visits (one completed, one cancelled) and triage (one final, one entered in error).
    ids.visit = await one(
      `INSERT INTO visit (organization_id, facility_id, patient_id, visit_type_id, arrival_mode, queue_date, queue_number, priority, status,
                          chief_complaint, called_to, checked_in_by, completed_at)
       VALUES ($1, $2, $3, $4, 'walk_in', $5, 7, 'urgent', 'completed', 'SECRET-VISIT-COMPLAINT', 'SECRET-ROOM', $6, now()) RETURNING id`,
      [org, facility, patientId, visitTypeId, manilaDate(0), users.admin],
    );
    ids.cancelledVisit = await one(
      `INSERT INTO visit (organization_id, facility_id, patient_id, visit_type_id, arrival_mode, queue_date, queue_number, status, closed_reason,
                          checked_in_by, checked_in_at, completed_at)
       VALUES ($1, $2, $3, $4, 'walk_in', $5, 3, 'cancelled', 'SECRET-CLOSED-REASON', $6, now() - interval '1 day', now() - interval '1 day') RETURNING id`,
      [org, facility, patientId, visitTypeId, manilaDate(-1), users.admin],
    );
    ids.triage = await one(
      `INSERT INTO triage_assessment (organization_id, visit_id, patient_id, chief_complaint, pain_score, priority, risk_flags, notes, assessed_by)
       VALUES ($1, $2, $3, 'SECRET-TRIAGE-COMPLAINT', 7, 'urgent', '{SECRET-FLAG}', 'SECRET-TRIAGE-NOTE', $4) RETURNING id`,
      [org, ids.visit, patientId, users.admin],
    );
    ids.triageInError = await one(
      `INSERT INTO triage_assessment (organization_id, visit_id, patient_id, chief_complaint, priority, assessed_by, status, entered_in_error_reason, entered_in_error_by)
       VALUES ($1, $2, $3, 'SECRET-TRIAGE-COMPLAINT', 'routine', $4, 'entered_in_error', 'SECRET-TRIAGE-EIE', $4) RETURNING id`,
      [org, ids.visit, patientId, users.admin],
    );

    // 2. Allergies (one later entered in error) and a review; the retired record's review says "no known allergies".
    ids.allergy = (
      await api(doctor)
        .post(`/patients/${patientId}/allergies`, {
          category: "medication",
          substance: "Penicillin",
          reaction: "SECRET-REACTION",
          severity: "severe",
          criticality: "high",
          verification: "confirmed",
        })
        .expect(201)
    ).body.id;
    ids.allergyInError = (
      await api(doctor).post(`/patients/${patientId}/allergies`, { category: "food", substance: "Shellfish", reaction: "SECRET-REACTION-2" }).expect(201)
    ).body.id;
    await api(doctor)
      .patch(`/patients/${patientId}/allergies/${ids.allergyInError}`, { status: "entered_in_error", reason: "SECRET-ALLERGY-REASON", version: 1 })
      .expect(200);
    await api(doctor).post(`/patients/${patientId}/allergy-reviews`, { noKnownAllergies: false }).expect(201);
    await api(doctor).post(`/patients/${otherPatientId}/allergy-reviews`, { noKnownAllergies: true }).expect(201);
    const reviewOf = (id: string) => one(`SELECT id FROM allergy_review WHERE patient_id = $1`, [id]);
    [ids.review, ids.otherReview] = [await reviewOf(patientId), await reviewOf(otherPatientId)];

    // 3. Consents (their notes never appear).
    ids.consent = await one(
      `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, captured_via, notes, recorded_by)
       VALUES ($1, $2, 'data_processing', 'granted', 'paper', 'SECRET-CONSENT-NOTE', $3) RETURNING id`,
      [org, patientId, users.admin],
    );
    ids.otherConsent = await one(
      `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, captured_via, recorded_by)
       VALUES ($1, $2, 'telemedicine', 'withdrawn', 'verbal', $3) RETURNING id`,
      [org, otherPatientId, users.admin],
    );

    // 4. Laboratory: a critical potassium (communicated and acknowledged) and a rejected sodium specimen.
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const k = (await lab("/tests", { code: "potassium", name: "Potassium", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" }))
      .body.id;
    const na = (await lab("/tests", { code: "sodium", name: "Sodium", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })).body
      .id;
    await lab(`/tests/${k}/reference-ranges`, { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 });
    const order = (
      await api(doctor)
        .post("/laboratory/orders", { patientId, encounterId: ids.encounter, testIds: [k, na] })
        .expect(201)
    ).body;
    ids.labOrder = order.id;
    const itemOf = (testId: string) => order.items.find((i: { testId: string }) => i.testId === testId);
    const collect = async (item: { id: string; specimenTypeId: string }) => {
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: item.specimenTypeId, itemIds: [item.id] })
        .expect(201);
      return (await q(`SELECT specimen_id FROM lab_order_item WHERE id = $1`, [item.id]))[0].specimen_id as string;
    };
    ids.kSpecimen = await collect(itemOf(k));
    await api(medtech).post(`/laboratory/specimens/${ids.kSpecimen}/receive`).expect(200);
    const result = (
      await api(medtech)
        .post(`/laboratory/order-items/${itemOf(k).id}/results`, { valueNumeric: 7.77 })
        .expect(201)
    ).body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
    ids.alert = (await q(`SELECT id FROM lab_critical_alert WHERE result_id = $1`, [result]))[0].id;
    await api(medtech)
      .post(`/laboratory/critical-results/${ids.alert}/communicate`, {
        communicatedTo: "Dr. Reyes",
        method: "phone",
        readBackConfirmed: true,
        note: "SECRET-CRITICAL-NOTE",
      })
      .expect(200);
    await api(doctor).post(`/laboratory/critical-results/${ids.alert}/acknowledge`).expect(200);
    ids.naSpecimen = await collect(itemOf(na));
    await api(medtech).post(`/laboratory/specimens/${ids.naSpecimen}/reject`, { reason: "SECRET-REJECT-REASON", requestRecollection: true }).expect(200);

    // 5. Dental: an image (shared in MyHealth) and a periodontal chart, from a dental visit.
    ids.dentalEncounter = (await api(dentistToken).post("/encounters", { patientId, chiefComplaint: "SECRET-TOOTHACHE" }).expect(201)).body.id;
    const documentId = await one(
      `INSERT INTO document (organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, created_by, scan_status, scanned_at)
       VALUES ($1, $2, $3, 'imaging', 'SECRET-IMAGE-TITLE', 'secret-pano.png', 'image/png', 2048, $4, 'available', now(), $5, 'not_scanned', now()) RETURNING id`,
      [org, facility, patientId, `test/${randomUUID()}`, dentist.userId],
    );
    ids.image = await one(
      `INSERT INTO dental_image (organization_id, facility_id, patient_id, document_id, encounter_id, kind, teeth, taken_on, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, 'panoramic', '{11,21}', $6, 'SECRET-IMAGE-NOTE', $7) RETURNING id`,
      [org, facility, patientId, documentId, ids.dentalEncounter, manilaDate(0), dentist.userId],
    );
    ids.imageShare = await one(`INSERT INTO dental_image_release (organization_id, image_id, released_by) VALUES ($1, $2, $3) RETURNING id`, [
      org,
      ids.image,
      dentist.userId,
    ]);
    ids.perio = await one(
      `INSERT INTO dental_perio_chart (organization_id, facility_id, patient_id, encounter_id, practitioner_id, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, 'SECRET-PERIO-NOTE', $6) RETURNING id`,
      [org, facility, patientId, ids.dentalEncounter, dentist.practitionerId, dentist.userId],
    );

    // 6. Billing: an issued invoice with a credit note, a debit note, and a deposit applied to it.
    const service = (
      await api(admin)
        .post("/billing/services", { code: "consult", name: "Consultation", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await api(cashier).post("/billing/charges", { patientId, serviceId: service }).expect(201);
    const draft = (await api(cashier).post("/billing/invoices", { patientId }).expect(201)).body;
    ids.invoice = draft.id;
    const issued = (await api(cashier).post(`/billing/invoices/${draft.id}/issue`, { version: draft.version }).expect(200)).body;
    ids.invoiceNumber = issued.invoiceNumber;
    ids.creditNote = await one(
      `INSERT INTO billing_credit_note (organization_id, facility_id, patient_id, invoice_id, credit_note_number, reason, amount, applied_amount, account_credit,
                                        idempotency_key, issued_by)
       VALUES ($1, $2, $3, $4, 'CN-000001', 'SECRET-CREDIT-REASON', 10000, 10000, 0, 'kinds-cn-0001', $5) RETURNING id`,
      [org, facility, patientId, ids.invoice, users.cashier],
    );
    ids.debitNote = await one(
      `INSERT INTO billing_debit_note (organization_id, facility_id, patient_id, invoice_id, debit_note_number, reason, amount, idempotency_key, issued_by)
       VALUES ($1, $2, $3, $4, 'DN-000001', 'SECRET-DEBIT-REASON', 5000, 'kinds-dn-0001', $5) RETURNING id`,
      [org, facility, patientId, ids.invoice, users.cashier],
    );
    ids.deposit = await one(
      `INSERT INTO billing_account_entry (organization_id, facility_id, patient_id, kind, amount, method, reference, receipt_number, idempotency_key, recorded_by)
       VALUES ($1, $2, $3, 'deposit', 30000, 'cash', 'SECRET-DEPOSIT-REF', 'DR-000001', 'kinds-dep-0001', $4) RETURNING id`,
      [org, facility, patientId, users.cashier],
    );
    ids.application = await one(
      `INSERT INTO billing_account_entry (organization_id, facility_id, patient_id, kind, amount, invoice_id, idempotency_key, recorded_by)
       VALUES ($1, $2, $3, 'application', 10000, $4, 'kinds-app-0001', $5) RETURNING id`,
      [org, facility, patientId, ids.invoice, users.cashier],
    );

    // 7. PhilHealth: a claim submission for the invoice, an eligibility answer (also on the retired record), a YAKAP answer.
    ids.claim = await one(
      `INSERT INTO integration_exchange (organization_id, system, operation, idempotency_key, patient_id, resource_type, resource_id, status, payload_digest,
                                         external_reference, outcome_detail, last_error, requested_by, completed_at)
       VALUES ($1, 'philhealth-eclaims', 'submit_claim', 'kinds-claim-0001', $2, 'billing_invoice', $3, 'accepted', $4, 'PHC-2026-0001',
               '{"reason": "SECRET-OUTCOME"}', 'SECRET-ERROR', $5, now()) RETURNING id`,
      [org, patientId, ids.invoice, "a".repeat(64), users.cashier],
    );
    ids.eligibility = await one(
      `INSERT INTO philhealth_eligibility_check (organization_id, facility_id, patient_id, service_date, status, source, external_reference, note, requested_by, completed_at)
       VALUES ($1, $2, $3, $4, 'eligible', 'external_channel', 'ELIG-0001', 'SECRET-ELIGIBILITY-NOTE', $5, now()) RETURNING id`,
      [org, facility, patientId, manilaDate(0), users.cashier],
    );
    ids.otherEligibility = await one(
      `INSERT INTO philhealth_eligibility_check (organization_id, facility_id, patient_id, service_date, status, source, external_reference, requested_by, completed_at)
       VALUES ($1, $2, $3, $4, 'not_eligible', 'external_channel', 'ELIG-0002', $5, now()) RETURNING id`,
      [org, facility, otherPatientId, manilaDate(-3), users.cashier],
    );
    ids.yakap = await one(
      `INSERT INTO philhealth_yakap_registration (organization_id, facility_id, patient_id, status, effective_date, external_reference, note, recorded_by)
       VALUES ($1, $2, $3, 'registered', '2026-01-01', 'YAKAP-0001', 'SECRET-YAKAP-NOTE', $4) RETURNING id`,
      [org, facility, patientId, users.cashier],
    );

    // 8. DOH: two case reports for two recorded diagnoses — one open, one reported through DOH's own channel.
    const rule = await one(
      `INSERT INTO doh_reportable_rule (organization_id, code_prefix, category, created_by) VALUES ($1, 'A90', 'Dengue (organization list)', $2) RETURNING id`,
      [org, users.admin],
    );
    const diagnosis = (code: string) =>
      one(
        `INSERT INTO diagnosis (organization_id, patient_id, encounter_id, code_system_key, code, display, rank, certainty, notes, recorded_by, updated_by)
         VALUES ($1, $2, $3, 'icd-10', $4, 'SECRET-DIAGNOSIS-TEXT', 'secondary', 'confirmed', 'SECRET-DIAGNOSIS-NOTE', $5, $5) RETURNING id`,
        [org, patientId, ids.encounter, code, doc.userId],
      );
    const [dx1, dx2] = [await diagnosis("A90"), await diagnosis("A91")];
    ids.caseOpen = await one(
      `INSERT INTO doh_case_report (organization_id, facility_id, patient_id, encounter_id, diagnosis_id, rule_id, category, diagnosis_code, diagnosis_display)
       VALUES ($1, $2, $3, $4, $5, $6, 'Dengue (organization list)', 'A90', 'SECRET-DIAGNOSIS-TEXT') RETURNING id`,
      [org, facility, patientId, ids.encounter, dx1, rule],
    );
    ids.caseReported = await one(
      `INSERT INTO doh_case_report (organization_id, facility_id, patient_id, encounter_id, diagnosis_id, rule_id, category, diagnosis_code, diagnosis_display,
                                    status, reported_via, external_reference, status_reason, detected_at, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Dengue (organization list)', 'A91', 'SECRET-DIAGNOSIS-TEXT', 'reported', 'external_channel', 'DOHREF-77',
               'SECRET-STATUS-REASON', now() - interval '2 hours', $7, now()) RETURNING id`,
      [org, facility, patientId, ids.encounter, dx2, rule, users.admin],
    );

    // 9. Dispensing: one dispense recorded, one reversed.
    const rx = (
      await api(doctor)
        .post("/prescriptions", {
          encounterId: ids.encounter,
          items: [
            {
              genericName: "Amoxicillin",
              strength: "500 mg",
              dosageForm: "capsule",
              doseAmount: 1,
              doseUnit: "capsule",
              route: "oral",
              frequency: "three_times_daily",
              durationValue: 7,
              durationUnit: "days",
              quantity: 21,
              quantityUnit: "capsules",
              instructions: "SECRET-INSTRUCTIONS",
            },
          ],
        })
        .expect(201)
    ).body;
    ids.prescription = rx.id;
    ids.prescriptionNumber = rx.prescriptionNumber;
    const item = await one(
      `INSERT INTO inventory_item (organization_id, code, name, category, stock_unit) VALUES ($1, 'amox-500', 'Amoxicillin 500 mg capsule', 'medicine', 'capsule') RETURNING id`,
      [org],
    );
    const location = await one(
      `INSERT INTO inventory_location (organization_id, facility_id, code, name) VALUES ($1, $2, 'pharmacy', 'Pharmacy') RETURNING id`,
      [org, facility],
    );
    const dispense = (extra: string, values: string) =>
      one(
        `INSERT INTO prescription_dispense (organization_id, facility_id, prescription_id, prescription_item_id, patient_id, inventory_item_id, location_id,
                                            quantity, item_name, stock_unit, stock_movement_group_id, note, dispensed_by${extra})
         VALUES ($1, $2, $3, $4, $5, $6, $7, 21, 'Amoxicillin 500 mg capsule', 'capsule', gen_random_uuid(), 'SECRET-DISPENSE-NOTE', $8${values}) RETURNING id`,
        [org, facility, rx.id, rx.items[0].id, patientId, item, location, users.admin],
      );
    ids.dispense = await dispense("", "");
    ids.reversedDispense = await dispense(
      ", status, reversed_by, reversed_at, reversal_reason, reversal_movement_group_id",
      ", 'reversed', $8, now() + interval '1 minute', 'SECRET-REVERSAL-REASON', gen_random_uuid()",
    );

    // 10. Medical certificates: one issued, one voided.
    const certificate = (number: string, extra: string, values: string) =>
      one(
        `INSERT INTO medical_certificate (organization_id, facility_id, patient_id, encounter_id, practitioner_id, certificate_number, examined_on, purpose,
                                          findings, recommendations, rest_from, rest_to, issued_by${extra})
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SECRET-PURPOSE', 'SECRET-FINDINGS', 'SECRET-RECOMMENDATIONS', $7, $7, $8${values}) RETURNING id`,
        [org, facility, patientId, ids.encounter, doc.practitionerId, number, manilaDate(0), doc.userId],
      );
    ids.certificate = await certificate("MC00000001", "", "");
    ids.voidCertificate = await certificate("MC00000002", ", status, voided_at, voided_by, void_reason", ", 'void', now(), $8, 'SECRET-VOID-REASON'");

    // 11. A records request from MyHealth.
    const account = await one(
      `INSERT INTO patient_portal_account (organization_id, patient_id, status, email, activation_code_hash, activation_expires_at, invited_by)
       VALUES ($1, $2, 'invited', 'juan@kinds.ph', 'x', now() + interval '1 day', $3) RETURNING id`,
      [org, patientId, users.admin],
    );
    ids.recordsRequest = await one(
      `INSERT INTO records_request (organization_id, patient_id, request_number, scope, details, purpose, portal_account_id)
       VALUES ($1, $2, 'RR00000001', '{laboratory,certificates}', 'SECRET-REQUEST-DETAILS', 'SECRET-REQUEST-PURPOSE', $3) RETURNING id`,
      [org, patientId, account],
    );

    // Paging fixtures on 10 February 2026 (Manila): rows of several new sources sharing one instant.
    const instant = "2026-02-10 02:00:00.500000+00";
    for (let i = 0; i < 3; i++) {
      await q(
        `INSERT INTO patient_consent (organization_id, patient_id, consent_type, decision, captured_via, recorded_by, effective_at) VALUES ($1, $2, 'research', 'refused', 'paper', $3, $4)`,
        [org, patientId, users.admin, instant],
      );
      await q(`INSERT INTO allergy_review (organization_id, patient_id, no_known_allergies, reviewed_by, reviewed_at) VALUES ($1, $2, false, $3, $4)`, [
        org,
        patientId,
        users.admin,
        instant,
      ]);
      await q(
        `INSERT INTO philhealth_yakap_registration (organization_id, facility_id, patient_id, status, recorded_by, recorded_at) VALUES ($1, $2, $3, 'unknown', $4, $5)`,
        [org, facility, patientId, users.admin, instant],
      );
    }

    // The retired record is merged into this patient; its rows stay filed under it (ADR-0009).
    const preview = (await api(admin).get(`/patients/${otherPatientId}/merge-preview?into=${patientId}`).expect(200)).body;
    expect(preview.blockers).toEqual([]);
    await api(admin)
      .post(`/patients/${otherPatientId}/merge`, {
        survivorPatientId: patientId,
        reason: "Registered twice",
        retiredVersion: preview.retired.version,
        survivorVersion: preview.survivor.version,
        acknowledgedDifferences: preview.differences.map((d: { code: string }) => d.code),
      })
      .expect(200);
  });

  afterAll(() => ctx.close());

  it("lists each further kind with its short display fields and link", async () => {
    const page = await timeline(admin, "?limit=100");
    expect(page.withheld).toEqual([]);
    const entries = byId(page);
    const entry = (id: string) => {
      const found = entries.get(id);
      if (!found) throw new Error(`no entry ${id}`);
      return found;
    };

    expect(entry(`queue_visit:${ids.visit}`)).toMatchObject({
      kind: "queue_visit",
      title: "Checked in: General consult",
      detail: "Queue number 7 · Walk-in · Urgent",
      status: "completed",
      marker: null,
      facility: { id: tenant.facilityId, name: "Main Clinic" },
      sourceIds: { visitId: ids.visit },
    });
    expect(entry(`triage:${ids.triage}`)).toMatchObject({
      kind: "triage",
      title: "Triage recorded",
      detail: "Priority: Urgent",
      status: "final",
      marker: null,
    });
    expect(entry(`allergy:${ids.allergy}`)).toMatchObject({
      kind: "allergy",
      title: "Allergy recorded: Penicillin",
      detail: "Medication · High criticality · Confirmed",
      status: "active",
      facility: null,
      link: { type: "patient_record", id: patientId },
    });
    expect(entry(`allergy_review:${ids.review}`)).toMatchObject({ kind: "allergy", title: "Allergies reviewed", status: null });
    expect(entry(`consent:${ids.consent}`)).toMatchObject({ kind: "consent", title: "Consent granted: Data processing", detail: "Paper", status: "granted" });
    expect(entry(`medical_certificate:${ids.certificate}`)).toMatchObject({
      kind: "medical_certificate",
      title: "Medical certificate MC00000001 issued",
      detail: "Dr. reyes",
      status: "issued",
      link: { type: "encounter", id: ids.encounter },
    });

    const collected = page.items.find((e) => e.id.startsWith("specimen_collected:") && e.sourceIds.specimenId === ids.kSpecimen);
    expect(collected).toMatchObject({
      kind: "specimen",
      title: "Specimen collected: Serum",
      detail: expect.stringMatching(/^Accession \S+ · Potassium · Order \S+$/),
      status: "collected",
      link: { type: "patient_laboratory", id: patientId },
    });
    expect(page.items.find((e) => e.id.startsWith("specimen_received:") && e.sourceIds.specimenId === ids.kSpecimen)).toMatchObject({
      title: "Specimen received: Serum",
    });
    // A rejected specimen's tests go back to be collected again, so the entry names none.
    expect(page.items.find((e) => e.id.startsWith("specimen_rejected:"))).toMatchObject({
      title: "Specimen rejected: Serum",
      detail: expect.stringMatching(/^Accession \S+ · Order \S+ · Recollection requested$/),
      status: "rejected",
      sourceIds: { specimenId: ids.naSpecimen, labOrderId: ids.labOrder },
    });
    expect(entry(`critical_communicated:${ids.alert}`)).toMatchObject({
      kind: "critical_value",
      title: "Critical result communicated: Potassium",
      detail: "To Dr. Reyes · Phone · Read back",
      status: "acknowledged",
      flag: "critical",
    });
    expect(entry(`critical_acknowledged:${ids.alert}`)).toMatchObject({ title: "Critical result acknowledged: Potassium", detail: null });

    expect(entry(`dental_image:${ids.image}`)).toMatchObject({
      kind: "dental_imaging",
      title: "Dental image recorded: Panoramic",
      detail: `Taken ${manilaDate(0)}`,
      status: "recorded",
      link: { type: "dental_record", id: patientId },
    });
    expect(entry(`dental_image_share:${ids.imageShare}`)).toMatchObject({ title: "Dental image shared in MyHealth: Panoramic", status: "shared" });
    expect(entry(`dental_perio:${ids.perio}`)).toMatchObject({ kind: "dental", title: "Periodontal chart recorded", status: "recorded" });

    expect(entry(`credit_note:${ids.creditNote}`)).toMatchObject({
      kind: "billing_note",
      title: "Credit note CN-000001 ₱100.00",
      detail: `Invoice ${ids.invoiceNumber}`,
      link: { type: "invoice", id: ids.invoice },
    });
    expect(entry(`debit_note:${ids.debitNote}`)).toMatchObject({ kind: "billing_note", title: "Debit note DN-000001 ₱50.00" });
    expect(entry(`account_entry:${ids.deposit}`)).toMatchObject({
      kind: "deposit",
      title: "Deposit ₱300.00",
      detail: "Cash · Receipt DR-000001",
      status: "deposit",
      link: { type: "billing_account", id: patientId },
    });
    expect(entry(`account_entry:${ids.application}`)).toMatchObject({
      title: "Deposit applied ₱100.00",
      detail: `Invoice ${ids.invoiceNumber}`,
      link: { type: "invoice", id: ids.invoice },
    });

    expect(entry(`philhealth_claim:${ids.claim}`)).toMatchObject({
      kind: "philhealth_claim",
      title: "PhilHealth claim submitted",
      detail: "Reference PHC-2026-0001",
      status: "accepted",
      facility: null,
      link: { type: "invoice", id: ids.invoice },
    });
    expect(entry(`philhealth_eligibility:${ids.eligibility}`)).toMatchObject({
      kind: "philhealth_eligibility",
      title: "PhilHealth eligibility: eligible",
      detail: `For services on ${manilaDate(0)} · Reference ELIG-0001`,
    });
    expect(entry(`yakap_registration:${ids.yakap}`)).toMatchObject({
      kind: "philhealth_eligibility",
      title: "YAKAP registration: Registered",
      detail: "Effective 2026-01-01 · Reference YAKAP-0001",
    });

    expect(entry(`doh_case_opened:${ids.caseOpen}`)).toMatchObject({
      kind: "doh_case_report",
      title: "Case report opened: Dengue (organization list)",
      detail: null,
      status: "pending_review",
      link: { type: "doh_case_report", id: ids.caseOpen },
    });
    expect(entry(`doh_case_opened:${ids.caseReported}`)).toMatchObject({ status: "reported" });
    expect(entry(`doh_case_reviewed:${ids.caseReported}`)).toMatchObject({ title: "Case reported to DOH: Dengue (organization list)" });
    expect(entries.has(`doh_case_reviewed:${ids.caseOpen}`)).toBe(false);

    expect(entry(`dispense:${ids.dispense}`)).toMatchObject({
      kind: "dispense",
      title: "Dispensed: Amoxicillin 500 mg capsule",
      detail: `21 capsule · Prescription ${ids.prescriptionNumber}`,
      status: "recorded",
      link: { type: "encounter", id: ids.encounter },
    });
    expect(entry(`dispense:${ids.reversedDispense}`)).toMatchObject({ status: "reversed" });
    expect(entry(`dispense_reversal:${ids.reversedDispense}`)).toMatchObject({ title: "Dispense reversed: Amoxicillin 500 mg capsule", status: "reversed" });
    expect(entries.has(`dispense_reversal:${ids.dispense}`)).toBe(false);

    expect(entry(`records_request:${ids.recordsRequest}`)).toMatchObject({
      kind: "records_request",
      title: "Records request RR00000001",
      detail: "Laboratory, Certificates",
      status: "submitted",
      facility: null,
      link: { type: "records_request", id: ids.recordsRequest },
    });

    const occurred = page.items.map((e) => e.occurredAt);
    expect(occurred).toEqual([...occurred].sort().reverse());
  });

  it("keeps entered-in-error, cancelled and void records listed and marked", async () => {
    const entries = byId(await timeline(admin, "?limit=100"));
    expect(entries.get(`allergy:${ids.allergyInError}`)).toMatchObject({ status: "entered_in_error", marker: "entered_in_error" });
    expect(entries.get(`triage:${ids.triageInError}`)).toMatchObject({ status: "entered_in_error", marker: "entered_in_error" });
    expect(entries.get(`queue_visit:${ids.cancelledVisit}`)).toMatchObject({ status: "cancelled", marker: "cancelled" });
    expect(entries.get(`medical_certificate:${ids.voidCertificate}`)).toMatchObject({ status: "void", marker: "void" });
  });

  it("never carries notes, reasons, complaints, values, references or other free text", async () => {
    const page = await timeline(admin, "?limit=100");
    const body = JSON.stringify(page);
    expect(body).not.toMatch(/SECRET/);
    expect(body).not.toContain("DOHREF-77");
    const text = page.items.flatMap((e) => [e.title, e.detail ?? "", e.status ?? ""]).join(" | ");
    expect(text).not.toContain("7.77");
    expect(text).not.toMatch(/mmol/i);
    // Diagnosis codes stay with the consultation; a case report shows the organization's category only.
    expect(
      page.items
        .filter((e) => e.kind === "doh_case_report")
        .map((e) => `${e.title} ${e.detail ?? ""}`)
        .join(" "),
    ).not.toMatch(/A9[01]/);
    // Teeth of a dental image are findings: not listed.
    expect(page.items.filter((e) => e.kind === "dental_imaging").map((e) => e.detail)).toEqual(expect.arrayContaining([`Taken ${manilaDate(0)}`, null]));
    expect(page.items.filter((e) => e.kind === "dental_imaging")).toHaveLength(2);
  });

  it("shows each kind only to callers with that domain's read permission", async () => {
    const kindsOf = (page: Page) => new Set(page.items.map((e) => e.kind));

    const forCashier = await timeline(cashier, "?limit=100");
    expect(kindsOf(forCashier)).toEqual(new Set(["consent", "invoice", "billing_note", "deposit", "philhealth_claim", "philhealth_eligibility"]));
    expect(forCashier.withheld).toEqual(
      expect.arrayContaining([
        "allergy",
        "queue_visit",
        "triage",
        "specimen",
        "critical_value",
        "dental_imaging",
        "dispense",
        "doh_case_report",
        "records_request",
      ]),
    );

    const forMedtech = await timeline(medtech, "?limit=100");
    expect(kindsOf(forMedtech)).toEqual(new Set(["consent", "lab_order", "specimen", "critical_value"]));

    const forDesk = await timeline(receptionist, "?limit=100");
    expect(forDesk.items.some((e) => e.kind === "queue_visit")).toBe(true);
    expect(forDesk.withheld).toEqual(expect.arrayContaining(["triage", "allergy", "medical_certificate", "dispense"]));

    const forDoctor = await timeline(doctor, "?limit=100");
    expect(forDoctor.withheld).toEqual([
      "dental_imaging",
      "invoice",
      "payment",
      "billing_note",
      "deposit",
      "philhealth_claim",
      "philhealth_eligibility",
      "records_request",
    ]);
    for (const kind of ["queue_visit", "triage", "allergy", "consent", "specimen", "critical_value", "dispense", "medical_certificate", "doh_case_report"]) {
      expect(kindsOf(forDoctor).has(kind)).toBe(true);
    }
  });

  it("reads the retired record's entries with the survivor, marked with the number they are filed under", async () => {
    const entries = byId(await timeline(admin, "?kinds=allergy,consent,philhealth_eligibility&limit=100"));
    expect(entries.get(`allergy_review:${ids.otherReview}`)).toMatchObject({ title: "Allergies reviewed: no known allergies", filedUnder: otherNumber });
    expect(entries.get(`consent:${ids.otherConsent}`)).toMatchObject({ title: "Consent withdrawn: Telemedicine", detail: "Verbal", filedUnder: otherNumber });
    expect(entries.get(`philhealth_eligibility:${ids.otherEligibility}`)).toMatchObject({
      title: "PhilHealth eligibility: not eligible",
      filedUnder: otherNumber,
    });
    expect(entries.get(`consent:${ids.consent}`)?.filedUnder).toBeNull();
  });

  it("pages across the new kinds sharing one timestamp without duplicates or gaps", async () => {
    const filter = "kinds=consent,allergy,philhealth_eligibility&from=2026-02-10&to=2026-02-10";
    const all = await timeline(admin, `?${filter}&limit=100`);
    expect(all.items).toHaveLength(9);
    const seen: Entry[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Page = await timeline(admin, `?${filter}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.map((e) => e.id)).toEqual(all.items.map((e) => e.id));
    expect(new Set(seen.map((e) => e.id)).size).toBe(9);

    // Across every kind of the whole record, too.
    const everything = await timeline(admin, "?limit=100");
    const paged: Entry[] = [];
    cursor = null;
    for (let i = 0; i < 100; i++) {
      const page: Page = await timeline(admin, `?limit=7${cursor ? `&cursor=${cursor}` : ""}`);
      paged.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(paged.map((e) => e.id)).toEqual(everything.items.map((e) => e.id));
  });

  it("leaves organization-level entries out of a facility filter", async () => {
    const main = await timeline(admin, `?facilityId=${tenant.facilityId}&limit=100`);
    const kinds = new Set(main.items.map((e) => e.kind));
    for (const kind of ["allergy", "consent", "records_request", "philhealth_claim"]) expect(kinds.has(kind)).toBe(false);
    for (const kind of ["queue_visit", "specimen", "deposit", "doh_case_report", "dispense"]) expect(kinds.has(kind)).toBe(true);
    expect((await timeline(admin, `?facilityId=${tenant.otherFacilityId}&limit=100`)).items).toEqual([]);
  });
});
