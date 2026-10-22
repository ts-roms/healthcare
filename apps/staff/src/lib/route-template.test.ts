import { describe, expect, it } from "vitest";
import type { RouteTemplate } from "./api/types";
import { defaultTemplateFor, routeSummary, stopsAfter, triageStopsFromTemplate, usableTemplates } from "./route-template";

const step = (id: string, name: string) => ({ id, code: id, name, kind: "other" as const, location: null });
const template = (over: Partial<RouteTemplate> = {}): RouteTemplate => ({
  id: "t1",
  facilityId: "f1",
  code: "checkup",
  name: "Annual check-up",
  status: "active",
  version: 1,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  steps: [step("triage", "Triage Room"), step("lab", "Laboratory"), step("xray", "X-ray")],
  usable: true,
  defaultForVisitTypeIds: ["checkup-visit"],
  ...over,
});

describe("route templates", () => {
  it("sends the patient to the first stop and plans the rest after it", () => {
    expect(triageStopsFromTemplate(template())).toEqual({ servicePointId: "triage", stops: ["lab", "xray"] });
    expect(triageStopsFromTemplate(template({ steps: [] }))).toBeNull();
  });

  it("plans only what is left when the patient is already at the first stop", () => {
    expect(stopsAfter(template(), "triage")).toEqual(["lab", "xray"]);
    expect(stopsAfter(template(), "lab")).toEqual(["triage", "lab", "xray"]);
    expect(stopsAfter(template(), null)).toEqual(["triage", "lab", "xray"]);
  });

  it("offers a visit type's default only while the template can be used", () => {
    expect(defaultTemplateFor([template()], "checkup-visit")?.id).toBe("t1");
    expect(defaultTemplateFor([template()], "other-visit")).toBeNull();
    expect(defaultTemplateFor([template({ usable: false })], "checkup-visit")).toBeNull();
  });

  it("lists only usable templates and summarizes the route in words", () => {
    expect(usableTemplates([template(), template({ id: "t2", usable: false })]).map((t) => t.id)).toEqual(["t1"]);
    expect(routeSummary(template())).toBe("Triage Room → Laboratory → X-ray");
  });
});
