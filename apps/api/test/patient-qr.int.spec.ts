import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, login, type Tenant, type TestContext } from "./harness";
import { extractPdfText } from "@healthcare/pdf";

/**
 * Patient QR codes (docs/domains/patient.md): the organization's setting, issuing at registration or from the record,
 * revoking, the card, and scanning. A code holds only a key; scans are audited without the payload.
 */
describe("patient QR codes", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let doctor: string;
  let other: string;

  const api = (token: string, facility: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facility)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facility)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facility)).send(body),
  });
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);
  const person = (n: number) => ({
    familyName: `Qrtestfamily${n}`,
    givenName: `Qrgiven${n}`,
    sex: "female",
    birthDate: `19${70 + n}-0${n}-1${n}`,
    contacts: [],
    addresses: [],
    identifiers: [],
  });
  const register = async (n: number, extra: object = {}) =>
    (
      await api(desk)
        .post("/patients", { ...person(n), ...extra })
        .expect(201)
    ).body as {
      id: string;
      patientNumber: string;
      qrCodeIssued: boolean;
    };
  const setSetting = async (body: { enabled: boolean; issueAtRegistration: boolean; content: "token" | "patient_number" }) => {
    const current = (await api(admin).get("/patient-qr/setting").expect(200)).body as { version: number };
    return api(admin)
      .put("/patient-qr/setting", { ...body, version: current.version })
      .expect(200);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "qr-org");
    await createStaff(ctx.pool, tenant, "admin@qr.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@qr.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "doctor@qr.ph", ["physician"]);
    admin = (await login(ctx, "admin@qr.ph")).accessToken;
    desk = (await login(ctx, "desk@qr.ph")).accessToken;
    doctor = (await login(ctx, "doctor@qr.ph")).accessToken;
    const otherTenant = await createTenant(ctx.pool, "qr-other");
    await createStaff(ctx.pool, otherTenant, "admin@qr-other.ph", ["org_admin"]);
    other = (await login(ctx, "admin@qr-other.ph")).accessToken;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("is off until the organization turns it on, and only the administrator changes the setting", async () => {
    const initial = (await api(desk).get("/patient-qr/setting").expect(200)).body;
    expect(initial).toMatchObject({ enabled: false, content: "token", version: 0 });
    const before = await register(1);
    expect(before.qrCodeIssued).toBe(false);
    // Asking for a code while the feature is off changes nothing.
    expect((await register(2, { issueQrCode: true })).qrCodeIssued).toBe(false);
    await api(desk).put("/patient-qr/setting", { enabled: true, issueAtRegistration: true, content: "token", version: 0 }).expect(403);
    await api(desk).post(`/patient-qr/patients/${before.id}`).expect(422);
    const saved = await setSetting({ enabled: true, issueAtRegistration: true, content: "token" });
    expect(saved.body).toMatchObject({ enabled: true, issueAtRegistration: true, content: "token", version: 1 });
    // A stale version is refused.
    await api(admin).put("/patient-qr/setting", { enabled: true, issueAtRegistration: true, content: "token", version: 0 }).expect(409);
    expect(await auditRows(ctx.pool, "action = 'patient.qr-setting.update'")).toHaveLength(1);
  });

  it("issues a code at registration by the setting and lets the registering person decline", async () => {
    const withCode = await register(3);
    expect(withCode.qrCodeIssued).toBe(true);
    const declined = await register(4, { issueQrCode: false });
    expect(declined.qrCodeIssued).toBe(false);
    const state = (await api(desk).get(`/patient-qr/patients/${withCode.id}`).expect(200)).body as {
      enabled: boolean;
      active: { id: string; payload: string; content: string; issuedVia: string };
      history: unknown[];
    };
    expect(state.active.issuedVia).toBe("registration");
    expect(state.active.content).toBe("token");
    expect(state.active.payload).toMatch(/^HPQ1:T:[A-Z2-7]{26}$/);
    expect(state.active.payload).not.toContain(withCode.patientNumber);
    expect((await api(desk).get(`/patient-qr/patients/${declined.id}`).expect(200)).body.active).toBeNull();

    await drainEvents(ctx);
    const events = await q(`SELECT event_type, payload FROM domain_event WHERE event_type = 'PatientQrIssued'`);
    expect(events.rows).toHaveLength(1);
    expect(Object.keys(events.rows[0].payload).sort()).toEqual(["patientId", "qrCodeId"]);
  });

  it("resolves a scan to a minimal summary, audited without the payload", async () => {
    const patient = await register(5);
    const { payload } = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body.active as { payload: string };
    const scan = await api(desk)
      .post("/patient-qr/scan", { payload: ` ${payload}\n` })
      .expect(200);
    expect(scan.body.patient).toMatchObject({ id: patient.id, patientNumber: patient.patientNumber });
    // Nothing clinical or contact-related in the answer.
    expect(Object.keys(scan.body.patient)).not.toContain("allergies");
    const scans = await auditRows(ctx.pool, "action = 'patient.qr.scan' AND outcome = 'success' AND patient_id = $1", [patient.id]);
    expect(scans).toHaveLength(1);
    const everything = JSON.stringify(await auditRows(ctx.pool));
    expect(everything).not.toContain(payload);
    expect(everything).not.toContain(payload.slice("HPQ1:T:".length));
    // Not ours, unknown, another organization's.
    await api(desk).post("/patient-qr/scan", { payload: "P00000001" }).expect(422);
    await api(desk)
      .post("/patient-qr/scan", { payload: `HPQ1:T:${"A".repeat(26)}` })
      .expect(404);
    // Another organization (with QR codes on) never resolves this organization's code.
    await ctx
      .http()
      .put("/api/v1/patient-qr/setting")
      .set(as(other))
      .send({ enabled: true, issueAtRegistration: true, content: "token", version: 0 })
      .expect(200);
    await ctx.http().post("/api/v1/patient-qr/scan").set(as(other)).send({ payload }).expect(404);
    // Seeing and printing the code is for the people who issue cards, not every clinician.
    await api(doctor).get(`/patient-qr/patients/${patient.id}`).expect(403);
  });

  it("prints the card with the name and number but not the key", async () => {
    const patient = await register(6);
    const state = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body as { active: { payload: string } };
    const res = await ctx
      .http()
      .get(`/api/v1/patient-qr/patients/${patient.id}/card.pdf`)
      .set(as(desk, tenant.facilityId))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    const text = extractPdfText(res.body as Buffer);
    expect(text).toContain(patient.patientNumber);
    expect(text).toContain("QRTESTFAMILY6");
    expect(text).not.toContain(state.active.payload);
    expect(await auditRows(ctx.pool, "action = 'patient.qr.print' AND patient_id = $1", [patient.id])).toHaveLength(1);
  });

  it("revokes a lost card with a reason, refuses its scans, and allows a replacement", async () => {
    const patient = await register(7);
    const { payload } = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body.active as { payload: string };
    // One active code at a time.
    await api(desk).post(`/patient-qr/patients/${patient.id}`).expect(409);
    await api(desk).post(`/patient-qr/patients/${patient.id}/revoke`, { reason: "no" }).expect(400);
    await api(desk).post(`/patient-qr/patients/${patient.id}/revoke`, { reason: "Card lost on the jeepney" }).expect(200);
    const refused = await api(desk).post("/patient-qr/scan", { payload }).expect(422);
    expect(refused.body.error.code).toBe("qr_revoked");
    expect(await auditRows(ctx.pool, "action = 'patient.qr.scan' AND outcome = 'denied' AND patient_id = $1", [patient.id])).toHaveLength(1);
    await api(desk).get(`/patient-qr/patients/${patient.id}/card.pdf`).expect(404);

    const replacement = await api(desk).post(`/patient-qr/patients/${patient.id}`).expect(201);
    expect(replacement.body.issuedVia).toBe("patient_record");
    const state = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body as {
      active: { payload: string };
      history: Array<{ revokeReason: string }>;
    };
    expect(state.active.payload).not.toBe(payload);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.revokeReason).toBe("Card lost on the jeepney");
    await api(desk).post("/patient-qr/scan", { payload }).expect(422);
    await api(desk).post("/patient-qr/scan", { payload: state.active.payload }).expect(200);
  });

  it("never edits or deletes a code in the database", async () => {
    await expect(q(`UPDATE patient_qr_code SET token = 'A' || substr(token, 2)`)).rejects.toThrow();
    await expect(q(`DELETE FROM patient_qr_code`)).rejects.toThrow();
    await expect(
      q(`UPDATE patient_qr_code SET status = 'active', revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE status = 'revoked'`),
    ).rejects.toThrow();
  });

  it("can encode the patient number instead, accepted only while a code is active", async () => {
    await setSetting({ enabled: true, issueAtRegistration: true, content: "patient_number" });
    const patient = await register(8);
    const { payload, content } = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body.active as { payload: string; content: string };
    expect(content).toBe("patient_number");
    expect(payload).toBe(`HPQ1:N:${patient.patientNumber}`);
    expect((await api(desk).post("/patient-qr/scan", { payload }).expect(200)).body.patient.id).toBe(patient.id);
    await api(desk).post(`/patient-qr/patients/${patient.id}/revoke`, { reason: "Wristband removed by mistake" }).expect(200);
    expect((await api(desk).post("/patient-qr/scan", { payload }).expect(422)).body.error.code).toBe("qr_revoked");
    // A patient who never had a code is simply not found by number.
    const without = await register(9, { issueQrCode: false });
    await api(desk)
      .post("/patient-qr/scan", { payload: `HPQ1:N:${without.patientNumber}` })
      .expect(404);
  });

  it("turning the feature off refuses scans", async () => {
    const patient = await register(1, { familyName: "Qroffswitch", givenName: "Pat", birthDate: "1991-01-01" });
    const { payload } = (await api(desk).get(`/patient-qr/patients/${patient.id}`).expect(200)).body.active as { payload: string };
    await setSetting({ enabled: false, issueAtRegistration: true, content: "token" });
    expect((await api(desk).post("/patient-qr/scan", { payload }).expect(422)).body.error.code).toBe("qr_disabled");
    // Same-sex same-name sanity: the plain patient lookup is unaffected.
    await api(desk).get(`/patients?q=${patient.patientNumber}`).expect(200);
  });
});
