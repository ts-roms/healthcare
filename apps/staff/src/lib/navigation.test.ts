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
    const lab = nav.find((i) => i.href === "/laboratory");
    expect(lab?.badge).toBe("Demo");
    expect(nav.find((i) => i.href === "/patients")?.badge).toBeUndefined();
  });

  it("shows administration only to user or organization managers", () => {
    expect(hrefs(["patient.read"])).not.toContain("/admin");
    expect(hrefs(["user.manage"])).toContain("/admin");
  });

  it("drops demo role filters from items and children", () => {
    const clinic = navigationForPermissions(["patient.read"]).find((i) => i.href === "/clinic");
    expect(clinic && "roles" in clinic).toBe(false);
    expect(clinic?.children?.every((c) => !("roles" in c))).toBe(true);
    expect(clinic?.children?.length).toBe(4);
  });
});

describe("isDemoPath", () => {
  it("flags fixture-backed modules and previews, not API-backed pages", () => {
    expect(isDemoPath("/laboratory/worklist")).toBe(true);
    expect(isDemoPath("/preview/patient-360")).toBe(true);
    expect(isDemoPath("/patients/abc")).toBe(false);
    expect(isDemoPath("/")).toBe(false);
    expect(isDemoPath("/queueing")).toBe(false);
  });
});
