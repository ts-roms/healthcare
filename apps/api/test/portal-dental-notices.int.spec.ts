import { as, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Ngiti-sa-umaga-2026";

/**
 * MyHealth dental notices (docs/domains/dental.md, "Notices"): a patient who uses MyHealth hears that their dentist
 * shared an image or prepared a plan awaiting their decision — only while the organization shows dental records,
 * only if it is still true when the event is handled, once, and without clinical detail.
 */
describe("patient portal dental notices", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let patientId: string;
  let noPortalPatientId: string;
  let encounterId: string;
  const ids: Record<string, string> = {};

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const notices = async (forPatient = patientId) =>
    (
      await ctx.pool.query<{ channel: string; status: string; kind: string }>(
        `SELECT channel, status, variables->>'kind' AS kind FROM notification
         WHERE recipient_patient_id = $1 AND template_key = 'dental.record-update' ORDER BY created_at, channel`,
        [forPatient],
      )
    ).rows;
  const plan = async (forPatient = patientId) =>
    (
      await staff(dentist)
        .post("/dental/treatment-plans", {
          patientId: forPatient,
          title: "Restorative plan",
          items: [{ procedureTypeId: ids.composite, tooth: "16", surfaces: ["O"] }],
        })
        .expect(201)
    ).body as { id: string; version: number; items: Array<{ id: string }> };
  const image = async () => {
    const document = await staff(admin)
      .post("/documents", { category: "imaging", title: "Bitewing", fileName: "bw.png", contentType: "image/png", sizeBytes: 2048, patientId })
      .expect(201);
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [document.body.document.id]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 2048, contentType: "image/png" });
    await staff(admin).post(`/documents/${document.body.document.id}/complete`).expect(200);
    return (
      await staff(dentist)
        .post(`/dental/patients/${patientId}/images`, { documentId: document.body.document.id, kind: "bitewing", teeth: ["16"], takenOn: manilaDate(0) })
        .expect(201)
    ).body.id as string;
  };
  const setting = async (body: object) => {
    const current = (await staff(admin).get("/dental/settings/portal").expect(200)).body;
    await staff(admin)
      .put("/dental/settings/portal", { ...body, version: current.version })
      .expect(200);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "smile-notices");
    await createStaff(ctx.pool, tenant, "admin@notices.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@notices.ph", ["dentist"], "dentist");
    admin = (await login(ctx, "admin@notices.ph")).accessToken;
    dentist = (await login(ctx, "dentist@notices.ph")).accessToken;
    patientId = (await staff(admin).post("/patients", juan).expect(201)).body.id;
    noPortalPatientId = (
      await staff(admin)
        .post("/patients", { ...juan, givenName: "Maria", middleName: "Reyes", sex: "female", birthDate: "1991-07-19", identifiers: [] })
        .expect(201)
    ).body.id;

    // Juan uses MyHealth (consent, invitation, activation); Maria does not.
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
        organizationCode: "smile-notices",
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: "juan@notices.ph",
        password: PATIENT_PASSWORD,
      })
      .expect(200);

    ids.composite = (
      await staff(admin)
        .post("/dental/procedure-types", { code: "composite", name: "Composite restoration", site: "surface", chartEffect: "restoration" })
        .expect(201)
    ).body.id;
    encounterId = (await staff(dentist).post("/encounters", { patientId, chiefComplaint: "Check-up" }).expect(201)).body.id;
    expect(encounterId).toBeTruthy();
  });
  afterAll(() => ctx.close());

  it("sends nothing while the organization does not show dental records in MyHealth", async () => {
    await plan();
    const imageId = await image();
    await staff(dentist).post(`/dental/images/${imageId}/release`).expect(201);
    await drainEvents(ctx);
    expect(await notices()).toEqual([]);
    // Released while records were off: the notice is not sent later either (the release stays shared, not announced).
    await staff(dentist).post(`/dental/images/${imageId}/withdraw`, { reason: "Setting up MyHealth first" }).expect(200);
  });

  it("tells the patient a plan is ready to read, once per plan and day, with no clinical detail", async () => {
    await setting({ portalDentalRecords: true });
    const created = await plan();
    await staff(dentist)
      .post(`/dental/treatment-plans/${created.id}/items`, { procedureTypeId: ids.composite, tooth: "17", surfaces: ["O"], version: created.version })
      .expect(201);
    await drainEvents(ctx);
    // An in-app copy and an SMS (Juan has a mobile number); the item added the same day adds nothing.
    expect(await notices()).toEqual([
      { channel: "in_app", status: "delivered", kind: "plan-to-review" },
      { channel: "sms", status: "queued", kind: "plan-to-review" },
    ]);
    const sent = await ctx.pool.query("SELECT variables FROM notification WHERE template_key = 'dental.record-update'");
    expect(JSON.stringify(sent.rows)).not.toMatch(/Composite|16|17|restorative/i);

    // A patient without MyHealth is not told.
    await plan(noPortalPatientId);
    await drainEvents(ctx);
    expect(await notices(noPortalPatientId)).toEqual([]);
  });

  it("asks for a decision when the clinic allows online decisions, and not once the plan is decided", async () => {
    await setting({
      portalDentalRecords: true,
      portalPlanDecisions: true,
      portalPlanAcknowledgement: "I discussed this plan with my dentist and understand its options, risks and fees.",
    });
    await plan();
    await drainEvents(ctx);
    expect((await notices()).filter((n) => n.kind === "plan-to-decide").map((n) => n.channel)).toEqual(["in_app", "sms"]);

    // Decided at the clinic before the event was handled: nothing to announce.
    const decided = await plan();
    await staff(dentist)
      .post(`/dental/treatment-plans/${decided.id}/decision`, { acceptedItemIds: [decided.items[0]!.id], note: "Agreed at the chair", version: 1 })
      .expect(200);
    const before = (await notices()).length;
    await drainEvents(ctx);
    expect(await notices()).toHaveLength(before);
  });

  it("tells the patient an image was shared, unless it was withdrawn before the notice went out", async () => {
    const shared = await image();
    await staff(dentist).post(`/dental/images/${shared}/release`).expect(201);
    await drainEvents(ctx);
    expect((await notices()).filter((n) => n.kind === "image-shared").map((n) => n.channel)).toEqual(["in_app", "sms"]);

    const withdrawn = await image();
    await staff(dentist).post(`/dental/images/${withdrawn}/release`).expect(201);
    await staff(dentist).post(`/dental/images/${withdrawn}/withdraw`, { reason: "Shared the wrong image" }).expect(200);
    await drainEvents(ctx);
    expect((await notices()).filter((n) => n.kind === "image-shared")).toHaveLength(2);

    // The in-app copy appears in the MyHealth inbox with a link to the dental record.
    const token = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "smile-notices", email: "juan@notices.ph", password: PATIENT_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    const inbox = await ctx
      .http()
      .get("/api/v1/portal/messages")
      .set({ authorization: `Bearer ${token}` })
      .expect(200);
    const dental = (inbox.body.messages ?? inbox.body).filter((m: { templateKey: string }) => m.templateKey === "dental.record-update");
    expect(dental.length).toBeGreaterThanOrEqual(3);
    expect(dental.map((m: { text: string }) => m.text).join(" ")).toMatch(/shared an X-ray or photo/);
  });
});
