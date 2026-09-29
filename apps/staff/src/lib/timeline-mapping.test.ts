import { describe, expect, it } from "vitest";
import type { PatientTimelineEntry } from "./api/types";
import {
  appendPage,
  entryHref,
  entryStatus,
  groupByDay,
  markerLabel,
  parseTimelineFilters,
  timelineApiQuery,
  timelineHref,
  toggleGroup,
  withheldNote,
} from "./timeline-mapping";

const PATIENT = "11111111-1111-4111-8111-111111111111";
const entry = (over: Partial<PatientTimelineEntry>): PatientTimelineEntry => ({
  id: "encounter:e1",
  kind: "encounter",
  occurredAt: "2026-09-27T16:30:00.000000Z",
  facility: null,
  title: "Consultation",
  detail: null,
  status: "completed",
  marker: null,
  flag: null,
  link: { type: "encounter", id: "e1" },
  sourceIds: {},
  ...over,
});

describe("timeline filters", () => {
  it("reads groups and dates from search params, dropping unknown or malformed values", () => {
    expect(parseTimelineFilters({ groups: "billing,visits,nope", from: "2026-09-01", to: "yesterday" })).toEqual({
      groups: ["visits", "billing"],
      from: "2026-09-01",
      to: null,
    });
    expect(parseTimelineFilters({ from: "2026-09-30", to: "2026-09-01" })).toEqual({ groups: [], from: "2026-09-01", to: "2026-09-30" });
  });

  it("builds the API query from the chosen groups (all kinds when none)", () => {
    expect(timelineApiQuery({ groups: ["laboratory", "billing"], from: null, to: "2026-09-30" }, 50)).toEqual({
      kinds: "lab_order,lab_result_release,invoice,payment",
      from: undefined,
      to: "2026-09-30",
      limit: 50,
    });
    expect(timelineApiQuery({ groups: [], from: null, to: null }).kinds).toBeUndefined();
  });

  it("toggles a chip and keeps the URL in a stable order", () => {
    const on = toggleGroup({ groups: ["billing"], from: null, to: null }, "visits");
    expect(on.groups).toEqual(["visits", "billing"]);
    expect(timelineHref(PATIENT, on)).toBe(`/patients/${PATIENT}/timeline?groups=visits%2Cbilling`);
    expect(timelineHref(PATIENT, toggleGroup(on, "visits"))).toBe(`/patients/${PATIENT}/timeline?groups=billing`);
    expect(timelineHref(PATIENT, { groups: [], from: null, to: null })).toBe(`/patients/${PATIENT}/timeline`);
  });
});

describe("entry links", () => {
  it("opens each entry's own screen, from existing routes only", () => {
    expect(entryHref(entry({}), PATIENT, "Asia/Manila")).toBe("/clinic/encounters/e1");
    expect(entryHref(entry({ link: { type: "invoice", id: "i1" } }), PATIENT, "Asia/Manila")).toBe("/billing/invoices/i1");
    expect(entryHref(entry({ link: { type: "dental_record", id: PATIENT } }), PATIENT, "Asia/Manila")).toBe(`/dental/patients/${PATIENT}`);
    expect(entryHref(entry({ link: { type: "patient_laboratory", id: PATIENT } }), PATIENT, "Asia/Manila")).toBe(`/patients/${PATIENT}#laboratory`);
    expect(entryHref(entry({ link: { type: "telemedicine", id: "a1" } }), PATIENT, "Asia/Manila")).toBe("/telemedicine/a1");
    expect(entryHref(entry({ link: null }), PATIENT, "Asia/Manila")).toBeNull();
  });

  it("opens an appointment on its local day (facility time zone) and practitioner", () => {
    // 16:30 UTC on 27 September is 00:30 on 28 September in Manila.
    const appointment = entry({ kind: "appointment", link: { type: "appointment", id: "a1" }, sourceIds: { practitionerId: "p1" } });
    expect(entryHref(appointment, PATIENT, "Asia/Manila")).toBe("/appointments?date=2026-09-28&practitionerId=p1");
  });
});

describe("entry status", () => {
  it("labels statuses per kind, with a tone for the icon", () => {
    expect(entryStatus(entry({}))).toEqual({ label: "Signed", variant: "success", tone: "done" });
    expect(entryStatus(entry({ kind: "care_plan", status: "completed" }))).toMatchObject({ label: "Completed" });
    expect(entryStatus(entry({ kind: "communication", status: "suppressed" }))).toMatchObject({ label: "Not sent (preferences)" });
    expect(entryStatus(entry({ kind: "dental", status: "recorded" }))).toBeNull();
  });

  it("marks records that are not valid care instead of showing a status", () => {
    const voided = entry({ kind: "invoice", status: "void", marker: "void" });
    expect(entryStatus(voided)).toBeNull();
    expect(markerLabel(voided)).toBe("Void");
    expect(markerLabel(entry({ marker: "entered_in_error" }))).toBe("Entered in error");
  });
});

describe("grouping and paging", () => {
  it("groups consecutive entries by their day label", () => {
    const day = (iso: string) => iso.slice(0, 10);
    const days = groupByDay(
      [
        entry({ id: "a", occurredAt: "2026-09-28T01:00:00Z" }),
        entry({ id: "b", occurredAt: "2026-09-28T00:00:00Z" }),
        entry({ id: "c", occurredAt: "2026-09-20T00:00:00Z" }),
      ],
      day,
    );
    expect(days.map((d) => [d.label, d.items.map((i) => i.id)])).toEqual([
      ["2026-09-28", ["a", "b"]],
      ["2026-09-20", ["c"]],
    ]);
  });

  it("appends a further page without repeating entries", () => {
    expect(appendPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("says some records are withheld without naming or counting them", () => {
    expect(withheldNote([])).toBeNull();
    expect(withheldNote(["dental", "invoice"])).toMatch(/not shown to you/);
  });
});
