import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/**
 * Pre-registration from MyHealth before a first visit (migration 0150, docs/domains/kiosk.md): off until the
 * organization turns it on with its own privacy notice; a request waits sealed for reception, who approve it through the
 * ordinary registration after checking the person's identification; nothing becomes a patient or access on its own.
 */
describe("MyHealth pre-registration", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  const ORG = "prereg-org";

  const publicApi = {
    info: (code = ORG) => ctx.http().get(`/api/v1/portal/pre-registration?organizationCode=${code}`),
    submit: (body: object) => ctx.http().post("/api/v1/portal/pre-registration").send(body),
  };
  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/kiosk/admin${url}`).set(as(token, tenant.facilityId)),
    put: (url: string, body: object) => ctx.http().put(`/api/v1/kiosk/admin${url}`).set(as(token, tenant.facilityId)).send(body),
    post: (url: string, body: object) => ctx.http().post(`/api/v1/kiosk/admin${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const person = (over: Record<string, unknown> = {}) => ({
    organizationCode: ORG,
    facilityId: tenant.facilityId,
    noticeVersion: 1,
    familyName: "Villanueva",
    givenName: "Marites",
    sex: "female",
    birthDate: "1988-06-21",
    contacts: [{ system: "mobile", value: "0917 444 0303" }],
    addresses: [{ cityMunicipality: "Pasig City" }],
    emergencyContact: { name: "Jose Villanueva", contactNumber: "0917 444 0304", relationship: "spouse" },
    privacyAcknowledged: true,
    ...over,
  });
  const NOTICE = "Your details are used only to register you as a patient of this clinic. The records office reviews them.";

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@prereg.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@prereg.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@prereg.ph")).accessToken;
    desk = (await login(ctx, "desk@prereg.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("is off until the organization turns it on, and says nothing more for an unknown clinic", async () => {
    expect((await publicApi.info().expect(200)).body).toEqual({ enabled: false });
    expect((await publicApi.info("no-such-clinic").expect(200)).body).toEqual({ enabled: false });
    expect((await publicApi.submit(person()).expect(422)).body.error.code).toBe("pre_registration_unavailable");
    expect((await publicApi.submit(person({ organizationCode: "no-such-clinic" })).expect(422)).body.error.code).toBe("pre_registration_unavailable");
  });

  it("is turned on only with the organization's own privacy notice, by someone who configures the clinic", async () => {
    await staff(admin).put("/pre-registration-settings", { enabled: true, noticeText: null, retentionDays: 7 }).expect(400);
    await staff(desk).put("/pre-registration-settings", { enabled: true, noticeText: NOTICE, retentionDays: 7 }).expect(403);
    const set = (await staff(admin).put("/pre-registration-settings", { enabled: true, noticeText: NOTICE, retentionDays: 7 }).expect(200)).body;
    expect(set).toMatchObject({ enabled: true, noticeVersion: 1, retentionDays: 7 });
    const info = (await publicApi.info().expect(200)).body;
    expect(info).toMatchObject({ enabled: true, notice: { text: NOTICE, version: 1 } });
    expect(info.facilities.map((f: { id: string }) => f.id)).toContain(tenant.facilityId);
    expect(await auditRows(ctx.pool, "action = 'myhealth.pre-registration.settings'")).toHaveLength(1);
  });

  it("stores a request sealed, answers only a reference, and creates no patient", async () => {
    const before = (await ctx.pool.query("SELECT count(*)::int AS n FROM patient")).rows[0].n;
    const sent = (await publicApi.submit(person()).expect(202)).body;
    expect(sent).toEqual({ reference: expect.stringMatching(/^MR-[A-HJ-NP-Z2-9]{6}$/), expiresAt: expect.any(String) });
    const days = (new Date(sent.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    const { rows } = await ctx.pool.query("SELECT source, payload_sealed, device_id, notice_version FROM kiosk_registration WHERE reference = $1", [
      sent.reference,
    ]);
    expect(rows[0]).toMatchObject({ source: "myhealth", device_id: null, notice_version: 1 });
    expect(rows[0].payload_sealed).not.toContain("Villanueva");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM patient")).rows[0].n).toBe(before);
  });

  it("refuses a request made against an older privacy notice, and a facility that is not the clinic's", async () => {
    await staff(admin)
      .put("/pre-registration-settings", { enabled: true, noticeText: `${NOTICE} Updated.`, retentionDays: 7 })
      .expect(200);
    expect((await publicApi.submit(person()).expect(422)).body.error.code).toBe("pre_registration_notice_changed");
    expect((await publicApi.submit(person({ noticeVersion: 2, facilityId: "00000000-0000-4000-8000-000000000000" })).expect(422)).body.error.code).toBe(
      "pre_registration_facility_unknown",
    );
  });

  it("is reviewed by reception with the kiosk's requests, and approved into a patient only after the identification check", async () => {
    const items = (await staff(desk).get("/registrations").expect(200)).body.items as Array<{
      id: string;
      source: string;
      kiosk: string | null;
      reference: string;
    }>;
    const mine = items.find((i) => i.source === "myhealth");
    expect(mine).toMatchObject({ source: "myhealth", kiosk: null });
    const detail = (await staff(desk).get(`/registrations/${mine!.id}`).expect(200)).body;
    expect(detail).toMatchObject({ source: "myhealth", registration: { familyName: "Villanueva", givenName: "Marites" } });
    expect(detail.registration).not.toHaveProperty("organizationCode");
    await staff(desk).post(`/registrations/${mine!.id}/approve`, {}).expect(400);
    const approved = (await staff(desk).post(`/registrations/${mine!.id}/approve`, { identityChecked: true }).expect(200)).body;
    expect(approved.patientId).toEqual(expect.any(String));
    const { rows } = await ctx.pool.query("SELECT status, payload_sealed FROM kiosk_registration WHERE id = $1", [mine!.id]);
    expect(rows[0]).toEqual({ status: "approved", payload_sealed: null });
  });
});
