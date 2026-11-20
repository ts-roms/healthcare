import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from "./harness";

/**
 * The platform console's tenants (migration 0151, docs/architecture/platform-console.md): platform administrators see
 * every organization with operational figures only, create one with its first facility and administrator, and suspend
 * or reactivate one with a reason. A suspension ends every staff and MyHealth session and refuses sign-in and requests.
 */
describe("platform console: tenants", () => {
  let ctx: TestContext;
  let home: Tenant;
  let clinic: Tenant;
  let platform: string;
  let homeAdmin: string;
  const PORTAL_PASSWORD = "Pahintulot-ko-2026";

  const http = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token)).send(body),
  });

  /** A patient of the clinic with an activated MyHealth account; answers the patient's access token. */
  async function myHealthPatient(adminToken: string): Promise<string> {
    const staff = (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(adminToken, clinic.facilityId)).send(body);
    const id = (
      await staff("/patients", {
        familyName: "Santos",
        givenName: "Lorna",
        sex: "female",
        birthDate: "1979-03-14",
        contacts: [{ system: "mobile", value: "0917 555 0101" }],
      }).expect(201)
    ).body.id as string;
    await staff(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode as string;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    return (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: "tenant-clinic",
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "lorna@tenant-clinic.ph",
          password: PORTAL_PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    home = await createTenant(ctx.pool, "tenant-home");
    clinic = await createTenant(ctx.pool, "tenant-clinic");
    await createStaff(ctx.pool, home, "platform@tenants.ph", ["org_admin"], { platformAdmin: true });
    await createStaff(ctx.pool, home, "admin@tenant-home.ph", ["org_admin"]);
    await createStaff(ctx.pool, clinic, "admin@tenant-clinic.ph", ["org_admin"]);
    platform = (await login(ctx, "platform@tenants.ph")).accessToken;
    homeAdmin = (await login(ctx, "admin@tenant-home.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("is for platform administrators only", async () => {
    await http(homeAdmin).get("/platform/tenants").expect(403);
    await http(homeAdmin).get(`/platform/tenants/${clinic.organizationId}`).expect(403);
    await http(homeAdmin)
      .post("/platform/tenants", {
        code: "x-org",
        name: "X",
        facility: { code: "main", name: "Main", facilityType: "clinic" },
        administrator: { email: "a@x.ph", displayName: "A" },
      })
      .expect(403);
  });

  it("lists every organization with operational figures, small patient counts shown as <5, and audits the view", async () => {
    const clinicAdmin = (await login(ctx, "admin@tenant-clinic.ph")).accessToken;
    await myHealthPatient(clinicAdmin);
    const list = (await http(platform).get("/platform/tenants").expect(200)).body as {
      items: Array<{
        id: string;
        code: string;
        status: string;
        patients: number | string;
        myHealthAccounts: number | string;
        activeStaff: number;
        facilities: object;
      }>;
      totals: { organizations: number };
    };
    const row = list.items.find((i) => i.id === clinic.organizationId);
    expect(row).toMatchObject({
      code: "tenant-clinic",
      status: "active",
      patients: "<5",
      myHealthAccounts: "<5",
      activeStaff: 1,
      facilities: { active: 2, total: 2 },
    });
    expect(list.items.find((i) => i.id === home.organizationId)).toMatchObject({ patients: 0, activeStaff: 2 });
    expect(list.totals.organizations).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list)).not.toContain("Lorna");
    expect(await auditRows(ctx.pool, "action = 'platform.tenant.list'")).toHaveLength(1);
  });

  it("shows one organization with its administrators and audits the view in that organization's own trail", async () => {
    const detail = (await http(platform).get(`/platform/tenants/${clinic.organizationId}`).expect(200)).body;
    expect(detail).toMatchObject({ code: "tenant-clinic", isCurrentOrganization: false, statusHistory: [] });
    expect(detail.administrators.map((a: { email: string }) => a.email)).toEqual(["admin@tenant-clinic.ph"]);
    expect(detail.facilityList).toHaveLength(2);
    expect(await auditRows(ctx.pool, `action = 'platform.tenant.view' AND organization_id = '${clinic.organizationId}'`)).toHaveLength(1);
    await http(platform).get("/platform/tenants/00000000-0000-4000-8000-000000000000").expect(404);
  });

  it("creates an organization with its first facility and administrator in one go; the administrator replaces the temporary password", async () => {
    const body = {
      code: "bagong-klinika",
      name: "Bagong Klinika",
      facility: { code: "main", name: "Bagong Klinika Main", facilityType: "clinic", cityMunicipality: "Iloilo City" },
      administrator: { email: "admin@bagong-klinika.ph", displayName: "Ana Lim" },
    };
    expect((await http(platform).post("/platform/tenants", body).expect(422)).body.error.code).toBe("initial_password_required");
    expect((await ctx.pool.query("SELECT 1 FROM organization WHERE code = 'bagong-klinika'")).rowCount).toBe(0);
    const created = (
      await http(platform)
        .post("/platform/tenants", { ...body, administrator: { ...body.administrator, temporaryPassword: "Pansamantala-2026!" } })
        .expect(201)
    ).body;
    expect(created).toMatchObject({ code: "bagong-klinika", status: "active", facilities: { active: 1, total: 1 } });
    expect(created.administrators).toEqual([expect.objectContaining({ email: "admin@bagong-klinika.ph", passwordChangeRequired: true })]);
    expect((await http(platform).post("/platform/tenants", body).expect(409)).body.error.code).toBe("organization_code_taken");
    const signIn = await ctx.http().post("/api/v1/auth/login").send({ email: "admin@bagong-klinika.ph", password: "Pansamantala-2026!" }).expect(200);
    await http(signIn.body.accessToken).get("/facilities").expect(403);
    const actions = (await auditRows(ctx.pool, `organization_id = '${created.id}'`)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["organization.create", "facility.create", "user.add-member", "user.role-grant"]));

    // An existing staff account is only added: it keeps its own password.
    const second = (
      await http(platform)
        .post("/platform/tenants", {
          ...body,
          code: "ikalawang-klinika",
          name: "Ikalawang Klinika",
          administrator: { email: "admin@tenant-home.ph", displayName: "Ignored" },
        })
        .expect(201)
    ).body;
    expect(second.administrators).toEqual([expect.objectContaining({ email: "admin@tenant-home.ph", passwordChangeRequired: false })]);
    await ctx.http().post("/api/v1/auth/login").send({ email: "admin@tenant-home.ph", password: PASSWORD, organizationId: second.id }).expect(200);
  });

  it("suspends an organization: its sessions end, staff and MyHealth sign-in is refused; reactivation lets them in again", async () => {
    const clinicAdmin = (await login(ctx, "admin@tenant-clinic.ph")).accessToken;
    const patientToken = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "tenant-clinic", email: "lorna@tenant-clinic.ph", password: PORTAL_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    await ctx.http().get("/api/v1/portal/me").set("Authorization", `Bearer ${patientToken}`).expect(200);

    const { version } = (await http(platform).get(`/platform/tenants/${clinic.organizationId}`).expect(200)).body;
    await http(platform).post(`/platform/tenants/${clinic.organizationId}/status`, { status: "suspended", reason: "short", version }).expect(400);
    await http(platform)
      .post(`/platform/tenants/${clinic.organizationId}/status`, { status: "suspended", reason: "Unpaid subscription since October", version: version + 5 })
      .expect(409);
    const suspended = (
      await http(platform)
        .post(`/platform/tenants/${clinic.organizationId}/status`, { status: "suspended", reason: "Unpaid subscription since October", version })
        .expect(201)
    ).body;
    expect(suspended).toMatchObject({ status: "suspended", statusHistory: [expect.objectContaining({ fromStatus: "active", toStatus: "suspended" })] });

    await http(clinicAdmin).get("/organization").expect(401);
    await ctx.http().get("/api/v1/portal/me").set("Authorization", `Bearer ${patientToken}`).expect(401);
    await ctx.http().post("/api/v1/auth/login").send({ email: "admin@tenant-clinic.ph", password: PASSWORD }).expect(403);
    await ctx
      .http()
      .post("/api/v1/portal/auth/login")
      .send({ organizationCode: "tenant-clinic", email: "lorna@tenant-clinic.ph", password: PORTAL_PASSWORD })
      .expect(401);
    const { rows } = await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_session WHERE organization_id = $1 AND revoked_at IS NULL", [
      clinic.organizationId,
    ]);
    expect(rows[0]!.n).toBe(0);
    expect(await auditRows(ctx.pool, `action = 'organization.suspend' AND organization_id = '${clinic.organizationId}'`)).toHaveLength(1);
    // The history is append-only.
    await expect(
      ctx.pool.query("UPDATE organization_status_change SET reason = 'changed later' WHERE organization_id = $1", [clinic.organizationId]),
    ).rejects.toThrow();

    expect(
      (
        await http(platform)
          .post(`/platform/tenants/${clinic.organizationId}/status`, {
            status: "suspended",
            reason: "Unpaid subscription since October",
            version: suspended.version,
          })
          .expect(422)
      ).body.error.code,
    ).toBe("organization_status_unchanged");
    await http(platform)
      .post(`/platform/tenants/${clinic.organizationId}/status`, { status: "active", reason: "Subscription settled on 7 November", version: suspended.version })
      .expect(201);
    await login(ctx, "admin@tenant-clinic.ph");
    await ctx
      .http()
      .post("/api/v1/portal/auth/login")
      .send({ organizationCode: "tenant-clinic", email: "lorna@tenant-clinic.ph", password: PORTAL_PASSWORD })
      .expect(200);
  });

  it("does not suspend the organization the administrator is signed in to", async () => {
    const { version } = (await http(platform).get(`/platform/tenants/${home.organizationId}`).expect(200)).body;
    expect(
      (
        await http(platform)
          .post(`/platform/tenants/${home.organizationId}/status`, { status: "suspended", reason: "Trying to lock myself out", version })
          .expect(422)
      ).body.error.code,
    ).toBe("cannot_suspend_current_organization");
  });
});
