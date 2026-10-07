import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Diagnosis coding systems (docs/domains/clinic.md; D10): registered, renamed, re-editioned and deactivated by
 * clinic.configure; a deactivated system refuses new diagnoses while recorded ones keep their code and system.
 */
describe("diagnosis coding systems", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let systemId = "";

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "coding-systems-org");
    await createStaff(ctx.pool, tenant, "admin@coding.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@coding.ph", ["physician"]);
    admin = (await login(ctx, "admin@coding.ph")).accessToken;
    doctor = (await login(ctx, "doctor@coding.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("registers, renames and re-editions a system; the key never changes", async () => {
    systemId = (await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201)).body.id;
    await api(doctor).patch(`/clinic/coding-systems/${systemId}`, { name: "x" }).expect(403);
    const edited = await api(admin).patch(`/clinic/coding-systems/${systemId}`, { name: "ICD-10 (PH edition)", version: "2024" }).expect(200);
    expect(edited.body).toMatchObject({ key: "icd-10", name: "ICD-10 (PH edition)", version: "2024", status: "active" });
    const keyIgnored = await api(admin).patch(`/clinic/coding-systems/${systemId}`, { key: "icd-11" }).expect(422);
    expect(keyIgnored.body.error.code).toBe("nothing_to_change");
    const cleared = await api(admin).patch(`/clinic/coding-systems/${systemId}`, { version: null }).expect(200);
    expect(cleared.body.version).toBeNull();
    const events = await auditRows(ctx.pool, "action = 'coding-system.update'");
    expect(events).toHaveLength(2);
  });

  it("refuses new diagnoses against a deactivated system and keeps recorded ones", async () => {
    const visitTypeId = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)).body
      .id;
    const patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const visitId = (await api(admin).post("/queue/walk-ins", { patientId, visitTypeId, chiefComplaint: "Follow-up" }).expect(201)).body.id;
    const encounterId = (await api(doctor).post("/encounters", { visitId }).expect(201)).body.id;
    const recorded = await api(doctor)
      .post(`/encounters/${encounterId}/diagnoses`, {
        codeSystemKey: "icd-10",
        code: "E11.9",
        display: "Type 2 diabetes mellitus",
        rank: "primary",
        certainty: "confirmed",
      })
      .expect(201);

    const off = await api(admin).patch(`/clinic/coding-systems/${systemId}`, { status: "inactive" }).expect(200);
    expect(off.body.status).toBe("inactive");
    const refused = await api(doctor)
      .post(`/encounters/${encounterId}/diagnoses`, {
        codeSystemKey: "icd-10",
        code: "I10",
        display: "Hypertension",
        rank: "secondary",
        certainty: "provisional",
      })
      .expect(422);
    expect(refused.body.error.code).toBe("unknown_coding_system");
    const { rows } = await ctx.pool.query<{ code: string; code_system_key: string }>("SELECT code, code_system_key FROM diagnosis WHERE id = $1", [
      recorded.body.id,
    ]);
    expect(rows[0]).toEqual({ code: "E11.9", code_system_key: "icd-10" });
    // Still listed (inactive) for staff with encounter.read; the staff app filters to active ones for new diagnoses.
    const listed = (await api(doctor).get("/clinic/coding-systems").expect(200)).body;
    expect(listed).toEqual([expect.objectContaining({ id: systemId, status: "inactive" })]);
    await api(admin).patch(`/clinic/coding-systems/${systemId}`, { status: "active" }).expect(200);
  });
});
