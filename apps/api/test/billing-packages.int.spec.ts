import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

/**
 * Packages: a package service with included services → sold to a patient
 * (charged at its price) → included services, added by staff or captured from
 * a laboratory order, are covered at zero until used up → cancelled charges
 * give units back → an unused package can be cancelled.
 */
describe("billing packages", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let cashier: string;
  let patientId: string;
  let fbsTestId: string;
  const ids: Record<string, string> = {};

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const packages = async () => (await req(cashier).get(`/billing/patients/${patientId}/packages`).expect(200)).body;
  const left = (enrollment: { items: Array<{ serviceName: string; left: number }> }) =>
    Object.fromEntries(enrollment.items.map((i) => [i.serviceName, i.left]));

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "package-org");
    await createStaff(ctx.pool, tenant, "admin@package.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doc@package.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "cashier@package.ph", ["cashier"]);
    admin = (await login(ctx, "admin@package.ph")).accessToken;
    doctor = (await login(ctx, "doc@package.ph")).accessToken;
    cashier = (await login(ctx, "cashier@package.ph")).accessToken;
    const chem = (await req(admin).post("/laboratory/departments", { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    const serum = (await req(admin).post("/laboratory/specimen-types", { code: "serum", name: "Serum" }).expect(201)).body.id;
    fbsTestId = (
      await req(admin)
        .post("/laboratory/tests", {
          code: "fbs",
          name: "Fasting blood sugar",
          departmentId: chem,
          specimenTypeId: serum,
          resultType: "numeric",
          unit: "mmol/L",
        })
        .expect(201)
    ).body.id;
    ids.consult = (
      await req(admin)
        .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    ids.fbs = (
      await req(admin)
        .post("/billing/services", {
          code: "fbs",
          name: "FBS",
          category: "laboratory",
          sourceKind: "lab_test",
          sourceCode: "fbs",
          unitPrice: 25_000,
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body.id;
    patientId = (
      await req(admin)
        .post("/patients", {
          familyName: "Santos",
          givenName: "Jose",
          sex: "male",
          birthDate: "1965-07-07",
          contacts: [{ system: "mobile", value: "0917 555 0404" }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("defines a package: its own price and the services it includes", async () => {
    const body = {
      code: "annual-pe",
      name: "Annual physical",
      category: "consultation",
      unitPrice: 60_000,
      effectiveFrom: manilaDate(-1),
      validityDays: 365,
      taxClass: "vat_exempt",
      items: [
        { serviceId: ids.consult, quantity: 1 },
        { serviceId: ids.fbs, quantity: 2 },
      ],
    };
    await req(cashier).post("/billing/packages", body).expect(403);
    await req(admin)
      .post("/billing/packages", { ...body, items: [body.items[0], body.items[0]] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("package_duplicate_service"));
    ids.package = (await req(admin).post("/billing/packages", body).expect(201)).body.id;
    await req(admin)
      .post("/billing/packages", { ...body, code: "nested", items: [{ serviceId: ids.package, quantity: 1 }] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("package_in_package"));
    const list = await req(cashier).get("/billing/packages").expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        code: "annual-pe",
        isPackage: true,
        packageValidityDays: 365,
        taxClass: "vat_exempt",
        currentPrice: 60_000,
        items: expect.arrayContaining([expect.objectContaining({ serviceCode: "fbs", quantity: 2 })]),
      }),
    ]);
  });

  it("sells the package as a charge at its price", async () => {
    await req(cashier)
      .post("/billing/charges", { patientId, serviceId: ids.package })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("package_sold_separately"));
    const sold = await req(cashier).post(`/billing/patients/${patientId}/packages`, { packageServiceId: ids.package }).expect(201);
    expect(sold.body).toMatchObject({
      status: "active",
      packageName: "Annual physical",
      startsOn: manilaDate(0),
      endsOn: manilaDate(364),
      saleCharge: expect.objectContaining({ status: "pending" }),
    });
    expect(left(sold.body)).toEqual({ "Consultation fee": 1, FBS: 2 });
    ids.enrollment = sold.body.id;
    const charges = await req(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200);
    expect(charges.body).toEqual([expect.objectContaining({ sourceType: "package", unitPrice: 60_000, description: "Annual physical" })]);
    const audit = await auditRows(ctx.pool, "action = 'billing.package.sell'");
    expect(audit[0]).toMatchObject({ patient_id: patientId });
  });

  it("covers included services at zero until used up, from staff and from clinical capture", async () => {
    const covered = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.consult }).expect(201);
    expect(covered.body).toMatchObject({
      unitPrice: 0,
      amount: 0,
      packageEnrollmentId: ids.enrollment,
      description: "Consultation fee (covered by Annual physical)",
    });
    ids.coveredConsult = covered.body.id;
    ids.coveredConsultVersion = String(covered.body.version);
    const second = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.consult }).expect(201);
    expect(second.body).toMatchObject({ unitPrice: 50_000, packageEnrollmentId: null });
    // Staff may choose not to use the package.
    const notUsed = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.fbs, usePackage: false }).expect(201);
    expect(notUsed.body).toMatchObject({ unitPrice: 25_000, packageEnrollmentId: null });

    await req(doctor)
      .post("/laboratory/orders", { patientId, source: "patient_request", testIds: [fbsTestId] })
      .expect(201);
    await drainEvents(ctx);
    const captured = await ctx.pool.query(
      `SELECT unit_price, package_enrollment_id FROM billing_charge WHERE source_type = 'lab_order_item' AND patient_id = $1`,
      [patientId],
    );
    expect(captured.rows).toEqual([{ unit_price: "0", package_enrollment_id: ids.enrollment }]);
    expect(left((await packages())[0])).toEqual({ "Consultation fee": 0, FBS: 1 });
  });

  it("gives units back when a covered charge is cancelled, and keeps a used package", async () => {
    await req(cashier)
      .post(`/billing/charges/${ids.coveredConsult}/cancel`, { reason: "Entered twice", version: Number(ids.coveredConsultVersion) })
      .expect(200);
    const [enrollment] = await packages();
    expect(left(enrollment)).toEqual({ "Consultation fee": 1, FBS: 1 });
    await req(cashier)
      .post(`/billing/package-enrollments/${ids.enrollment}/cancel`, { reason: "Changed mind", version: enrollment.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("package_in_use"));
  });

  it("cancels an unused package with a reason, with its sale charge", async () => {
    const sold = await req(cashier).post(`/billing/patients/${patientId}/packages`, { packageServiceId: ids.package }).expect(201);
    await req(cashier).post(`/billing/package-enrollments/${sold.body.id}/cancel`, { version: sold.body.version }).expect(400);
    const cancelled = await req(cashier)
      .post(`/billing/package-enrollments/${sold.body.id}/cancel`, { reason: "Sold by mistake", version: sold.body.version })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: "cancelled",
      cancelReason: "Sold by mistake",
      saleCharge: expect.objectContaining({ status: "cancelled" }),
    });
    // Only the active package covers.
    const after = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.fbs }).expect(201);
    expect(after.body.packageEnrollmentId).toBe(ids.enrollment);
  });
});
