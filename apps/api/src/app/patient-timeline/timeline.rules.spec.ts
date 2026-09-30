import { BadRequestError, PERMISSIONS, type TimelinePosition } from "@healthcare/core";
import {
  compareTimeline,
  decodeCursor,
  encodeCursor,
  humanize,
  mergePage,
  summarizeNames,
  TIMELINE_KIND_KEYS,
  TIMELINE_KINDS,
  visibleKinds,
} from "./timeline.rules";

const at = (s: string) => `2026-09-${s}.000000Z`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pos = (time: string, source: string, n: number): TimelinePosition => ({ at: at(time), source, id: id(n) });

describe("visibleKinds", () => {
  it("includes only the kinds whose domain read permission the caller holds and withholds the rest", () => {
    const cashier = new Set(["patient.read", "billing.charge.read"]);
    const result = visibleKinds(cashier);
    // Consents are read with the patient record itself (patient.read).
    expect(result.included).toEqual(["consent", "invoice", "payment", "billing_note", "deposit"]);
    expect(result.withheld).toEqual(TIMELINE_KIND_KEYS.filter((k) => !result.included.includes(k)));
  });

  it("maps each kind to its domain's permission", () => {
    const labTech = new Set(["lab.order.read", "lab.result.read"]);
    expect(visibleKinds(labTech).included).toEqual(["lab_order", "specimen", "lab_result_release", "critical_value"]);
    const clinical = new Set(["clinical.read"]);
    expect(visibleKinds(clinical).included).toEqual(["triage", "vitals", "allergy", "external_history"]);
    expect(visibleKinds(new Set(["dental.record.read"])).included).toEqual(["dental"]);
    expect(visibleKinds(new Set(["dental.imaging.read"])).included).toEqual(["dental_imaging"]);
    expect(visibleKinds(new Set(["notification.read"])).included).toEqual(["communication"]);
    expect(visibleKinds(new Set(["clinic.queue.read"])).included).toEqual(["queue_visit"]);
    expect(visibleKinds(new Set(["encounter.read"])).included).toEqual(["encounter", "referral", "medical_certificate", "procedure"]);
    expect(visibleKinds(new Set(["prescription.read"])).included).toEqual(["prescription", "dispense"]);
    expect(visibleKinds(new Set(["philhealth.claim.submit"])).included).toEqual(["philhealth_claim"]);
    expect(visibleKinds(new Set(["philhealth.eligibility.manage"])).included).toEqual(["philhealth_eligibility"]);
    expect(visibleKinds(new Set(["doh.report.manage"])).included).toEqual(["doh_case_report"]);
    expect(visibleKinds(new Set(["patient.records-request.manage"])).included).toEqual(["records_request"]);
  });

  it("gates every kind by a permission of the catalog", () => {
    for (const kind of TIMELINE_KIND_KEYS) expect(PERMISSIONS).toContain(TIMELINE_KINDS[kind].permission);
  });

  it("gives every source one kind only", () => {
    const sources = TIMELINE_KIND_KEYS.flatMap((k) => TIMELINE_KINDS[k].sources);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("limits to the requested kinds, withholding only requested ones", () => {
    const result = visibleKinds(new Set(["appointment.read"]), ["appointment", "dental"]);
    expect(result).toEqual({ included: ["appointment"], withheld: ["dental"] });
  });
});

describe("compareTimeline and mergePage", () => {
  it("orders newest first, then by source, then by id, all descending", () => {
    const rows = [
      pos("01T10:00:00", "encounter", 1),
      pos("02T10:00:00", "appointment", 1),
      pos("01T10:00:00", "encounter", 2),
      pos("01T10:00:00", "vitals", 1),
    ];
    expect([...rows].sort(compareTimeline)).toEqual([
      pos("02T10:00:00", "appointment", 1),
      pos("01T10:00:00", "vitals", 1),
      pos("01T10:00:00", "encounter", 2),
      pos("01T10:00:00", "encounter", 1),
    ]);
  });

  it("merges sources, trims to the page and returns the last row's position when more remain", () => {
    const a = [pos("03T00:00:00", "appointment", 3), pos("01T00:00:00", "appointment", 1)];
    const b = [pos("02T00:00:00", "invoice", 2), pos("01T00:00:00", "invoice", 1)];
    const page = mergePage([a, b], 2);
    expect(page.items).toEqual([a[0], b[0]]);
    expect(page.next).toEqual(b[0]);
    expect(mergePage([a, b], 4).next).toBeNull();
  });

  it("pages through rows sharing one timestamp without duplicates or gaps", () => {
    // Twelve rows at the same instant across three sources; each source returns rows strictly after the cursor.
    const all = ["appointment", "invoice", "payment"].flatMap((source) => [1, 2, 3, 4].map((n) => pos("05T08:00:00", source, n)));
    const after = (cursor: TimelinePosition | null) => (rows: TimelinePosition[]) => rows.filter((r) => !cursor || compareTimeline(r, cursor) > 0);
    const bySource = (source: string) => all.filter((r) => r.source === source).sort(compareTimeline);
    const seen: TimelinePosition[] = [];
    let cursor: TimelinePosition | null = null;
    for (let i = 0; i < 10; i++) {
      const filter = after(cursor);
      const page = mergePage(
        ["appointment", "invoice", "payment"].map((s) => filter(bySource(s)).slice(0, 6)),
        5,
      );
      seen.push(...page.items);
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen.map((r) => `${r.source}:${r.id}`)).size).toBe(12);
    expect(seen).toEqual([...all].sort(compareTimeline));
  });
});

describe("cursors", () => {
  it("round-trips a position", () => {
    const position = pos("05T08:00:00", "lab_result_release", 7);
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it("accepts a cursor of every source", () => {
    for (const kind of TIMELINE_KIND_KEYS) {
      for (const source of TIMELINE_KINDS[kind].sources) expect(decodeCursor(encodeCursor(pos("05T08:00:00", source, 1))).source).toBe(source);
    }
  });

  it.each([
    ["not base64 json", "%%%"],
    ["unknown source", Buffer.from(JSON.stringify([at("01T00:00:00"), "patient", id(1)])).toString("base64url")],
    ["bad instant", Buffer.from(JSON.stringify(["2026-09-01", "encounter", id(1)])).toString("base64url")],
    ["bad id", Buffer.from(JSON.stringify([at("01T00:00:00"), "encounter", "1; DROP TABLE"])).toString("base64url")],
  ])("rejects a cursor with %s", (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestError);
  });
});

describe("display helpers", () => {
  it("summarizes names", () => {
    expect(summarizeNames(["CBC"])).toBe("CBC");
    expect(summarizeNames(["A", "B", "C", "D", "E"])).toBe("A, B, C +2 more");
  });

  it("humanizes keys", () => {
    expect(humanize("appointment.no-show")).toBe("Appointment no show");
    expect(humanize("chronic_disease")).toBe("Chronic disease");
  });
});
