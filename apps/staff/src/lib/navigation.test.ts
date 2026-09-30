import { describe, expect, it } from "vitest";
import { isDemoPath, navigationForPermissions } from "./navigation";

const hrefs = (permissions: string[]) => navigationForPermissions(permissions).map((i) => i.href);

describe("navigationForPermissions", () => {
  it("shows only the dashboard and help to a user without relevant permissions", () => {
    expect(hrefs([])).toEqual(["/", "/help"]);
  });

  it("shows patient lookup to users who can search patients", () => {
    expect(hrefs(["patient.search"])).toContain("/patients");
    expect(hrefs(["audit.read"])).not.toContain("/patients");
  });

  it("shows the API-backed dental module by dental permission, without a demo badge", () => {
    expect(hrefs(["patient.search", "patient.read"])).not.toContain("/dental");
    const dental = navigationForPermissions(["dental.record.read"]).find((i) => i.href === "/dental");
    expect(dental?.badge).toBeUndefined();
    expect(dental?.children?.map((c) => c.href)).toEqual(["/dental", "/dental/settings"]);
  });

  it("shows the API-backed laboratory by laboratory permission, without a demo badge", () => {
    expect(hrefs(["patient.read"])).not.toContain("/laboratory");
    expect(navigationForPermissions(["lab.order.read"]).find((i) => i.href === "/laboratory")?.badge).toBeUndefined();
  });

  it("shows the API-backed appointments and queue by their clinic permissions, without a demo badge", () => {
    expect(hrefs(["patient.read"])).not.toContain("/queue");
    const nav = navigationForPermissions(["appointment.read", "clinic.queue.read"]);
    expect(nav.find((i) => i.href === "/appointments")?.badge).toBeUndefined();
    expect(nav.find((i) => i.href === "/queue")?.badge).toBeUndefined();
  });

  it("shows the API-backed clinic (consultations) by encounter permission, without a demo badge", () => {
    expect(hrefs(["patient.read"])).not.toContain("/clinic");
    expect(navigationForPermissions(["encounter.read"]).find((i) => i.href === "/clinic")?.badge).toBeUndefined();
  });

  it("shows administration only when one of its pages is open to the user", () => {
    expect(hrefs(["patient.read"])).not.toContain("/admin");
    // The staff list needs user.read; managing users without reading them would bounce.
    expect(hrefs(["user.manage"])).not.toContain("/admin");
    const admin = navigationForPermissions(["integration.exchange.manage"]).find((i) => i.href === "/admin");
    expect(admin?.children?.map((c) => c.href)).toEqual(["/admin/integrations"]);
    const people = navigationForPermissions(["user.read", "user.manage", "organization.read"]).find((i) => i.href === "/admin");
    expect(people?.children?.map((c) => c.href)).toEqual(["/admin/organization", "/admin/users", "/admin/roles", "/admin/facilities"]);
    const auditor = navigationForPermissions(["audit.read"]).find((i) => i.href === "/admin");
    expect(auditor?.children?.map((c) => c.href)).toEqual(["/admin/audit"]);
  });

  it("offers only the laboratory pages the user can open", () => {
    const children = (permissions: string[]) =>
      navigationForPermissions(permissions)
        .find((i) => i.href === "/laboratory")
        ?.children?.map((c) => c.href);
    // A phlebotomist: orders, but no results or quality.
    expect(children(["lab.order.read"])).toEqual(["/laboratory/worklist", "/laboratory/send-outs", "/laboratory/catalog"]);
    expect(children(["lab.order.read", "lab.result.read", "lab.qc.read"])).toContain("/laboratory/qc");
    expect(children(["lab.order.read", "lab.result.read"])).toContain("/laboratory/critical");
    expect(children(["lab.order.read", "lab.result.read"])).toContain("/laboratory/instrument-results");
    expect(children(["lab.order.read"])).not.toContain("/laboratory/instrument-results");
  });

  it("shows record imports only to import reviewers", () => {
    expect(hrefs(["patient.search", "clinical.read"])).not.toContain("/records");
    const records = navigationForPermissions(["interop.fhir.import.review"]).find((i) => i.href === "/records");
    expect(records?.children?.map((c) => c.href)).toEqual(["/records/imports"]);
  });

  it("drops demo role filters from items and children", () => {
    const clinic = navigationForPermissions(["encounter.read", "care-plan.read"]).find((i) => i.href === "/clinic");
    expect(clinic && "roles" in clinic).toBe(false);
    expect(clinic?.children?.every((c) => !("roles" in c))).toBe(true);
    expect(clinic?.children?.length).toBe(4);
    expect(
      navigationForPermissions(["encounter.read", "prescription.read"])
        .find((i) => i.href === "/clinic")
        ?.children?.map((c) => c.href),
    ).toContain("/clinic/prescriptions");
    expect(
      navigationForPermissions(["encounter.read"])
        .find((i) => i.href === "/clinic")
        ?.children?.map((c) => c.href),
    ).not.toContain("/clinic/care-plans");
  });
});

describe("isDemoPath", () => {
  it("flags fixture-backed modules and previews, not API-backed pages", () => {
    expect(isDemoPath("/dental")).toBe(false);
    expect(isDemoPath("/laboratory/worklist")).toBe(false);
    expect(isDemoPath("/preview/patient-360")).toBe(true);
    expect(isDemoPath("/patients/abc")).toBe(false);
    expect(isDemoPath("/")).toBe(false);
    expect(isDemoPath("/queue")).toBe(false);
    expect(isDemoPath("/clinic/encounters/abc")).toBe(false);
    expect(isDemoPath("/appointments/new")).toBe(false);
  });

  it("shows billing to users with billing permission", () => {
    expect(hrefs(["patient.read"])).not.toContain("/billing");
    expect(navigationForPermissions(["billing.charge.read"]).find((i) => i.href === "/billing")?.badge).toBeUndefined();
  });
});
