import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/** The organization-wide switch of the staff app's guided tour (migration 0124). */
describe("staff tour setting", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "tour-org");
    await createStaff(ctx.pool, tenant, "admin@tour.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@tour.ph", ["nurse"]);
    [admin, nurse] = await Promise.all(["admin", "nurse"].map(async (u) => (await login(ctx, `${u}@tour.ph`)).accessToken));
  });
  afterAll(() => ctx.close());

  it("is on by default and readable by any member of staff", async () => {
    expect((await api(nurse).get("/organization/tour-setting").expect(200)).body).toMatchObject({ enabled: true, version: 0 });
  });

  it("is changed only by someone who manages the organization, with a version, and audited", async () => {
    await api(nurse).put("/organization/tour-setting", { enabled: false, version: 0 }).expect(403);
    expect((await api(admin).put("/organization/tour-setting", { enabled: false, version: 0 }).expect(200)).body).toMatchObject({ enabled: false, version: 1 });
    expect((await api(nurse).get("/organization/tour-setting").expect(200)).body.enabled).toBe(false);
    await api(admin).put("/organization/tour-setting", { enabled: true, version: 0 }).expect(409);
    await api(admin).put("/organization/tour-setting", { enabled: true, version: 1 }).expect(200);
    const audits = await auditRows(ctx.pool, "action = 'tour.setting.update'", []);
    expect(audits).toHaveLength(2);
  });
});
