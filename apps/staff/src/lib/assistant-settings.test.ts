import { describe, expect, it } from "vitest";
import type { AssistantRule, AssistantRuleSettingValue } from "./api/types";
import { expectedVersion, parameterFields, readParameters, ruleState, ruleStateLabel } from "./assistant-settings";

const setting = (enabled: boolean, parameters: Record<string, unknown> = {}, version = 1): AssistantRuleSettingValue => ({
  version,
  enabled,
  parameters,
  updatedAt: "2026-11-20T02:00:00Z",
});

const rule = (over: Partial<AssistantRule> = {}): AssistantRule => ({
  ruleId: "inventory.days-of-cover",
  ruleVersion: 1,
  domain: "inventory",
  title: "Stock may run out before a delivery arrives",
  description: "…",
  surfaces: ["inventory"],
  requires: ["inventory.read"],
  defaultParameters: { windowDays: 30, leadTimeDays: 14 },
  parameterLabels: {
    leadTimeDays: { label: "Delivery time", unit: "days", min: 1, max: 120 },
    windowDays: { label: "Pace measured over the last", unit: "days", min: 7, max: 180 },
  },
  scope: { facilityId: null },
  setting: null,
  organizationSetting: null,
  ...over,
});

describe("rule state", () => {
  it("is off until someone turns the rule on", () => {
    expect(ruleState(rule())).toEqual({ kind: "unset" });
    expect(ruleStateLabel(ruleState(rule()), "the whole organization")).toBe("Off: not turned on yet");
  });

  it("names the scope's own setting", () => {
    const state = ruleState(rule({ setting: setting(true) }));
    expect(ruleStateLabel(state, "the whole organization")).toBe("On for the whole organization");
  });

  it("says when a facility follows the organization", () => {
    const state = ruleState(rule({ scope: { facilityId: "f1" }, organizationSetting: setting(true) }));
    expect(state).toEqual({ kind: "inherited", enabled: true });
    expect(ruleStateLabel(state, "Main clinic")).toBe("On: follows the organization's setting");
  });

  it("prefers a facility's own setting over the organization's", () => {
    expect(ruleState(rule({ scope: { facilityId: "f1" }, setting: setting(false), organizationSetting: setting(true) }))).toEqual({
      kind: "own",
      enabled: false,
    });
  });
});

describe("parameter fields", () => {
  it("lists the labelled parameters in the rule's order with the starting values", () => {
    expect(parameterFields(rule()).map((f) => [f.key, f.value])).toEqual([
      ["leadTimeDays", "14"],
      ["windowDays", "30"],
    ]);
  });

  it("fills a facility from its own values, else the organization's", () => {
    expect(parameterFields(rule({ scope: { facilityId: "f1" }, organizationSetting: setting(true, { leadTimeDays: 21, windowDays: 60 }) }))[0]!.value).toBe(
      "21",
    );
    expect(
      parameterFields(rule({ setting: setting(true, { leadTimeDays: 7, windowDays: 30 }), organizationSetting: setting(true, { leadTimeDays: 21 }) }))[0]!
        .value,
    ).toBe("7");
  });

  it("reads whole numbers within range and names the first wrong field", () => {
    const fields = parameterFields(rule());
    expect(readParameters(fields, { leadTimeDays: "10", windowDays: " 45 " })).toEqual({ ok: true, parameters: { leadTimeDays: 10, windowDays: 45 } });
    expect(readParameters(fields, { leadTimeDays: "2.5", windowDays: "45" })).toEqual({
      ok: false,
      message: "Delivery time: enter a whole number from 1 to 120.",
    });
    expect(readParameters(fields, { leadTimeDays: "10", windowDays: "3" })).toEqual({
      ok: false,
      message: "Pace measured over the last: enter a whole number from 7 to 180.",
    });
    expect(readParameters(fields, { leadTimeDays: "", windowDays: "45" }).ok).toBe(false);
  });

  it("sends back the version last read for the scope", () => {
    expect(expectedVersion(rule())).toBe(0);
    expect(expectedVersion(rule({ setting: setting(true, {}, 4) }))).toBe(4);
  });
});
