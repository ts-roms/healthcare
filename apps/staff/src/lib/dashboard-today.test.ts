import { describe, expect, it } from "vitest";
import type {
  AppointmentItem,
  ClinicDashboard,
  ClinicLoadDay,
  LabCriticalAlert,
  LabDashboard,
  LabQualitySummary,
  PractitionerDetail,
  QueueVisit,
} from "./api/types";
import {
  appointmentFigures,
  greeting,
  labAttentionRows,
  loadLevel,
  nextUpRows,
  openSlots,
  patientAttentionRows,
  seenComparison,
  setupAttentionRows,
  sortAttention,
  weekBars,
  weekStartOf,
} from "./dashboard-today";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-21T02:00:00Z"); // 10:00 in Manila, a Wednesday

const quiet: ClinicDashboard = {
  facilityId: "f",
  date: "2026-10-21",
  appointments: { byStatus: { booked: 3, checked_in: 2, completed: 4, no_show: 1, cancelled: 2 }, total: 10, noShowRate: 0.1 },
  queue: { byStatus: {}, waiting: 0, inConsultation: 0, walkedOut: 0, averageWaitMinutes: null, longestCurrentWaitMinutes: null },
  encounters: { inProgress: 0, completedToday: 0 },
  providerWorkload: [],
};

const visit = (over: Partial<QueueVisit>): QueueVisit =>
  ({
    id: "v",
    ticket: "A-021",
    priority: "routine",
    status: "waiting",
    checkedInAt: new Date(NOW.getTime() - 34 * 60_000).toISOString(),
    patient: { patientNumber: "P1", displayName: "SANTOS, Maria", sex: "female", age: 70 },
    ...over,
  }) as QueueVisit;

describe("patientAttentionRows", () => {
  const base = { dashboard: quiet, due: null, canOpenEncounters: true, canOpenQueue: true, now: NOW };

  it("names the patient and the ticket for a long wait", () => {
    const rows = patientAttentionRows({
      ...base,
      visits: [visit({}), visit({ id: "w", ticket: "A-022", checkedInAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() })],
    });
    expect(rows).toEqual([
      {
        id: "long-wait",
        group: "patients",
        tone: "urgent",
        title: "SANTOS, Maria waiting 34 min",
        detail: "Waiting room · ticket A-021",
        action: { label: "Call now", href: "/queue" },
      },
    ]);
    expect(patientAttentionRows({ ...base, visits: [visit({ priority: "urgent" })] })[0]?.title).toBe("SANTOS, Maria waiting 34 min (urgent priority)");
  });

  it("says nothing of a short wait and replaces the general long-wait row", () => {
    expect(patientAttentionRows({ ...base, visits: [visit({ checkedInAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() })] })).toEqual([]);
    const busy = { ...quiet, queue: { ...quiet.queue, longestCurrentWaitMinutes: 72 }, encounters: { inProgress: 2, completedToday: 1 } };
    const rows = patientAttentionRows({ ...base, dashboard: busy, visits: [visit({})] });
    expect(rows.map((r) => r.id)).toEqual(["long-wait", "unsigned"]);
    expect(rows[0]?.title).toContain("34 min");
    // Without the queue the general row remains, pointing nowhere the viewer cannot open.
    expect(patientAttentionRows({ ...base, dashboard: busy, visits: null, canOpenQueue: false }).map((r) => [r.id, r.action ?? null])).toEqual([
      ["long-wait", null],
      ["unsigned", { label: "Review", href: "/clinic/encounters" }],
    ]);
  });
});

