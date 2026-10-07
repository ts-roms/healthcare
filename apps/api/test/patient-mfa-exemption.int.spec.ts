import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-mfa-exemption";

/** Local (Asia/Manila) calendar day `days` from now as YYYY-MM-DD. */
const manilaDate = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

/**
 * MyHealth sign-in security, D6 phase 2 (docs/architecture/portal-app.md, "Two-step verification"; migration 0107):
 * the clinic exempts one patient from its requirement with a reason, and patients still to set it up are told by
 * email when the requirement is turned on or its date moves.
 */
describe("patient two-step verification exemptions and notices", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  const patients: Record<"juan" | "lola", { id: string; session: string }> = {} as never;

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portalGet = (path: string, token: string) => ctx.http().get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${token}`);
  const notices = async (patientId: string) =>
    (
      await ctx.pool.query<{ variables: Record<string, unknown> }>(
        "SELECT variables FROM notification WHERE template_key = 'portal.mfa-required-notice' AND recipient_patient_id = $1 ORDER BY created_at",
        [patientId],
      )
    ).rows;
  const alerts = async (patientId: string) =>
    (
      await ctx.pool.query<{ event: string }>(
        "SELECT variables->>'event' AS event FROM notification WHERE template_key = 'portal.security-alert' AND recipient_patient_id = $1 ORDER BY created_at",
        [patientId],
      )
    ).rows.map((r) => r.event);
  const policy = async () => (await staff(admin).get("/security/patient-mfa-policy").expect(200)).body;

  async function activate(details: typeof juan, email: string): Promise<{ id: string; session: string }> {
    const id = (await staff(admin).post("/patients", details).expect(201)).body.id as string;
    await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    const session = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
    return { id, session };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@mfa-exempt.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@mfa-exempt.ph", ["nurse"]);
    admin = (await login(ctx, "admin@mfa-exempt.ph")).accessToken;
    nurse = (await login(ctx, "nurse@mfa-exempt.ph")).accessToken;
    patients.juan = await activate(juan, "juan@mfa-exempt.ph");
    patients.lola = await activate(
      { ...juan, givenName: "Lourdes", familyName: "Santos", birthDate: "1941-03-02", identifiers: [], contacts: [] },
      "lola@mfa-exempt.ph",
    );
  });
  afterAll(() => ctx.close());

  it("emails every account still to set it up when the requirement is turned on, once per account", async () => {
    await staff(admin)
      .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(7), version: 0, reason: "Privacy review" })
      .expect(200);
    await drainEvents(ctx);
    await drainEvents(ctx);
    for (const p of [patients.juan, patients.lola]) {
      const sent = await notices(p.id);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.variables).toMatchObject({ requiredFrom: manilaDate(7) });
      expect(JSON.stringify(sent[0]!.variables)).not.toMatch(/Dela Cruz|Santos/);
    }
  });

  it("lets the clinic exempt a patient with a reason: audited, the patient told, counted apart", async () => {
    await staff(nurse).post(`/patients/${patients.lola.id}/portal-account/mfa-exemption`, { reason: "No smartphone" }).expect(403);
    await staff(admin).post(`/patients/${patients.lola.id}/portal-account/mfa-exemption`, { reason: "No" }).expect(400);
    await staff(admin).post(`/patients/${patients.lola.id}/portal-account/mfa-exemption`, { reason: "No smartphone; checked in person" }).expect(204);
    await staff(admin)
      .post(`/patients/${patients.lola.id}/portal-account/mfa-exemption`, { reason: "Again by mistake" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("mfa_already_exempt"));
    const status = (await staff(admin).get(`/patients/${patients.lola.id}/portal-account`).expect(200)).body;
    expect(status.mfaExemption).toMatchObject({ reason: "No smartphone; checked in person" });
    expect(await alerts(patients.lola.id)).toEqual(["mfa_exempted"]);
    const [audit] = await auditRows(ctx.pool, "action = 'patient.portal-mfa-exempt'");
    expect(audit).toMatchObject({ outcome: "success", reason: "No smartphone; checked in person", patient_id: patients.lola.id });
    const view = await policy();
    expect(view.accounts).toEqual({ active: 2, withMfa: 0, withoutMfa: 1, exempt: 1 });
    expect(view.exemptions).toEqual([expect.objectContaining({ patientId: patients.lola.id, reason: "No smartphone; checked in person" })]);
  });

  it("from the date holds only the accounts still to set it up, and tells only them when the date moves", async () => {
    await staff(admin)
      .put("/security/patient-mfa-policy", { required: true, requiredFrom: manilaDate(0), version: 1 })
      .expect(200);
    await drainEvents(ctx);
    await drainEvents(ctx);
    expect(await notices(patients.juan.id)).toHaveLength(2);
    expect((await notices(patients.juan.id))[1]!.variables).toMatchObject({ requiredFrom: manilaDate(0) });
    expect(await notices(patients.lola.id)).toHaveLength(1);

    await portalGet("/consents", patients.juan.session)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("mfa_enrollment_required"));
    await portalGet("/consents", patients.lola.session).expect(200);
    expect((await portalGet("/me", patients.lola.session).expect(200)).body.mfaPolicy).toEqual({
      required: true,
      requiredFrom: manilaDate(0),
      enrollmentRequired: false,
    });
  });

  it("ends an exemption with a reason, after which the requirement holds the patient again", async () => {
    await staff(nurse).post(`/patients/${patients.lola.id}/portal-account/mfa-exemption/end`, { reason: "Has a phone now" }).expect(403);
    await staff(admin).post(`/patients/${patients.lola.id}/portal-account/mfa-exemption/end`, { reason: "Has a phone now" }).expect(204);
    await staff(admin)
      .post(`/patients/${patients.lola.id}/portal-account/mfa-exemption/end`, { reason: "Again by mistake" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("mfa_not_exempt"));
    expect((await staff(admin).get(`/patients/${patients.lola.id}/portal-account`).expect(200)).body.mfaExemption).toBeNull();
    expect(await alerts(patients.lola.id)).toEqual(["mfa_exempted", "mfa_exemption_ended"]);
    const [audit] = await auditRows(ctx.pool, "action = 'patient.portal-mfa-exempt-end'");
    expect(audit).toMatchObject({ reason: "Has a phone now" });
    await portalGet("/consents", patients.lola.session)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("mfa_enrollment_required"));
    // The database keeps the reason, the person and the time together.
    await expect(ctx.pool.query("UPDATE patient_portal_account SET mfa_exempt_reason = 'Half set' WHERE patient_id = $1", [patients.lola.id])).rejects.toThrow(
      /patient_portal_account_mfa_exempt_check/,
    );
  });

  it("sends nothing when the requirement is turned off", async () => {
    await staff(admin).put("/security/patient-mfa-policy", { required: false, version: 2 }).expect(200);
    await drainEvents(ctx);
    expect(await notices(patients.juan.id)).toHaveLength(2);
    expect(await notices(patients.lola.id)).toHaveLength(1);
  });
});
