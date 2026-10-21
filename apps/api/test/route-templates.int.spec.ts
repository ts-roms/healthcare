import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Route templates (docs/domains/clinic.md, "Route templates"; migration 0116): a facility names the routes it plans
 * again and again; a nurse applies one when planning a visit's route. A template is only a recipe: the visit's route
 * is the ordinary one, and editing the template never changes it.
 */
describe("route templates", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let visitTypeId: string;
  let otherVisitTypeId: string;
  let patientId: string;
  const point: Record<"triage" | "lab" | "xray", string> = { triage: "", lab: "", xray: "" };
  let annexPointId: string;
  let template: { id: string; version: number };

  const at = (token: string, facilityId = tenant.facilityId) => as(token, facilityId);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "route-templates-org");
    await createStaff(ctx.pool, tenant, "admin@rt.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@rt.ph", ["nurse"]);
    admin = (await login(ctx, "admin@rt.ph")).accessToken;
    nurse = (await login(ctx, "nurse@rt.ph")).accessToken;
    const makeVisitType = async (code: string, name: string) =>
      (await ctx.http().post("/api/v1/clinic/visit-types").set(as(admin)).send({ code, name, defaultDurationMinutes: 15 }).expect(201)).body.id as string;
    visitTypeId = await makeVisitType("checkup", "Check-up");
    otherVisitTypeId = await makeVisitType("consult", "Consultation");
    patientId = (await ctx.http().post("/api/v1/patients").set(at(admin)).send(juan).expect(201)).body.id;
    for (const [key, name, kind] of [
      ["triage", "Triage Room", "consultation"],
      ["lab", "Laboratory", "other"],
      ["xray", "X-ray", "imaging"],
    ] as const) {
      point[key] = (
        await ctx.http().post("/api/v1/clinic/service-points").set(at(admin)).send({ facilityId: tenant.facilityId, code: key, name, kind }).expect(201)
      ).body.id;
    }
    annexPointId = (
      await ctx
        .http()
        .post("/api/v1/clinic/service-points")
        .set(at(admin))
        .send({ facilityId: tenant.otherFacilityId, code: "annex", name: "Annex", kind: "other" })
        .expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("lets the organization define a template of its own service points (clinic.configure), offered first for a visit type", async () => {
    const created = await ctx
      .http()
      .post("/api/v1/clinic/route-templates")
      .set(at(admin))
      .send({
        facilityId: tenant.facilityId,
        code: "annual-checkup",
        name: "Annual check-up",
        servicePointIds: [point.triage, point.lab, point.xray],
        defaultForVisitTypeIds: [visitTypeId],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      code: "annual-checkup",
      name: "Annual check-up",
      status: "active",
      version: 1,
      usable: true,
      defaultForVisitTypeIds: [visitTypeId],
    });
    expect(created.body.steps.map((s: { name: string }) => s.name)).toEqual(["Triage Room", "Laboratory", "X-ray"]);
    expect(created.body.organizationId).toBeUndefined();
    template = { id: created.body.id, version: created.body.version };

    const listed = await ctx.http().get(`/api/v1/clinic/route-templates?facilityId=${tenant.facilityId}`).set(at(nurse)).expect(200);
    expect(listed.body.map((t: { id: string }) => t.id)).toEqual([template.id]);
    expect((await auditRows(ctx.pool, "action = 'route-template.create'")).length).toBe(1);

    // Defining one needs clinic.configure; reading needs only the queue.
    await ctx
      .http()
      .post("/api/v1/clinic/route-templates")
      .set(at(nurse))
      .send({ facilityId: tenant.facilityId, code: "x", name: "X", servicePointIds: [point.lab] })
      .expect(403);
  });

  it("refuses a repeated code, a stop that follows itself, another facility's stop and an unknown visit type", async () => {
    const send = (body: Record<string, unknown>) =>
      ctx
        .http()
        .post("/api/v1/clinic/route-templates")
        .set(at(admin))
        .send({ facilityId: tenant.facilityId, code: "other", name: "Other", servicePointIds: [point.lab], ...body });
    expect((await send({ code: "annual-checkup" }).expect(409)).body.error.code).toBe("route_template_exists");
    expect((await send({ servicePointIds: [point.lab, point.lab] }).expect(422)).body.error.code).toBe("route_step_repeated");
    // The same service point may come back later, just not straight after itself.
    await send({ code: "lab-twice", servicePointIds: [point.lab, point.xray, point.lab] }).expect(201);
    expect((await send({ servicePointIds: [annexPointId] }).expect(422)).body.error.code).toBe("service_point_unknown");
    expect((await send({ defaultForVisitTypeIds: ["00000000-0000-4000-8000-000000000000"] }).expect(422)).body.error.code).toBe("visit_type_unknown");
  });

  it("applies to a visit's route as an ordinary plan, and editing the template later never changes it", async () => {
    const walkIn = await ctx.http().post("/api/v1/queue/walk-ins").set(at(admin)).send({ patientId, visitTypeId }).expect(201);
    const visitId = walkIn.body.id as string;
    // The nurse takes the template's stops: the first is where the patient is sent, the rest follow it.
    const triaged = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/triage`)
      .set(at(nurse))
      .send({
        chiefComplaint: "Annual check-up",
        priority: "routine",
        riskFlags: [],
        vitals: { temperatureC: 36.8 },
        completeTriage: true,
        servicePointId: point.triage,
        route: [point.lab, point.xray],
      })
      .expect(201);
    expect(triaged.body).toBeDefined();
    const planned = await ctx.http().get(`/api/v1/queue/visits/${visitId}/route`).set(at(nurse)).expect(200);
    expect(planned.body.map((s: { servicePointId: string; status: string }) => [s.servicePointId, s.status])).toEqual([
      [point.triage, "current"],
      [point.lab, "planned"],
      [point.xray, "planned"],
    ]);

    // The facility changes the template afterwards: the visit keeps the route it was given.
    const edited = await ctx
      .http()
      .patch(`/api/v1/clinic/route-templates/${template.id}`)
      .set(at(admin))
      .send({ name: "Annual check-up (short)", servicePointIds: [point.triage, point.xray], version: template.version })
      .expect(200);
    expect(edited.body).toMatchObject({ name: "Annual check-up (short)", version: 2 });
    expect(edited.body.steps.map((s: { name: string }) => s.name)).toEqual(["Triage Room", "X-ray"]);
    template = { id: template.id, version: edited.body.version };
    const after = await ctx.http().get(`/api/v1/queue/visits/${visitId}/route`).set(at(nurse)).expect(200);
    expect(after.body.map((s: { servicePointId: string }) => s.servicePointId)).toEqual([point.triage, point.lab, point.xray]);
    expect((await auditRows(ctx.pool, "action = 'route-template.update'")).length).toBe(1);
  });

  it("moves a visit type's default from one template to another, and keeps one default per visit type and facility", async () => {
    const second = await ctx
      .http()
      .post("/api/v1/clinic/route-templates")
      .set(at(admin))
      .send({
        facilityId: tenant.facilityId,
        code: "quick-lab",
        name: "Quick lab",
        servicePointIds: [point.lab],
        defaultForVisitTypeIds: [visitTypeId, otherVisitTypeId],
      })
      .expect(201);
    const listed = (await ctx.http().get(`/api/v1/clinic/route-templates?facilityId=${tenant.facilityId}`).set(at(nurse)).expect(200)).body as Array<{
      id: string;
      defaultForVisitTypeIds: string[];
    }>;
    expect(listed.find((t) => t.id === template.id)?.defaultForVisitTypeIds).toEqual([]);
    expect(listed.find((t) => t.id === second.body.id)?.defaultForVisitTypeIds.sort()).toEqual([visitTypeId, otherVisitTypeId].sort());
  });

  it("stops offering a template whose stop is no longer in use, and refuses a stale edit", async () => {
    const deactivated = await ctx.http().get(`/api/v1/clinic/service-points?facilityId=${tenant.facilityId}`).set(at(admin)).expect(200);
    const xray = deactivated.body.find((s: { id: string }) => s.id === point.xray) as { version: number };
    await ctx.http().patch(`/api/v1/clinic/service-points/${point.xray}`).set(at(admin)).send({ status: "inactive", version: xray.version }).expect(200);
    const listed = (await ctx.http().get(`/api/v1/clinic/route-templates?facilityId=${tenant.facilityId}`).set(at(nurse)).expect(200)).body as Array<{
      id: string;
      usable: boolean;
    }>;
    expect(listed.find((t) => t.id === template.id)?.usable).toBe(false);
    // A template cannot be saved with a stop that is no longer in use.
    const stale = await ctx
      .http()
      .patch(`/api/v1/clinic/route-templates/${template.id}`)
      .set(at(admin))
      .send({ servicePointIds: [point.triage, point.xray], version: template.version })
      .expect(422);
    expect(stale.body.error.code).toBe("service_point_inactive");
    await ctx
      .http()
      .patch(`/api/v1/clinic/route-templates/${template.id}`)
      .set(at(admin))
      .send({ name: "Old", version: template.version + 5 })
      .expect(409);
    // Inactive templates are listed only on request.
    await ctx.http().patch(`/api/v1/clinic/route-templates/${template.id}`).set(at(admin)).send({ status: "inactive", version: template.version }).expect(200);
    const active = (await ctx.http().get(`/api/v1/clinic/route-templates?facilityId=${tenant.facilityId}`).set(at(nurse)).expect(200)).body as Array<{
      id: string;
    }>;
    expect(active.some((t) => t.id === template.id)).toBe(false);
    const all = (await ctx.http().get(`/api/v1/clinic/route-templates?facilityId=${tenant.facilityId}&includeInactive=true`).set(at(nurse)).expect(200))
      .body as Array<{
      id: string;
    }>;
    expect(all.some((t) => t.id === template.id)).toBe(true);
  });
});