describe("labAttentionRows", () => {
  const lab = { pendingCollection: 3, statPendingCollection: 0, overdue: 0 } as LabDashboard;
  const critical = [{ testName: "Potassium", patient: { patientNumber: "P9" } }] as LabCriticalAlert[];
  const quality = {
    nonconformances: { open: 0, investigating: 0, critical: 0, major: 0 },
    qc: { rejected: 0, missing: 0, resultsBlocked: 0 },
    instruments: { outOfService: 0, calibrationOverdue: 0 },
    reagents: { low: 0 },
    temperatures: { readingsDue: 0, outOfRangeNow: 0, excursionsLast7Days: 0 },
    eqa: { overdue: 0, awaitingEvaluation: 0 },
    competency: { required: false, due: 0, notYetCompetent: 0, staffNotAssessed: 0 },
    licence: { state: "valid", validUntil: "2027-01-01" },
  } as LabQualitySummary;

  it("lists critical results, tests past their time and samples to collect", () => {
    const rows = labAttentionRows({ dashboard: { ...lab, overdue: 2 }, criticals: critical, quality: null, canOpenWorkbench: true });
    expect(rows.map((r) => [r.id, r.tone, r.title, r.action?.label, r.action?.href])).toEqual([
      ["lab-critical", "urgent", "Critical results not yet acknowledged", "Acknowledge", "/laboratory/critical"],
      ["lab-overdue", "soon", "Tests past their turnaround time · 2", "Open lab", "/laboratory/worklist"],
      ["lab-collect", "soon", "3 lab samples not yet collected", "Open lab", "/laboratory/worklist?stage=collect"],
    ]);
    expect(rows[0]?.detail).toBe("Potassium — P9");
    expect(labAttentionRows({ dashboard: { ...lab, pendingCollection: 1 }, criticals: [], quality: null, canOpenWorkbench: false })).toEqual([
      {
        id: "lab-collect",
        group: "lab",
        tone: "soon",
        title: "1 lab sample not yet collected",
        detail: "Ordered and waiting to be collected",
        action: undefined,
      },
    ]);
  });

  it("lists STAT samples to collect as urgent, ahead of the other lab rows, and counts the rest separately", () => {
    const rows = labAttentionRows({
      dashboard: { ...lab, pendingCollection: 3, statPendingCollection: 2, overdue: 1 },
      criticals: [],
      quality: null,
      canOpenWorkbench: true,
    });
    expect(rows.map((r) => [r.id, r.tone, r.title, r.action?.label])).toEqual([
      ["lab-collect-stat", "urgent", "2 STAT lab samples not yet collected", "Collect now"],
      ["lab-overdue", "soon", "Tests past their turnaround time", "Open lab"],
      ["lab-collect", "soon", "1 lab sample not yet collected", "Open lab"],
    ]);
    const onlyStat = labAttentionRows({
      dashboard: { ...lab, pendingCollection: 1, statPendingCollection: 1 },
      criticals: [],
      quality: null,
      canOpenWorkbench: false,
    });
    expect(onlyStat.map((r) => [r.id, r.title, r.action])).toEqual([["lab-collect-stat", "1 STAT lab sample not yet collected", undefined]]);
  });

  it("leaves a licence that was never recorded to Setup, and keeps an expired one here", () => {
    expect(
      labAttentionRows({ dashboard: null, criticals: [], quality: { ...quality, licence: { state: "missing", validUntil: null } }, canOpenWorkbench: true }),
    ).toEqual([]);
    const expired = labAttentionRows({
      dashboard: null,
      criticals: [],
      quality: { ...quality, licence: { state: "expired", validUntil: "2026-01-01" } },
      canOpenWorkbench: true,
    });
    expect(expired.map((r) => [r.id, r.tone])).toEqual([["quality-licence", "urgent"]]);
  });
});

describe("setupAttentionRows", () => {
  const doctor = (over: Partial<PractitionerDetail>): PractitionerDetail =>
    ({ id: "d1", displayName: "Dr. Villanueva", status: "active", userId: "u", licenseNumber: "0123", ...over }) as PractitionerDetail;
  const quality = { licence: { state: "missing", validUntil: null } } as LabQualitySummary;

  it("names a single practitioner and the laboratory licence", () => {
    const rows = setupAttentionRows({ practitioners: [doctor({ userId: null }), doctor({ id: "d2", displayName: "Dr. Ok" })], quality });
    expect(rows.map((r) => [r.id, r.title, r.action?.label, r.action?.href])).toEqual([
      ["setup-lab-licence", "Laboratory licence not recorded", "Add licence", "/laboratory/licence"],
      ["setup-account", "Dr. Villanueva has no staff account", "Link account", "/doctors/d1"],
    ]);
    expect(rows.every((r) => r.group === "setup" && r.tone === "setup")).toBe(true);
  });

  it("sums up several practitioners and ignores inactive ones", () => {
    const rows = setupAttentionRows({
      practitioners: [
        doctor({ id: "a", displayName: "Dr. A", licenseNumber: null }),
        doctor({ id: "b", displayName: "Dr. B", licenseNumber: null }),
        doctor({ id: "c", displayName: "Dr. C", licenseNumber: null }),
        doctor({ id: "d", displayName: "Dr. D", licenseNumber: null }),
        doctor({ id: "x", displayName: "Dr. Gone", licenseNumber: null, status: "inactive" }),
      ],
      quality: null,
    });
    expect(rows).toEqual([
      {
        id: "setup-licence",
        group: "setup",
        tone: "setup",
        title: "4 practitioners have no licence number recorded",
        detail: "Dr. A, Dr. B, Dr. C and 1 more",
        action: { label: "Review", href: "/doctors" },
      },
    ]);
    expect(setupAttentionRows({ practitioners: null, quality: null })).toEqual([]);
  });
});

describe("sortAttention", () => {
  it("puts urgent first and setup last, keeping the order within a tone", () => {
    const row = (id: string, tone: "urgent" | "soon" | "info" | "setup") => ({ id, group: "lab" as const, tone, title: id });
    expect(
      sortAttention([row("s1", "setup"), row("i", "info"), row("u1", "urgent"), row("o1", "soon"), row("u2", "urgent"), row("o2", "soon")]).map((r) => r.id),
    ).toEqual(["u1", "u2", "o1", "o2", "i", "s1"]);
  });
});

