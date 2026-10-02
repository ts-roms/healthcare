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
  type Tenant,
  type TestContext,
} from "./harness";

/**
 * Referrals (docs/domains/clinic.md, "Referrals"): the consultation's responsible practitioner refers the patient to a
 * practitioner here (accept or decline, appointment, complete) or to an outside provider (reply recorded); the letter is
 * stored once as a referral_letter document; what the referrer wrote never changes.
 */
describe("referrals", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let doctor: string;
  let specialist: string;
  let otherDoctor: string;
  let nurse: string;
  let reception: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const pdfText = (buffer: Buffer) => extractPdfText(buffer).replace(/·/g, "").replace(/\s+/g, " ");

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "referrals-org");
    await createStaff(ctx.pool, tenant, "admin@refer.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@refer.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "reception@refer.ph", ["receptionist"]);
    await createClinician(ctx, tenant, "doctor@refer.ph", ["physician"]);
    const specialistRecord = await createClinician(ctx, tenant, "specialist@refer.ph", ["physician"]);
    ids.specialistUser = specialistRecord.userId;
    ids.specialist = specialistRecord.practitionerId;
    await createClinician(ctx, tenant, "other@refer.ph", ["physician"]);
    const admin = (await login(ctx, "admin@refer.ph")).accessToken;
    [doctor, specialist, otherDoctor, nurse, reception] = await Promise.all(
      ["doctor", "specialist", "other", "nurse", "reception"].map(async (u) => (await login(ctx, `${u}@refer.ph`)).accessToken),
    );
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
    await api(doctor).post(`/patients/${patientId}/allergies`, { category: "medication", substance: "Penicillin", reaction: "Hives" }).expect(201);
    ids.encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Chest pain on exertion" }).expect(201)).body.id;
    ids.diagnosis = (
      await api(doctor)
        .post(`/encounters/${ids.encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "I20.9", display: "Angina pectoris", rank: "primary" })
        .expect(201)
    ).body.id;
    ids.visitType = (
      await api(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("is made by the consultation's responsible practitioner, to a practitioner here or an outside provider", async () => {
    const internal = {
      kind: "internal",
      toPractitionerId: ids.specialist,
      specialty: "Cardiology",
      urgency: "urgent",
      reason: "Exertional chest pain; please evaluate",
    };
    await api(nurse).post(`/encounters/${ids.encounter}/referrals`, internal).expect(403);
    await api(otherDoctor).post(`/encounters/${ids.encounter}/referrals`, internal).expect(403);
    await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, { ...internal, toPractitionerId: undefined })
      .expect(400);
    await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, { ...internal, externalProvider: "Heart Center" })
      .expect(400);
    await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, { ...internal, diagnosisIds: [randomUUID()] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("diagnosis_not_in_encounter"));

    const created = await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, { ...internal, clinicalSummary: "ECG unremarkable at rest", diagnosisIds: [ids.diagnosis] })
      .expect(201);
    expect(created.body).toMatchObject({
      referralNumber: "RF00000001",
      kind: "internal",
      status: "sent",
      toPractitioner: { id: ids.specialist },
      diagnoses: [{ code: "I20.9" }],
      byYou: true,
    });
    ids.internal = created.body.id;

    const external = await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, {
        kind: "external",
        externalProvider: "Dr. R. Reyes, Cardiology",
        externalFacility: "Heart Center",
        externalContact: "0917 000 0000",
        reason: "Stress test",
      })
      .expect(201);
    expect(external.body).toMatchObject({ referralNumber: "RF00000002", kind: "external", toPractitioner: null });
    ids.external = external.body.id;
  });

  it("stores the letter once as a referral_letter document of the patient", async () => {
    const letter = await api(nurse).get(`/referrals/${ids.internal}/letter.pdf`).buffer(true).parse(binary).expect(200);
    const text = pdfText(letter.body as Buffer);
    for (const expected of [
      "Referral",
      "RF00000001",
      "DELA CRUZ, Juan Santos",
      "Cardiology",
      "Urgent",
      "Exertional chest pain",
      "I20.9",
      "Penicillin",
      "PRC-0000000",
    ]) {
      expect(text).toContain(expected);
    }
    const docs = await ctx.pool.query<{ id: string; category: string }>("SELECT id, category FROM document WHERE patient_id = $1 ORDER BY created_at", [
      patientId,
    ]);
    expect(docs.rows).toEqual([
      { id: ids.internal, category: "referral_letter" },
      { id: ids.external, category: "referral_letter" },
    ]);
  });

  it("tells the practitioner referred to, who accepts it; an appointment is linked and they complete it", async () => {
    await drainEvents(ctx);
    const notices = await ctx.pool.query<{ template_key: string; variables: { kind: string } }>(
      "SELECT template_key, variables FROM notification WHERE recipient_user_id = $1",
      [ids.specialistUser],
    );
    expect(notices.rows).toEqual([expect.objectContaining({ template_key: "clinic.referral-notice", variables: expect.objectContaining({ kind: "new" }) })]);

    const mine = (await api(specialist).get("/referrals?view=to_me").expect(200)).body;
    expect(mine.map((r: { id: string; forYou: boolean }) => [r.id, r.forYou])).toEqual([[ids.internal, true]]);
    await api(otherDoctor).post(`/referrals/${ids.internal}/answer`, { decision: "accept", version: 1 }).expect(403);
    await api(specialist).post(`/referrals/${ids.internal}/answer`, { decision: "decline", version: 1 }).expect(400);
    const accepted = await api(specialist)
      .post(`/referrals/${ids.internal}/answer`, { decision: "accept", note: "Will see this week", version: 1 })
      .expect(200);
    expect(accepted.body).toMatchObject({ status: "accepted", responseNote: "Will see this week" });
    await api(specialist)
      .post(`/referrals/${ids.internal}/answer`, { decision: "decline", note: "Changed my mind", version: 2 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_referral_status"));

    // An appointment with the specialist, linked to the referral.
    const appointmentId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO appointment (id, organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, booking_channel, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day', now() + interval '1 day 15 minutes', 'front_desk', $7, $7)`,
      [appointmentId, tenant.organizationId, tenant.facilityId, patientId, ids.specialist, ids.visitType, ids.specialistUser],
    );
    await api(nurse).post(`/referrals/${ids.internal}/appointment`, { appointmentId, version: 2 }).expect(403);
    const linked = await api(reception).post(`/referrals/${ids.internal}/appointment`, { appointmentId, version: 2 }).expect(200);
    expect(linked.body.appointmentId).toBe(appointmentId);

    await api(doctor).post(`/referrals/${ids.internal}/complete`, { outcomeNote: "Seen", version: 3 }).expect(403);
    const completed = await api(specialist)
      .post(`/referrals/${ids.internal}/complete`, { outcomeNote: "Stable angina; started on medication, follow up in a month", version: 3 })
      .expect(200);
    expect(completed.body.status).toBe("completed");

    await drainEvents(ctx);
    const back = await ctx.pool.query<{ variables: { kind: string } }>(
      "SELECT n.variables FROM notification n JOIN practitioner p ON p.user_id = n.recipient_user_id WHERE n.template_key = 'clinic.referral-notice' AND p.id <> $1 ORDER BY n.created_at",
      [ids.specialist],
    );
    expect(back.rows.map((r) => r.variables.kind)).toEqual(["accepted", "completed"]);
  });

  it("records an outside provider's reply, and cancels an open referral with a reason", async () => {
    await api(doctor).post(`/referrals/${ids.external}/answer`, { decision: "accept", version: 1 }).expect(422);
    const reply = randomUUID();
    await ctx.pool.query(
      `INSERT INTO document (id, organization_id, facility_id, patient_id, category, title, file_name, content_type, size_bytes, storage_key, status, uploaded_at, source, scan_status, scanned_at)
       VALUES ($1, $2, $3, $4, 'clinical_attachment', 'Stress test report', 'report.pdf', 'application/pdf', 1000, $5, 'available', now(), 'generated', 'clean', now())`,
      [reply, tenant.organizationId, tenant.facilityId, patientId, `org/${tenant.organizationId}/documents/${reply}`],
    );
    const done = await api(doctor)
      .post(`/referrals/${ids.external}/complete`, { outcomeNote: "Stress test negative", replyDocumentId: reply, version: 1 })
      .expect(200);
    expect(done.body).toMatchObject({ status: "completed", replyDocumentId: reply });

    const again = await api(doctor)
      .post(`/encounters/${ids.encounter}/referrals`, { kind: "external", externalProvider: "Somewhere", reason: "Second opinion" })
      .expect(201);
    // The referrer, or staff who may amend consultations (physicians may); a nurse may not.
    await api(nurse).post(`/referrals/${again.body.id}/cancel`, { reason: "Not needed", version: 1 }).expect(403);
    const cancelled = await api(doctor).post(`/referrals/${again.body.id}/cancel`, { reason: "Patient prefers to wait", version: 1 }).expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    const doc = await ctx.pool.query<{ status: string }>("SELECT status FROM document WHERE id = $1", [again.body.id]);
    expect(doc.rows[0]?.status).toBe("archived");
    const copy = await api(doctor).get(`/referrals/${again.body.id}/letter.pdf`).buffer(true).parse(binary).expect(200);
    expect(extractPdfText(copy.body as Buffer)).toContain("CANCELLED");
  });

  it("never changes what the referrer wrote, lists referrals on the timeline, and keeps events free of clinical text", async () => {
    await expect(ctx.pool.query("UPDATE referral SET reason = 'Other' WHERE id = $1", [ids.internal])).rejects.toThrow(/not edited/);
    await expect(ctx.pool.query("DELETE FROM referral WHERE id = $1", [ids.internal])).rejects.toThrow(/never deleted/);

    const timeline = (await api(doctor).get(`/patients/${patientId}/timeline?kinds=referral`).expect(200)).body;
    expect(timeline.items.map((i: { title: string; status: string }) => [i.title, i.status])).toEqual([
      ["Referral RF00000003", "cancelled"],
      ["Referral RF00000002", "completed"],
      ["Referral RF00000001: Cardiology", "completed"],
    ]);
    expect(JSON.stringify(timeline)).not.toContain("chest pain");

    const audit = await auditRows(ctx.pool, "action LIKE 'encounter.referral.%' AND resource_id = $1", [ids.internal]);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["encounter.referral.create", "encounter.referral.accept", "encounter.referral.appointment", "encounter.referral.complete"]),
    );
    const events = await ctx.pool.query("SELECT event_type, payload FROM domain_event WHERE aggregate_type = 'referral' ORDER BY occurred_at");
    expect(events.rows.map((e: { event_type: string }) => e.event_type)).toEqual([
      "ReferralCreated",
      "ReferralCreated",
      "ReferralAccepted",
      "ReferralCompleted",
      "ReferralCompleted",
      "ReferralCreated",
      "ReferralCancelled",
    ]);
    expect(JSON.stringify(events.rows)).not.toMatch(/chest pain|Stress test/i);
  });
});
