import { as, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/** Identifiers are returned masked unless the caller holds patient.identifier.reveal (docs/security-audit, VR-18; migration 0136). */
describe("patient identifier masking", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let patientId: string;
  const PIN = "12-345678901-2";
  const MASKED = "••-••••••901-2";

  const detail = async (email: string) => {
    const { accessToken } = await login(ctx, email);
    return ctx.http().get(`/api/v1/patients/${patientId}`).set(as(accessToken, tenant.facilityId)).expect(200);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "identifier-masking-org");
    await createStaff(ctx.pool, tenant, "admin@masking.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@masking.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "nurse@masking.ph", ["nurse"]);
    const { accessToken } = await login(ctx, "admin@masking.ph");
    const created = await ctx
      .http()
      .post("/api/v1/patients")
      .set(as(accessToken, tenant.facilityId))
      .send({
        familyName: "Masking",
        givenName: "Synthetic",
        sex: "female",
        birthDate: "1990-01-02",
        identifiers: [{ type: "philhealth_pin", value: PIN }],
      })
      .expect(201);
    patientId = created.body.id;
  });
  afterAll(() => ctx.close());

  it("shows the number in full to roles that may reveal it", async () => {
    for (const email of ["admin@masking.ph", "desk@masking.ph"]) {
      const body = (await detail(email)).body;
      expect(body.identifiers[0].value).toBe(PIN);
      expect(body.identifiersMasked).toBe(false);
    }
  });

  it("masks it for a clinical role, in the response and not only on screen", async () => {
    const response = await detail("nurse@masking.ph");
    expect(response.body.identifiers[0].value).toBe(MASKED);
    expect(response.body.identifiersMasked).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(PIN);
  });
});