describe("nextUpRows", () => {
  const appt = (id: string, minutesFromNow: number, status: AppointmentItem["status"], over: Partial<AppointmentItem> = {}): AppointmentItem =>
    ({
      id,
      patientId: `p-${id}`,
      practitionerId: "dr",
      visitTypeId: "vt",
      startsAt: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString(),
      endsAt: new Date(NOW.getTime() + (minutesFromNow + 15) * 60_000).toISOString(),
      status,
      reason: null,
      patient: { patientNumber: "P1", displayName: `NAME ${id}`, sex: "male", age: 30 },
      ...over,
    }) as AppointmentItem;
  const names = { practitioner: () => "Dr. Ramos", visitType: (id: string) => (id === "vt" ? "Follow-up" : undefined) };

  it("shows who is checked in, who is late and who is expected, soonest first, and leaves out the rest", () => {
    const rows = nextUpRows(
      [
        appt("expected", 30, "confirmed"),
        appt("late", -10, "booked"),
        appt("in", -5, "checked_in"),
        appt("done", -60, "completed"),
        appt("gone", -40, "booked"),
        appt("cancelled", 5, "cancelled"),
        appt("reasoned", 45, "booked", { reason: "Lab result review" }),
      ],
      NOW,
      TZ,
      names,
    );
    expect(rows.map((r) => [r.id, r.time, r.status, r.lateMinutes, r.reason, r.provider])).toEqual([
      ["late", "09:50", "late", 10, "Follow-up", "Dr. Ramos"],
      ["in", "09:55", "checked_in", 0, "Follow-up", "Dr. Ramos"],
      ["expected", "10:30", "expected", 0, "Follow-up", "Dr. Ramos"],
      ["reasoned", "10:45", "expected", 0, "Lab result review", "Dr. Ramos"],
    ]);
    expect(nextUpRows([appt("a", 1, "booked"), appt("b", 2, "booked"), appt("c", 3, "booked")], NOW, TZ, names, 2)).toHaveLength(2);
  });
});

describe("how busy the days are", () => {
  it("draws a day by the share of its slots that are held", () => {
    expect(loadLevel({ booked: 0, slots: 0 })).toBe("none");
    expect(loadLevel({ booked: 0, slots: 8 })).toBe("light");
    expect(loadLevel({ booked: 3, slots: 8 })).toBe("light");
    expect(loadLevel({ booked: 4, slots: 8 })).toBe("busy");
    expect(loadLevel({ booked: 6, slots: 8 })).toBe("busy");
    expect(loadLevel({ booked: 7, slots: 8 })).toBe("full");
    expect(loadLevel({ booked: 2, slots: 0 })).toBe("full");
    expect(openSlots({ booked: 5, slots: 8 })).toBe(3);
    expect(openSlots({ booked: 9, slots: 8 })).toBe(0);
  });

  it("finds the Monday of a week and draws Monday to Saturday, today named", () => {
    expect(weekStartOf("2026-10-21")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
    const day = (date: string, scheduled: number, slots = 0): ClinicLoadDay => ({ date, scheduled, booked: scheduled, slots });
    const days = [
      day("2026-10-19", 32),
      day("2026-10-20", 28),
      day("2026-10-21", 24),
      day("2026-10-22", 30),
      day("2026-10-23", 26),
      day("2026-10-24", 12),
      day("2026-10-25", 0),
    ];
    expect(weekBars(days, "2026-10-21").map((b) => [b.label, b.count, b.today])).toEqual([
      ["Mon", 32, false],
      ["Tue", 28, false],
      ["Today", 24, true],
      ["Thu", 30, false],
      ["Fri", 26, false],
      ["Sat", 12, false],
    ]);
    expect(weekBars([...days.slice(0, 6), day("2026-10-25", 2)], "2026-10-21").map((b) => b.label)).toEqual([
      "Mon",
      "Tue",
      "Today",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(weekBars([], "2026-10-21").map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("tiles and greeting", () => {
  it("counts who arrived and who did not come", () => {
    expect(appointmentFigures(quiet)).toEqual({ total: 10, arrived: 6, noShow: 1 });
  });

  it("compares with the same weekday last week", () => {
    expect(seenComparison(12, 10, "Wed")).toBe("2 more than last Wed");
    expect(seenComparison(9, 10, "Wed")).toBe("1 fewer than last Wed");
    expect(seenComparison(10, 10, "Wed")).toBe("Same as last Wed");
    expect(seenComparison(10, null, "Wed")).toBeNull();
  });

  it("greets by the facility's local hour", () => {
    expect(greeting(new Date("2026-10-21T00:30:00Z"), TZ)).toBe("Good morning"); // 08:30
    expect(greeting(new Date("2026-10-21T04:30:00Z"), TZ)).toBe("Good afternoon"); // 12:30
    expect(greeting(new Date("2026-10-21T11:00:00Z"), TZ)).toBe("Good evening"); // 19:00
  });
});
