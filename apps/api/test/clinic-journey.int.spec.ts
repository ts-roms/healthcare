import {
  as,
  auditRows,
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

/**
 * CLAUDE.md §31 critical journey (clinic part):
 * registration → appointment → check-in → triage → consultation → diagnosis
 * → prescription → sign → amendment → care plan → follow-up → Patient 360.
 */
describe("clinic journey", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let desk: string;
  let nurse: string;
  let doctor: string;
  let otherDoctor: string;
  let visitTypeId: string;
  let practitionerId: string;
  let patientId: string;
  let appointmentId: string;
  let visitId: string;
  let encounterId: string;
  let diagnosisId: string;
  let prescriptionId: string;
  let carePlanId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "journey-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@example.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "nurse@example.ph", ["nurse"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "santos@example.ph", ["physician"]));
    await createClinician(ctx, tenant, "reyes@example.ph", ["physician"]);
    const admin = (await login(ctx, "admin@example.ph")).accessToken;
    desk = (await login(ctx, "desk@example.ph")).accessToken;
    nurse = (await login(ctx, "nurse@example.ph")).accessToken;
    doctor = (await login(ctx, "santos@example.ph")).accessToken;
    otherDoctor = (await login(ctx, "reyes@example.ph")).accessToken;

    visitTypeId = (
      await ctx.http().post("/api/v1/clinic/visit-types").set(as(admin)).send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)
    ).body.id;
    await ctx.http().post("/api/v1/clinic/coding-systems").set(as(admin)).send({ key: "icd10", name: "ICD-10", version: "2019" }).expect(201);
  });

  afterAll(() => ctx.close());

  const deskAt = () => as(desk, tenant.facilityId);
  const nurseAt = () => as(nurse, tenant.facilityId);
  const doctorAt = () => as(doctor, tenant.facilityId);

  it("registers the patient and books an appointment for later today", async () => {
    patientId = (await ctx.http().post("/api/v1/patients").set(deskAt()).send(juan).expect(201)).body.id;
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const booked = await ctx
      .http()
      .post("/api/v1/appointments")
      .set(deskAt())
      .send({ patientId, practitionerId, facilityId: tenant.facilityId, visitTypeId, startsAt, outsideSchedule: true, reason: "Fatigue and thirst" })
      .expect(201);
    appointmentId = booked.body[0].id;
  });

  it("checks the patient in and shows them on the queue with a ticket", async () => {
    const visit = await ctx.http().post(`/api/v1/appointments/${appointmentId}/check-in`).set(deskAt()).send({}).expect(201);
    visitId = visit.body.id;
    expect(visit.body).toMatchObject({ status: "waiting", ticket: "A-001", arrivalMode: "appointment", chiefComplaint: "Fatigue and thirst" });
    await ctx.http().post(`/api/v1/appointments/${appointmentId}/check-in`).set(deskAt()).send({}).expect(422);

    // A walk-in with urgent priority is served first.
    const other = (
      await ctx
        .http()
        .post("/api/v1/patients")
        .set(deskAt())
        .send({ familyName: "Garcia", givenName: "Ana", sex: "female", birthDate: "1990-02-02" })
        .expect(201)
    ).body.id;
    await ctx
      .http()
      .post("/api/v1/queue/walk-ins")
      .set(deskAt())
      .send({ patientId: other, visitTypeId, priority: "urgent", chiefComplaint: "Chest pain" })
      .expect(201);
    await ctx.http().post("/api/v1/queue/walk-ins").set(deskAt()).send({ patientId: other, visitTypeId }).expect(409);

    const queue = await ctx.http().get("/api/v1/queue").set(deskAt()).expect(200);
    expect(queue.body.map((q: { ticket: string; priority: string }) => [q.ticket, q.priority])).toEqual([
      ["A-002", "urgent"],
      ["A-001", "routine"],
    ]);
    expect(queue.body[1].patient).toMatchObject({ displayName: "DELA CRUZ, Juan Santos", patientNumber: "P00000001" });
    // The facility-scoped receptionist has no queue access at another facility.
    await ctx.http().get("/api/v1/queue").set(as(desk, tenant.otherFacilityId)).expect(403);
  });

  it("records triage, rejecting implausible vital signs", async () => {
    const implausible = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/triage`)
      .set(nurseAt())
      .send({ chiefComplaint: "Fatigue, polyuria", priority: "routine", vitals: { temperatureC: 368, systolicMmhg: 130, diastolicMmhg: 85 } })
      .expect(422);
    expect(implausible.body.error).toMatchObject({ code: "implausible_vital_signs", details: [expect.objectContaining({ field: "temperatureC" })] });

    const triage = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/triage`)
      .set(nurseAt())
      .send({
        chiefComplaint: "Fatigue, polyuria",
        priority: "routine",
        riskFlags: ["family history of diabetes"],
        vitals: { temperatureC: 36.8, systolicMmhg: 130, diastolicMmhg: 85, heartRateBpm: 82, weightKg: 82, heightCm: 168, bloodGlucoseMgDl: 212 },
      })
      .expect(201);
    expect(triage.body.visit.status).toBe("awaiting_consultation");
    expect(triage.body.vitals.bmi).toBe(29.1);
  });

  it('distinguishes "no known allergies" from "not reviewed" and records allergies', async () => {
    const before = await ctx.http().get(`/api/v1/patients/${patientId}/allergies`).set(as(nurse)).expect(200);
    expect(before.body.status).toBe("not_reviewed");
    await ctx
      .http()
      .post(`/api/v1/patients/${patientId}/allergies`)
      .set(as(nurse))
      .send({ category: "medication", substance: "Penicillin", reaction: "Hives", criticality: "high" })
      .expect(201);
    await ctx.http().post(`/api/v1/patients/${patientId}/allergies`).set(as(nurse)).send({ category: "medication", substance: "penicillin" }).expect(409);
    const nka = await ctx.http().post(`/api/v1/patients/${patientId}/allergy-reviews`).set(as(nurse)).send({ noKnownAllergies: true }).expect(422);
    expect(nka.body.error.code).toBe("allergies_recorded");
  });

  it("lets only a linked practitioner start the consultation", async () => {
    await ctx.http().post("/api/v1/encounters").set(nurseAt()).send({ visitId }).expect(403);
    const started = await ctx.http().post("/api/v1/encounters").set(doctorAt()).send({ visitId }).expect(201);
    encounterId = started.body.id;
    expect(started.body).toMatchObject({ status: "in_progress", practitionerId, chiefComplaint: "Fatigue, polyuria" });
    await ctx.http().post("/api/v1/encounters").set(as(otherDoctor, tenant.facilityId)).send({ visitId }).expect(409);
    const visit = await ctx.http().get(`/api/v1/queue/visits/${visitId}`).set(nurseAt()).expect(200);
    expect(visit.body.status).toBe("in_consultation");
    // The queue row links to the consultation so staff can open it.
    const queue = await ctx.http().get("/api/v1/queue").set(nurseAt()).expect(200);
    expect(queue.body.find((q: { id: string }) => q.id === visitId)).toMatchObject({ encounterId });
    expect(queue.body.filter((q: { id: string }) => q.id !== visitId).every((q: { encounterId: unknown }) => q.encounterId === null)).toBe(true);
  });

  it("keeps every note revision and refuses stale edits", async () => {
    const note = {
      subjective: "2 weeks fatigue, thirst, polyuria",
      objective: "BP 130/85, CBG 212 mg/dL",
      assessment: "Probable type 2 diabetes",
      plan: "HbA1c, metformin, diet counselling",
    };
    await ctx
      .http()
      .put(`/api/v1/encounters/${encounterId}/note`)
      .set(doctorAt())
      .send({ ...note, basedOnRevision: 0 })
      .expect(200);
    const stale = await ctx
      .http()
      .put(`/api/v1/encounters/${encounterId}/note`)
      .set(doctorAt())
      .send({ ...note, basedOnRevision: 0 })
      .expect(409);
    expect(stale.body.error).toMatchObject({ code: "note_revision_conflict", details: { latestRevision: 1 } });
    await ctx
      .http()
      .put(`/api/v1/encounters/${encounterId}/note`)
      .set(doctorAt())
      .send({ ...note, templateKey: "soap-diabetes", sections: { footExam: "normal" }, basedOnRevision: 1 })
      .expect(200);
  });

  it("records coded diagnoses from a configured coding system", async () => {
    const primary = await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(doctorAt())
      .send({
        codeSystemKey: "icd10",
        code: "e11.9",
        display: "Type 2 diabetes mellitus without complications",
        rank: "primary",
        certainty: "provisional",
        isChronic: true,
      })
      .expect(201);
    diagnosisId = primary.body.id;
    expect(primary.body).toMatchObject({ code: "E11.9", codeSystemVersion: "2019" });
    const second = await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(doctorAt())
      .send({ display: "Hypertension", rank: "primary" })
      .expect(409);
    expect(second.body.error.code).toBe("primary_diagnosis_exists");
    const unknown = await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(doctorAt())
      .send({ codeSystemKey: "snomed", code: "44054006", display: "DM2" })
      .expect(422);
    expect(unknown.body.error.code).toBe("unknown_coding_system");
    await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(doctorAt())
      .send({ display: "Elevated blood pressure, no diagnosis of hypertension" })
      .expect(201);
  });

  it("warns on drug–allergy matches as decision support and logs the override", async () => {
    const penicillin = {
      genericName: "Phenoxymethylpenicillin",
      brandName: "Penicillin V",
      strength: "500 mg",
      dosageForm: "tablet",
      route: "oral",
      frequency: "four_times_daily",
      durationValue: 7,
      durationUnit: "days",
      quantity: 28,
      quantityUnit: "tablet",
      instructions: "Take 1 tablet every 6 hours",
    };
    await ctx
      .http()
      .post("/api/v1/prescriptions")
      .set(as(nurse))
      .send({ encounterId, items: [penicillin] })
      .expect(403);
    const warned = await ctx
      .http()
      .post("/api/v1/prescriptions")
      .set(doctorAt())
      .send({ encounterId, items: [penicillin] })
      .expect(409);
    expect(warned.body.error).toMatchObject({
      code: "allergy_warning",
      details: { decisionSupport: true, warnings: [expect.objectContaining({ substance: "Penicillin", criticality: "high" })] },
    });
    const overridden = await ctx
      .http()
      .post("/api/v1/prescriptions")
      .set(doctorAt())
      .send({ encounterId, items: [penicillin], allergyOverrideReason: "Documented tolerance after allergist challenge test (2024)" })
      .expect(201);
    expect(overridden.body.allergyWarnings).toHaveLength(1);
    expect(await auditRows(ctx.pool, `action = 'decision-support.override'`)).toHaveLength(1);
    await ctx.http().post(`/api/v1/prescriptions/${overridden.body.id}/cancel`).set(doctorAt()).send({ reason: "Not indicated after review" }).expect(200);

    const metformin = await ctx
      .http()
      .post("/api/v1/prescriptions")
      .set(doctorAt())
      .send({
        encounterId,
        items: [
          {
            genericName: "Metformin",
            strength: "500 mg",
            dosageForm: "tablet",
            doseAmount: 1,
            doseUnit: "tablet",
            route: "oral",
            frequency: "twice_daily",
            durationValue: 30,
            durationUnit: "days",
            quantity: 60,
            quantityUnit: "tablet",
            refills: 2,
            instructions: "Take with meals",
          },
        ],
      })
      .expect(201);
    prescriptionId = metformin.body.id;
    expect(metformin.body).toMatchObject({
      prescriptionNumber: "RX00000002",
      status: "active",
      items: [expect.objectContaining({ lineNumber: 1, genericName: "Metformin" })],
    });
  });

  it("lets only the responsible practitioner sign, and completes the visit and appointment", async () => {
    const current = await ctx.http().get(`/api/v1/encounters/${encounterId}`).set(doctorAt()).expect(200);
    expect(current.body.note).toMatchObject({ revisionNumber: 2, kind: "draft", templateKey: "soap-diabetes" });
    expect(current.body.vitals).toHaveLength(1);
    expect(current.body.triage).toHaveLength(1);
    await ctx.http().post(`/api/v1/encounters/${encounterId}/sign`).set(nurseAt()).send({ version: current.body.version }).expect(403);
    await ctx.http().post(`/api/v1/encounters/${encounterId}/sign`).set(as(otherDoctor)).send({ version: current.body.version }).expect(403);
    const signed = await ctx.http().post(`/api/v1/encounters/${encounterId}/sign`).set(doctorAt()).send({ version: current.body.version }).expect(200);
    expect(signed.body.status).toBe("completed");

    const visit = await ctx.http().get(`/api/v1/queue/visits/${visitId}`).set(nurseAt()).expect(200);
    expect(visit.body.status).toBe("completed");
    const appointment = await ctx.http().get(`/api/v1/appointments/${appointmentId}`).set(deskAt()).expect(200);
    expect(appointment.body.status).toBe("completed");
  });

  it("changes a signed encounter only by amendment, keeping the signed text", async () => {
    const draft = await ctx.http().put(`/api/v1/encounters/${encounterId}/note`).set(doctorAt()).send({ plan: "changed", basedOnRevision: 3 }).expect(422);
    expect(draft.body.error.code).toBe("encounter_signed");
    await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/amendments`)
      .set(doctorAt())
      .send({
        assessment: "Type 2 diabetes mellitus",
        plan: "HbA1c today; metformin; follow-up in 4 weeks",
        basedOnRevision: 3,
        reason: "Clarified plan after reviewing results",
      })
      .expect(201);
    const revisions = await ctx.http().get(`/api/v1/encounters/${encounterId}/revisions`).set(doctorAt()).expect(200);
    expect(revisions.body.map((r: { kind: string }) => r.kind)).toEqual(["draft", "draft", "signed", "amendment"]);
    await expect(ctx.pool.query(`UPDATE encounter_note_revision SET plan = 'tampered'`)).rejects.toThrow(/append-only/);

    // Diagnoses on a signed encounter need an amendment reason.
    await ctx.http().post(`/api/v1/encounters/${encounterId}/diagnoses`).set(doctorAt()).send({ display: "Dyslipidemia" }).expect(422);
    await ctx
      .http()
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(doctorAt())
      .send({ display: "Dyslipidemia", amendmentReason: "Lipid panel reviewed" })
      .expect(201);
  });

  it("keeps prescriptions immutable: corrections replace them", async () => {
    await expect(ctx.pool.query(`UPDATE prescription SET notes = 'tampered' WHERE id = $1`, [prescriptionId])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`UPDATE prescription_item SET quantity = 999`)).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query(`DELETE FROM prescription WHERE id = $1`, [prescriptionId])).rejects.toThrow(/cannot be deleted/);
    await ctx
      .http()
      .post("/api/v1/prescriptions")
      .set(doctorAt())
      .send({
        encounterId,
        items: [{ genericName: "Losartan", route: "oral", frequency: "once_daily", quantity: 30, quantityUnit: "tablet", instructions: "Daily" }],
      })
      .expect(422);

    const replaced = await ctx
      .http()
      .post(`/api/v1/prescriptions/${prescriptionId}/replace`)
      .set(doctorAt())
      .send({
        reason: "Dose adjusted",
        items: [
          {
            genericName: "Metformin",
            strength: "850 mg",
            route: "oral",
            frequency: "twice_daily",
            quantity: 60,
            quantityUnit: "tablet",
            instructions: "Take with meals",
          },
        ],
      })
      .expect(201);
    expect(replaced.body.replacesPrescriptionId).toBe(prescriptionId);
    const old = await ctx.http().get(`/api/v1/prescriptions/${prescriptionId}`).set(doctorAt()).expect(200);
    expect(old.body).toMatchObject({ status: "superseded", cancellationReason: "Dose adjusted" });
    prescriptionId = replaced.body.id;
  });

  it("creates a care plan linked to the diagnosis, with recurring monitoring and a scheduled follow-up", async () => {
    const plan = await ctx
      .http()
      .post("/api/v1/care-plans")
      .set(doctorAt())
      .send({
        patientId,
        title: "Type 2 diabetes care plan",
        category: "chronic_disease",
        startDate: manilaDate(0),
        authorPractitionerId: practitionerId,
        sourceEncounterId: encounterId,
        problems: [{ diagnosisId, description: "Type 2 diabetes mellitus" }],
        goals: [{ description: "Glycemic control", targetMeasure: "HbA1c", targetValue: "< 7.0 %", targetDate: manilaDate(180) }],
        activities: [
          { kind: "laboratory_monitoring", description: "HbA1c", assignee: "care_team", dueDate: manilaDate(0), recurrenceIntervalDays: 90, goalIndex: 0 },
          { kind: "follow_up_appointment", description: "Diabetes follow-up", assignee: "care_team", dueDate: manilaDate(28) },
          { kind: "lifestyle", description: "Diet: reduce refined rice and sugary drinks", assignee: "patient" },
        ],
      })
      .expect(201);
    carePlanId = plan.body.id;
    expect(plan.body.problems[0].diagnosisId).toBe(diagnosisId);
    expect(plan.body.activities).toHaveLength(3);

    // References must belong to the same patient (database-enforced).
    const other = (
      await ctx.http().post("/api/v1/patients").set(deskAt()).send({ familyName: "Cruz", givenName: "Leo", sex: "male", birthDate: "1970-01-01" }).expect(201)
    ).body.id;
    const foreign = await ctx
      .http()
      .post("/api/v1/care-plans")
      .set(doctorAt())
      .send({ patientId: other, title: "Wrong", category: "other", startDate: manilaDate(0), problems: [{ diagnosisId, description: "x" }] })
      .expect(422);
    expect(foreign.body.error.code).toBe("invalid_reference");

    const due = await ctx.http().get("/api/v1/care-plans/activities/due?withinDays=0").set(as(nurse)).expect(200);
    expect(due.body.map((a: { description: string }) => a.description)).toEqual(["HbA1c"]);

    const hba1c = plan.body.activities.find((a: { kind: string }) => a.kind === "laboratory_monitoring");
    const completed = await ctx
      .http()
      .patch(`/api/v1/care-plans/${carePlanId}/activities/${hba1c.id}`)
      .set(as(nurse))
      .send({ status: "completed" })
      .expect(200);
    const next = completed.body.activities.find((a: { kind: string; status: string }) => a.kind === "laboratory_monitoring" && a.status === "planned");
    expect(next.dueDate).toBe(manilaDate(90));

    const followUp = plan.body.activities.find((a: { kind: string }) => a.kind === "follow_up_appointment");
    const booked = await ctx
      .http()
      .post("/api/v1/appointments")
      .set(deskAt())
      .send({
        patientId,
        practitionerId,
        facilityId: tenant.facilityId,
        visitTypeId,
        startsAt: new Date(Date.now() + 28 * 86_400_000).toISOString(),
        outsideSchedule: true,
        bookingChannel: "follow_up",
      })
      .expect(201);
    await ctx.http().patch(`/api/v1/care-plans/${carePlanId}/activities/${followUp.id}`).set(as(nurse)).send({ status: "scheduled" }).expect(400);
    const scheduled = await ctx
      .http()
      .patch(`/api/v1/care-plans/${carePlanId}/activities/${followUp.id}`)
      .set(as(nurse))
      .send({ status: "scheduled", appointmentId: booked.body[0].id })
      .expect(200);
    expect(scheduled.body.activities.find((a: { id: string }) => a.id === followUp.id)).toMatchObject({
      status: "scheduled",
      linkedAppointmentId: booked.body[0].id,
    });
    await ctx
      .http()
      .post(`/api/v1/care-plans/${carePlanId}/progress-notes`)
      .set(as(nurse))
      .send({ note: "Counselled on diet; patient motivated." })
      .expect(201);
  });

  it("shows the connected picture in Patient 360", async () => {
    await ctx.http().get(`/api/v1/patients/${patientId}/summary`).set(as(desk, tenant.facilityId)).expect(403);
    const summary = await ctx.http().get(`/api/v1/patients/${patientId}/summary`).set(doctorAt()).expect(200);
    expect(summary.body.patient).toMatchObject({ patientNumber: "P00000001", displayName: "DELA CRUZ, Juan Santos" });
    expect(summary.body.allergies).toMatchObject({ status: "has_allergies", allergies: [expect.objectContaining({ substance: "Penicillin" })] });
    expect(summary.body.problemList.map((p: { code: string | null }) => p.code)).toContain("E11.9");
    expect(summary.body.activePrescriptions.map((p: { id: string }) => p.id)).toEqual([prescriptionId]);
    expect(summary.body.openCarePlans[0]).toMatchObject({ id: carePlanId, title: "Type 2 diabetes care plan" });
    expect(summary.body.latestVitals[0]).toMatchObject({ bloodGlucoseMgDl: 212, bmi: 29.1 });
    expect(summary.body.upcomingAppointments).toHaveLength(1);
    expect(await auditRows(ctx.pool, `action = 'patient.summary-view' AND patient_id = $1`, [patientId])).toHaveLength(1);
  });

  it("summarizes the day on the clinic dashboard", async () => {
    const dashboard = await ctx.http().get("/api/v1/clinic/dashboard").set(deskAt()).expect(200);
    expect(dashboard.body).toMatchObject({
      appointments: { byStatus: { completed: 1 } },
      queue: { waiting: 1, byStatus: { completed: 1, waiting: 1 } },
      encounters: { completedToday: 1, inProgress: 0 },
    });
    expect(dashboard.body.providerWorkload[0]).toMatchObject({ practitionerId, seen: 1 });
  });

  it("records domain events for the whole journey in the outbox", async () => {
    const { rows } = await ctx.pool.query(`SELECT DISTINCT event_type FROM domain_event`);
    expect(rows.map((r) => r.event_type).sort()).toEqual(
      expect.arrayContaining([
        "AppointmentBooked",
        "AppointmentCheckedIn",
        "CarePlanActivityCompleted",
        "CarePlanCreated",
        "DiagnosisRecorded",
        "EncounterAmended",
        "EncounterCompleted",
        "EncounterStarted",
        "PrescriptionCancelled",
        "PrescriptionIssued",
        "QueueEntryUpdated",
        "TriageCompleted",
      ]),
    );
    await drainEvents(ctx);
    const pending = await ctx.pool.query(`SELECT count(*)::int AS n FROM domain_event WHERE published_at IS NULL`);
    expect(pending.rows[0].n).toBe(0);
    // Payloads carry identifiers, never clinical free text.
    const payloads = await ctx.pool.query(`SELECT payload::text AS p FROM domain_event`);
    expect(payloads.rows.some((r) => /diabetes|penicillin|fatigue/i.test(r.p))).toBe(false);
  });
});
