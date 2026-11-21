import { describe, expect, it } from "vitest";
import type { AssistantRule, AssistantRuleInsight, AssistantRuleSettingValue } from "./api/types";
import {
  dismissedShare,
  expectedVersion,
  insightsOrder,
  parameterFields,
  readParameters,
  replaySummary,
  reviewSummary,
  ruleState,
  ruleStateLabel,
  whereOn,
} from "./assistant-settings";

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
  lastReview: null,
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

describe("replay summary", () => {
  const replay = (counts: number[]) => ({
    ruleId: "inventory.days-of-cover",
    facilityId: "f1",
    readAt: "08:00",
    days: counts.map((n, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, suggestions: n, weak: 0 })),
    averagePerDay: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
    maxPerDay: Math.max(...counts),
    notes: [],
  });

  it("says how often the rule would have spoken, and on how many days nothing", () => {
    expect(replaySummary(replay([2, 0, 4, 2]), "Main Clinic")).toBe(
      "Over the last 4 days at Main Clinic, these values would have shown about 2 suggestions a day (at most 4, and nothing on 1 day). Each day was read at 08:00.",
    );
  });

  it("says when nothing would have shown", () => {
    expect(replaySummary(replay([0, 0]), "Main Clinic")).toBe("Over the last 2 days at Main Clinic, these values would not have shown anything.");
  });
});

describe("insights", () => {
  const insight = (over: Partial<AssistantRuleInsight> = {}): AssistantRuleInsight => ({
    ruleId: "inventory.days-of-cover",
    ruleVersion: 2,
    title: "Stock may run out",
    description: "…",
    domain: "inventory",
    enabled: { organization: false, facilities: 0 },
    shown: 0,
    accepted: 0,
    dismissed: 0,
    notUseful: 0,
    answered: 0,
    reviewSuggested: false,
    reviewDue: false,
    reasons: [],
    lastReview: null,
    ...over,
  });

  it("says where a rule is on", () => {
    expect(whereOn({ organization: true, facilities: 0 })).toBe("Whole organization");
    expect(whereOn({ organization: true, facilities: 2 })).toBe("Whole organization and 2 facilities");
    expect(whereOn({ organization: false, facilities: 1 })).toBe("1 facility");
    expect(whereOn({ organization: false, facilities: 0 })).toBe("Off");
  });

  it("sums up the latest review, noting one made on an earlier version", () => {
    const review = { id: "r", ruleVersion: 2, outcome: "retire" as const, note: "Too noisy", falsePositives: null, reviewedOn: "2026-11-20" };
    expect(reviewSummary(null, 2)).toBe("Not reviewed yet");
    expect(reviewSummary(review, 2)).toBe("Retired after review on 2026-11-20");
    expect(reviewSummary({ ...review, outcome: "keep", ruleVersion: 1 }, 2)).toBe("Kept after review on 2026-11-20, an earlier version (1)");
  });

  it("gives the dismissed share of answers and lists rules due for review first", () => {
    expect(dismissedShare({ dismissed: 3, notUseful: 4, answered: 10 })).toBe(70);
    expect(dismissedShare({ dismissed: 0, notUseful: 0, answered: 0 })).toBeNull();
    const ordered = insightsOrder([
      insight({ ruleId: "off", title: "A off" }),
      insight({ ruleId: "on", title: "B on", enabled: { organization: true, facilities: 0 } }),
      insight({ ruleId: "noisy", title: "C noisy", reviewSuggested: true }),
      insight({ ruleId: "due", title: "D due", reviewDue: true }),
    ]);
    expect(ordered.map((r) => r.ruleId)).toEqual(["due", "noisy", "on", "off"]);
  });
});
