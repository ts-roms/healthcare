import { describe, expect, it } from "vitest";
import { closeOptionsFor, isOpenVisit, parseProfileTab, recordCompleteness, splitOpenVisits } from "./patient-profile";

const FULL = {
  birthDateIsEstimated: false,
  civilStatus: "single",
  nationality: "Filipino",
  occupation: "Teacher",
  contacts: [{ system: "mobile", value: "0917 000 0000" }],
  addresses: [{ id: "a" }],
  identifiers: [{ id: "i" }],
  relationships: [{ isEmergencyContact: true, isLegalGuardian: false }],
  consents: [{ id: "c" }],
} as unknown as Parameters<typeof recordCompleteness>[0];

describe("parseProfileTab", () => {
  it("accepts the known tabs and falls back to the overview", () => {
    expect(parseProfileTab("labs")).toBe("labs");
    expect(parseProfileTab(["coverage", "labs"])).toBe("coverage");
    expect(parseProfileTab("nope")).toBe("overview");
    expect(parseProfileTab(undefined)).toBe("overview");
  });
});

describe("recordCompleteness", () => {
  it("is complete when everything the desk can ask for is recorded", () => {
    expect(recordCompleteness(FULL)).toMatchObject({ percent: 100, done: 9, total: 9, missing: [] });
  });

  it("lists what is missing, in order, and rounds the figure", () => {
    const result = recordCompleteness({
      ...FULL,
      birthDateIsEstimated: true,
      occupation: null,
      relationships: [],
      contacts: [{ system: "email", value: "a@b.ph" }],
    } as never);
    expect(result.missing).toEqual(["Exact date of birth", "Occupation", "Mobile number", "Emergency contact"]);
    expect(result.done).toBe(5);
    expect(result.percent).toBe(56);
  });

  it("does not count a blank mobile number or a relationship that is neither emergency contact nor guardian", () => {
    const result = recordCompleteness({
      ...FULL,
      contacts: [{ system: "mobile", value: "  " }],
      relationships: [{ isEmergencyContact: false, isLegalGuardian: false }],
    } as never);
    expect(result.missing).toEqual(["Mobile number", "Emergency contact"]);
  });
});

describe("splitOpenVisits", () => {
  const visit = (queueDate: string, status: string, checkedInAt: string) => ({ queueDate, status, checkedInAt }) as never;

  it("separates today's open visits from those left open on an earlier day, ignoring finished ones", () => {
    const visits = [
      visit("2026-10-21", "waiting", "2026-10-21T01:00:00Z"),
      visit("2026-10-20", "in_triage", "2026-10-20T01:00:00Z"),
      visit("2026-10-19", "waiting", "2026-10-19T01:00:00Z"),
      visit("2026-10-21", "completed", "2026-10-21T00:00:00Z"),
      visit("2026-10-18", "cancelled", "2026-10-18T00:00:00Z"),
    ];
    const split = splitOpenVisits(visits, "2026-10-21");
    expect(split.today).toHaveLength(1);
    expect(split.earlier.map((v: { queueDate: string }) => v.queueDate)).toEqual(["2026-10-20", "2026-10-19"]);
  });

  it("knows which statuses are open", () => {
    expect(["waiting", "in_triage", "awaiting_consultation", "in_consultation"].every((s) => isOpenVisit(s as never))).toBe(true);
    expect(["completed", "cancelled", "left_without_being_seen"].some((s) => isOpenVisit(s as never))).toBe(false);
  });
});

describe("closeOptionsFor", () => {
  it("offers cancel only before triage, and nothing during a consultation", () => {
    expect(closeOptionsFor("waiting").map((o) => o.value)).toEqual(["left_without_being_seen", "cancelled"]);
    expect(closeOptionsFor("in_triage").map((o) => o.value)).toEqual(["left_without_being_seen"]);
    expect(closeOptionsFor("awaiting_consultation").map((o) => o.value)).toEqual(["left_without_being_seen"]);
    expect(closeOptionsFor("in_consultation")).toEqual([]);
  });
});
