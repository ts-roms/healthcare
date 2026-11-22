import { randomUUID } from "node:crypto";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  surface: string;
  severity: string;
  basis: string;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; resourceType: string; resourceId: string; value?: string }>;
  action?: { label: string; href: string };
}

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";

/**
 * Phase 3 of the assistant, the pharmacy and online consultations (docs/domains/assistant.md): on the pharmacy's home,
 * medicines that waiting prescriptions need more of than the facility holds; on the dispense screen, stock that would
 * expire before the course ends; in an online consultation, reasons to consider seeing the patient in person. Off until
 * turned on; nothing is ordered, dispensed or escalated by the assistant; no patient is named.
 */
describe("pharmacy and online consultation suggestions", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let practitionerId: string;
  let pharmacist: string;
  let receptionist: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string) => ({
    put: (url: string, body: object) =>
      ctx
        .http()
        .put(`/api/v1/portal/teleconsults${url}`)
        .set({ authorization: `Bearer ${token}` })
        .send(body),
    post: (url: string) =>
      ctx
        .http()
        .post(`/api/v1/portal/teleconsults${url}`)
        .set({ authorization: `Bearer ${token}` }),
  });
  const turnOn = (ruleId: string, parameters?: object) =>
    api(admin)
      .put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0, ...(parameters ? { parameters } : {}) })
      .expect(200);
  const suggestions = async (token: string, query: string) =>
    (await api(token).get(`/assistant/suggestions?${query}`).expect(200)).body as { items: Suggestion[]; withheld: number };
  const pharmacy = async (ruleId: string, query = "") => (await suggestions(pharmacist, `surface=pharmacy${query}`)).items.filter((s) => s.ruleId === ruleId);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-rx");
    await createStaff(ctx.pool, tenant, "admin@rx.ph", ["org_admin"]);
    ({ practitionerId } = await createClinician(ctx, tenant, "doctor@rx.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "pharmacist@rx.ph", ["pharmacist"]);
    await createStaff(ctx.pool, tenant, "reception@rx.ph", ["receptionist"]);
    [admin, doctor, pharmacist, receptionist] = await Promise.all(
      ["admin", "doctor", "pharmacist", "reception"].map(async (u) => (await login(ctx, `${u}@rx.ph`)).accessToken),
    );

    // Stock: amoxicillin 500 mg in two places (the pharmacy's lot expires in 3 days), and another strength.
    const inv = async (url: string, body: object) => (await api(admin).post(`/inventory${url}`, body).expect(201)).body.id as string;
    ids.pharmacy = await inv("/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" });
    ids.store = await inv("/locations", { facilityId: tenant.facilityId, code: "store", name: "Store room" });
    ids.amox = await inv("/items", { code: "amox-500", name: "Amoxicillin 500 mg capsule", category: "medicine", stockUnit: "capsule" });
    ids.amox250 = await inv("/items", { code: "amox-250", name: "Amoxicillin 250 mg capsule", category: "medicine", stockUnit: "capsule" });
    const receive = (locationId: string, itemId: string, lotNumber: string, days: number, quantity: number) =>
      inv("/receipts", { locationId, itemId, lotNumber, expiryDate: manilaDate(days), quantity, idempotencyKey: randomUUID() });
    await receive(ids.pharmacy, ids.amox, "AMX-SOON", 3, 10);
    await receive(ids.store, ids.amox, "AMX-LATE", 200, 5);
    await receive(ids.pharmacy, ids.amox250, "AMX250", 200, 100);

    // A consultation with a 7-day course of 21 capsules.
    ids.consult = (
      await api(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
    ).body.id;
    ids.patient = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const visit = await api(admin).post("/queue/walk-ins", { patientId: ids.patient, visitTypeId: ids.consult }).expect(201);
    ids.encounter = (await api(doctor).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id;
    const rx = await api(doctor)
      .post("/prescriptions", {
        encounterId: ids.encounter,
        items: [
          {
            genericName: "Amoxicillin",
            strength: "500 mg",
            route: "oral",
            frequency: "three_times_daily",
            durationValue: 7,
            durationUnit: "days",
            quantity: 21,
            quantityUnit: "capsules",
            instructions: "One capsule three times a day",
          },
        ],
      })
      .expect(201);
    ids.rx = rx.body.id;
    ids.rxNumber = rx.body.prescriptionNumber;
    ids.rxItem = rx.body.items[0].id;
  });
  afterAll(() => ctx.close());

  it("tells the pharmacy which waiting prescriptions its stock cannot fill, by medicine and never by patient", async () => {
    expect(await pharmacy("dispensing.short-stock")).toEqual([]);
    await turnOn("dispensing.short-stock");
    // Pharmacists see suggestions since migration 0157.
    const [s, ...rest] = await pharmacy("dispensing.short-stock");
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      surface: "pharmacy",
      severity: "advice",
      basis: "rule",
      title: "Amoxicillin 500 mg: 21 capsules left to dispense on 1 prescription, 15 in stock",
      action: { href: "/inventory" },
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Amoxicillin 500 mg capsule at Pharmacy", "10 capsule"],
      ["Amoxicillin 500 mg capsule at Store room", "5 capsule"],
      [ids.rxNumber, `21 capsules left, issued ${manilaDate(0)}`],
    ]);
    expect(JSON.stringify(s)).not.toMatch(/Juan|Dela Cruz/i);
    // A receptionist may use the assistant but does not dispense: withheld, without counts.
    const reception = await suggestions(receptionist, "surface=pharmacy");
    expect(reception.items).toEqual([]);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);
    // It belongs to the pharmacy's home, not to the dispense screen.
    expect(await pharmacy("dispensing.short-stock", `&prescriptionId=${ids.rx}`)).toEqual([]);
  });

  it("points out stock that would expire before the course ends, and replays the day's dispenses", async () => {
    expect(await pharmacy("dispensing.course-expiry", `&prescriptionId=${ids.rx}`)).toEqual([]);
    await turnOn("dispensing.course-expiry");
    const [s] = await pharmacy("dispensing.course-expiry", `&prescriptionId=${ids.rx}`);
    expect(s).toMatchObject({
      id: `dispensing.course-expiry@1:prescription:${ids.rx}:item:${ids.rxItem}`,
      severity: "advice",
      title: `Amoxicillin 500 mg: the lot taken first at Pharmacy expires ${manilaDate(3)}, before this 7-day course ends (${manilaDate(6)})`,
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Amoxicillin 500 mg capsule at Pharmacy", `first lot AMX-SOON expires ${manilaDate(3)}`],
      ["Amoxicillin 500 mg capsule at Store room", `first lot AMX-LATE expires ${manilaDate(200)} (lasts the course)`],
    ]);
    // Only on the dispense screen of a prescription; the audit names the prescription, not the patient.
    expect(await pharmacy("dispensing.course-expiry")).toEqual([]);
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'pharmacy' AND metadata ? 'prescriptionId'");
    expect(audit.map((a) => a.metadata)).toContainEqual(expect.objectContaining({ prescriptionId: ids.rx }));

    // The pharmacist hands over the 10 capsules of the pharmacy anyway (they are taken first): nothing short is left there.
    await api(pharmacist)
      .post(`/dispensing/prescriptions/${ids.rx}/dispenses`, {
        lines: [{ prescriptionItemId: ids.rxItem, inventoryItemId: ids.amox, locationId: ids.pharmacy, quantity: 10 }],
      })
      .expect(201);
    expect(await pharmacy("dispensing.course-expiry", `&prescriptionId=${ids.rx}`)).toEqual([]);
    const [still] = await pharmacy("dispensing.short-stock");
    expect(still!.title).toBe("Amoxicillin 500 mg: 11 capsules left to dispense on 1 prescription, 5 in stock");

    // Replayed: had that dispense been yesterday, the check would have spoken that day (it took the lot expiring first).
    await ctx.pool.query("ALTER TABLE prescription_dispense DISABLE TRIGGER USER");
    await ctx.pool.query(
      `UPDATE prescription_dispense
         SET dispensed_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') - interval '1 day' + interval '10 hours') AT TIME ZONE 'Asia/Manila'
       WHERE prescription_id = $1`,
      [ids.rx],
    );
    await ctx.pool.query("ALTER TABLE prescription_dispense ENABLE TRIGGER USER");
    const replay = (await api(admin).post("/assistant/rules/dispensing.course-expiry/replay", { days: 3 }).expect(200)).body;
    expect(replay).toMatchObject({ readAt: "17:00" });
    expect(replay.days.map((d: { suggestions: number }) => d.suggestions)).toEqual([0, 0, 1]);
  });

  it("asks the doctor to consider care in person in an online consultation, from red flags and the patient's care", async () => {
    // A MyHealth patient books an online consultation, answers the questionnaire with a red flag and waits.
    const online = (
      await api(admin)
        .post("/clinic/visit-types", {
          code: "online",
          name: "Online consultation",
          defaultDurationMinutes: 20,
          modality: "telemedicine",
          requiresTriage: false,
        })
        .expect(201)
    ).body.id;
    const birthDate = "1975-08-09";
    const created = await api(admin)
      .post("/patients", { familyName: "Villanueva", givenName: "Lourdes", sex: "female", birthDate, contacts: [{ system: "mobile", value: "0917 555 0199" }] })
      .expect(201);
    const patientId = created.body.id as string;
    await api(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const email = "lourdes@rx.ph";
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: "assistant-rx", patientNumber: created.body.patientNumber, birthDate, activationCode: code, email, password: PATIENT_PASSWORD })
      .expect(200);
    const token = (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "assistant-rx", email, password: PATIENT_PASSWORD }).expect(200))
      .body.accessToken as string;
    const startsAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const appointmentId = (
      await api(admin)
        .post("/appointments", {
          patientId,
          practitionerId,
          facilityId: tenant.facilityId,
          visitTypeId: online,
          startsAt,
          outsideSchedule: true,
          reason: "Chest pain",
        })
        .expect(201)
    ).body[0].id as string;
    await portal(token)
      .put(`/${appointmentId}/questionnaire`, {
        reasonForVisit: "Chest discomfort since last month",
        symptomDurationDays: 20,
        redFlags: ["chest_pain"],
        locationCity: "Pasig",
        callbackNumber: "0917 555 0199",
        acknowledgesOnlineConsultation: true,
      })
      .expect(200);
    await portal(token).post(`/${appointmentId}/waiting-room`).expect(200);
    const encounterId = (await api(doctor).post(`/telemedicine/consultations/${appointmentId}/start`).expect(200)).body.session.encounterId as string;

    const inPerson = async (id: string, as = doctor) =>
      (await suggestions(as, `surface=encounter&encounterId=${id}`)).items.filter((s) => s.ruleId === "telemedicine.in-person-care");
    expect(await inPerson(encounterId)).toEqual([]);
    await turnOn("telemedicine.in-person-care");
    const [s, ...rest] = await inPerson(encounterId);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      id: `telemedicine.in-person-care@1:encounter:${encounterId}`,
      surface: "encounter",
      severity: "warning",
      title: "Consider seeing the patient in person: 1 red flag ticked; symptoms for 20 days; never seen in person here",
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Red flag ticked by the patient", "Chest pain or pressure"],
      ["Symptoms lasted (the patient's answer)", "20 days"],
      ["Online consultations in 30 days", "1 (this one included)"],
      ["Last in-person consultation", "none recorded here"],
      ["Last vital signs", "none recorded here"],
    ]);
    // Never the patient's words or name.
    expect(JSON.stringify(s)).not.toMatch(/discomfort|Lourdes|Villanueva/i);
    // A receptionist may use the assistant but reads no consultations: withheld. An in-person consultation: nothing.
    expect((await suggestions(receptionist, `surface=encounter&encounterId=${encounterId}`)).withheld).toBeGreaterThanOrEqual(1);
    expect(await inPerson(ids.encounter)).toEqual([]);

    // Two more online consultations this month and an in-person one two months ago.
    await ctx.pool.query(
      `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, modality, status, started_at, started_by, completed_at, signed_by_practitioner_id)
       SELECT $1, $2, $3, p.id, m, 'completed', now() - make_interval(days => d), p.user_id, now() - make_interval(days => d) + interval '20 minutes', p.id
       FROM practitioner p, (VALUES ('telemedicine', 5), ('telemedicine', 12), ('in_person', 60)) AS earlier(m, d)
       WHERE p.id = $4`,
      [tenant.organizationId, tenant.facilityId, patientId, practitionerId],
    );
    const [again] = await inPerson(encounterId);
    expect(again!.title).toBe("Consider seeing the patient in person: 1 red flag ticked; symptoms for 20 days; 3 online consultations in 30 days");
    expect(again!.evidence.find((e) => e.label === "Last in-person consultation")?.value).toBe(manilaDate(-60));
    // Nothing was escalated.
    const { rows } = await ctx.pool.query("SELECT status FROM telemedicine_session WHERE appointment_id = $1", [appointmentId]);
    expect(rows[0].status).toBe("in_consultation");
  });
});
