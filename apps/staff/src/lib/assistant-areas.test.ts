import { describe, expect, it } from "vitest";
import type { AssistantOverviewSurface, AssistantSuggestion } from "./api/types";
import { areasFor, assistantArea, canOpenArea, checksOnText, overviewSurfaces, recordRules, summarizeArea } from "./assistant-areas";

const keys = (permissions: string[]) => areasFor(permissions).map((a) => a.key);

function areaOf(key: string) {
  const found = assistantArea(key);
  if (!found) throw new Error(`No assistant area ${key}`);
  return found;
}

const suggestion = (id: string, surface: AssistantSuggestion["surface"], severity: AssistantSuggestion["severity"]): AssistantSuggestion => ({
  id,
  ruleId: `rule.${id}`,
  ruleVersion: 1,
  surface,
  severity,
  title: id,
  rationale: "",
  evidence: [],
  basis: "rule",
  strength: "matched",
  requires: [],
});

const rule = (ruleId: string, on: boolean, needs: AssistantOverviewSurface["rules"][number]["needs"] = "nothing") => ({
  ruleId,
  ruleVersion: 1,
  title: ruleId,
  description: "",
  on,
  needs,
});

const surface = (s: Partial<AssistantOverviewSurface> & Pick<AssistantOverviewSurface, "surface">): AssistantOverviewSurface => ({
  rules: [],
  items: [],
  more: 0,
  dismissed: 0,
  withheld: 0,
  failed: false,
  ...s,
});

describe("assistant areas", () => {
  it("opens an area only with the assistant's permission and one of the area's own", () => {
    expect(keys(["inventory.read"])).toEqual([]);
    // An inventory officer: stock only (the pharmacy's rules also need prescriptions).
    expect(keys(["assistant.use", "inventory.read"])).toEqual(["stock"]);
    // A cashier.
    expect(keys(["assistant.use", "billing.charge.read", "appointment.read"])).toEqual(["billing", "clinic"]);
    // A pharmacist: stock and the pharmacy.
    expect(keys(["assistant.use", "inventory.read", "prescription.dispense"])).toEqual(["stock", "pharmacy"]);
    // Dispensing without reading stock opens no pharmacy area.
    expect(keys(["assistant.use", "prescription.dispense"])).toEqual([]);
    // A medical technologist reading QC but not ordering.
    expect(keys(["assistant.use", "lab.qc.read"])).toEqual(["laboratory"]);
    expect(keys(["assistant.use", "audit.read"])).toEqual(["security"]);
    expect(keys(["assistant.use", "crm.segment.manage"])).toEqual(["outreach"]);
  });

  it("finds an area by its key, and nothing else", () => {
    expect(assistantArea("stock")).toMatchObject({ label: "Stock", href: "/assistant/suggestions/stock", surfaces: ["inventory"] });
    expect(assistantArea("followed")).toBeUndefined();
    const lab = areaOf("laboratory");
    expect(canOpenArea(lab, ["assistant.use", "lab.qc.manage"])).toBe(true);
    expect(canOpenArea(lab, ["lab.qc.manage"])).toBe(false);
  });

  it("asks the overview for the areas' screens and the record screens, once each", () => {
    expect(overviewSurfaces(areasFor(["assistant.use", "appointment.read", "clinic.queue.read", "audit.read"]))).toEqual([
      "appointments",
      "queue",
      "security",
      "settings",
      "encounter",
      "dental",
      "prescribing",
    ]);
    expect(overviewSurfaces([])).toEqual(["encounter", "dental", "prescribing"]);
  });

  it("summarizes an area over its screens: warnings first, the rest counted, checks on out of those readable", () => {
    const clinic = areaOf("clinic");
    const summary = summarizeArea(
      clinic,
      [
        surface({
          surface: "appointments",
          rules: [rule("clinic.no-show-risk", true)],
          items: [suggestion("a1", "appointments", "advice"), suggestion("a2", "appointments", "info")],
          more: 1,
          dismissed: 1,
        }),
        surface({ surface: "queue", rules: [rule("clinic.queue-wait", false)], items: [suggestion("q1", "queue", "warning")], withheld: 2, failed: true }),
        // Another area's screen is not counted.
        surface({ surface: "inventory", rules: [rule("inventory.days-of-cover", true)], items: [suggestion("i1", "inventory", "warning")] }),
      ],
      2,
    );
    expect(summary.items.map((s) => s.id)).toEqual(["q1", "a1"]);
    // 4 in all (3 answered and 1 beyond the limit), 2 shown.
    expect(summary.more).toBe(2);
    expect(summary).toMatchObject({ dismissed: 1, withheld: 2, failed: true, rulesOn: 1, rulesReadable: 2 });
  });

  it("says how many checks are on, in words", () => {
    expect(checksOnText(0, 0, "Main Clinic")).toBe("No check here is available to you.");
    expect(checksOnText(0, 3, "Main Clinic")).toBe("No check is turned on at Main Clinic.");
    expect(checksOnText(1, 1, "Main Clinic")).toBe("The check is on at Main Clinic.");
    expect(checksOnText(3, 3, "Main Clinic")).toBe("All 3 checks are on at Main Clinic.");
    expect(checksOnText(2, 3, "Main Clinic")).toBe("2 of 3 checks are on at Main Clinic.");
  });

  it("lists the checks that speak inside a record, with where, once each", () => {
    const rows = recordRules([
      surface({ surface: "encounter", rules: [rule("clinic.encounter-checklist", true, "encounter"), rule("laboratory.order-sets", false, "encounter")] }),
      surface({ surface: "dental", rules: [rule("dental.plan-decisions", true, "patient")] }),
      surface({ surface: "prescribing", rules: [rule("prescription.dose-limit", false, "draft")] }),
      // Rules of the area screens are not record checks, even when one needs a prescription (the pharmacy area lists it).
      surface({ surface: "pharmacy", rules: [rule("dispensing.course-expiry", true, "prescription")] }),
    ]);
    expect(rows.map((r) => [r.ruleId, r.on, r.place])).toEqual([
      ["clinic.encounter-checklist", true, "In a consultation"],
      ["laboratory.order-sets", false, "In a consultation"],
      ["dental.plan-decisions", true, "On a patient's dental record"],
      ["prescription.dose-limit", false, "When a prescription is written"],
    ]);
  });
});
