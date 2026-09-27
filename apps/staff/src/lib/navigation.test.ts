import { describe, expect, it } from "vitest";
import { isDemoPath, navigationForPermissions } from "./navigation";

const hrefs = (permissions: string[]) => navigationForPermissions(permissions).map((i) => i.href);

describe("navigationForPermissions", () => {
  it("shows only the dashboard to a user without relevant permissions", () => {
    expect(hrefs([])).toEqual(["/"]);
  });

  it("shows patient lookup to users who can search patients", () => {
    expect(hrefs(["patient.search"])).toContain("/patients");
    expect(hrefs(["audit.read"])).not.toContain("/patients");
  });

  it("shows clinical demo modules, badged, to users who can read patient records", () => {
    const nav = navigationForPermissions(["patient.search", "patient.read"]);
    expect(nav.find((i) => i.href === "/dental")?.badge).toBe("Demo");
    expect(nav.find((i) => i.href === "/patients")?.badge).toBeUndefined();
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

  it("shows administration only to user or organization managers", () => {
    expect(hrefs(["patient.read"])).not.toContain("/admin");
    expect(hrefs(["user.manage"])).toContain("/admin");
  });

  it("drops demo role filters from items and children", () => {
    const clinic = navigationForPermissions(["encounter.read"]).find((i) => i.href === "/clinic");
    expect(clinic && "roles" in clinic).toBe(false);
    expect(clinic?.children?.every((c) => !("roles" in c))).toBe(true);
    expect(clinic?.children?.length).toBe(4);
  });
});

describe("isDemoPath", () => {
  it("flags fixture-backed modules and previews, not API-backed pages", () => {
    expect(isDemoPath("/dental")).toBe(true);
    expect(isDemoPath("/laboratory/worklist")).toBe(false);
    expect(isDemoPath("/preview/patient-360")).toBe(true);
    expect(isDemoPath("/patients/abc")).toBe(false);
    expect(isDemoPath("/")).toBe(false);
    expect(isDemoPath("/queue")).toBe(false);
    expect(isDemoPath("/clinic/encounters/abc")).toBe(false);
    expect(isDemoPath("/appointments/new")).toBe(false);
  });
});
