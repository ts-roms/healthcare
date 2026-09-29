import { describe, expect, it } from "vitest";
import type { ClinicDashboard, DueCareActivity, LabQualitySummary } from "./api/types";
import { attentionItems, minutesLabel, qualityAttentionItems } from "./dashboard-mapping";

const quiet: ClinicDashboard = {
  facilityId: "f",
  date: "2026-09-27",
  appointments: { byStatus: {}, total: 0, noShowRate: 0 },
  queue: { byStatus: {}, waiting: 0, inConsultation: 0, walkedOut: 0, averageWaitMinutes: null, longestCurrentWaitMinutes: null },
  encounters: { inProgress: 0, completedToday: 0 },
  providerWorkload: [],
};
const open = { canOpenEncounters: true, canOpenQueue: true };
const due = (overdue: boolean, planTitle = "Diabetes"): DueCareActivity =>
  ({
    id: Math.random().toString(),
    carePlanId: "p",
    patientId: "x",
    kind: "laboratory_monitoring",
    description: "HbA1c",
    dueDate: "2026-09-20",
    planTitle,
    overdue,
  }) as DueCareActivity;

describe("attentionItems", () => {
  it("is empty on a quiet day", () => {
    expect(attentionItems(quiet, { ...open, due: [] })).toEqual([]);
  });

  it("flags long waits, unsigned encounters and walk-outs", () => {
    const busy = { ...quiet, queue: { ...quiet.queue, longestCurrentWaitMinutes: 72, walkedOut: 1 }, encounters: { inProgress: 3, completedToday: 5 } };
    const items = attentionItems(busy, { ...open, due: null });
    expect(items.map((i) => [i.id, i.count ?? null, i.href ?? null])).toEqual([
      ["long-wait", null, "/queue"],
      ["unsigned", 3, "/clinic/encounters"],
      ["lwbs", 1, "/queue"],
    ]);
    expect(items[0]?.detail).toBe("Longest current wait 1 h 12 min");
  });

  it("does not flag a wait at the threshold, and links only what the user can open", () => {
    const atThreshold = { ...quiet, queue: { ...quiet.queue, longestCurrentWaitMinutes: 45 }, encounters: { inProgress: 1, completedToday: 0 } };
    const items = attentionItems(atThreshold, { canOpenEncounters: false, canOpenQueue: false, due: null });
    expect(items).toEqual([{ id: "unsigned", severity: "warning", count: 1, title: "Unsigned encounter", detail: expect.any(String), href: undefined }]);
  });

  it("summarises overdue and upcoming care-plan activities", () => {
    const items = attentionItems(quiet, { ...open, due: [due(true), due(true), due(true, "Hypertension"), due(false)] });
    expect(items).toEqual([
      { id: "overdue", severity: "warning", count: 3, title: "Overdue care-plan activities", detail: "Diabetes ×2, Hypertension", href: "/clinic/care-plans" },
      { id: "due", severity: "info", count: 1, title: "Care-plan activities due this week", href: "/clinic/care-plans" },
    ]);
  });
});

describe("minutesLabel", () => {
  it("formats minutes for people", () => {
    expect([minutesLabel(null), minutesLabel(12), minutesLabel(60), minutesLabel(135)]).toEqual(["—", "12 min", "1 h", "2 h 15 min"]);
  });
});

describe("qualityAttentionItems", () => {
  const quiet: LabQualitySummary = {
    facilityId: "f",
    date: "2026-09-28",
    nonconformances: { open: 0, investigating: 0, critical: 0, major: 0 },
    qc: { rejected: 0, missing: 0, resultsBlocked: 0 },
    instruments: { outOfService: 0, calibrationOverdue: 0 },
    reagents: { low: 0 },
    temperatures: { readingsDue: 0, outOfRangeNow: 0, excursionsLast7Days: 3 },
    eqa: { overdue: 0, awaitingEvaluation: 0 },
    competency: { required: false, due: 0, notYetCompetent: 0, staffNotAssessed: 4 },
  };

  it("is empty when nothing is open (past excursions and unassessed staff without the policy don't count)", () => {
    expect(qualityAttentionItems(quiet)).toEqual([]);
  });

  it("marks what puts results or specimens at stake as critical", () => {
    const items = qualityAttentionItems({
      ...quiet,
      nonconformances: { open: 3, investigating: 1, critical: 1, major: 1 },
      qc: { rejected: 1, missing: 2, resultsBlocked: 1 },
      temperatures: { readingsDue: 2, outOfRangeNow: 1, excursionsLast7Days: 3 },
    });
    expect(items.map((i) => [i.id, i.severity, i.count])).toEqual([
      ["quality-nc", "critical", 3],
      ["quality-qc-blocked", "critical", 1],
      ["quality-qc", "warning", 3],
      ["quality-temp-out", "critical", 1],
      ["quality-temp-due", "warning", 2],
    ]);
    expect(items[0]?.detail).toBe("1 critical, 1 major, 1 under investigation");
    expect(items[2]?.detail).toBe("1 rejected, 2 not run in the window");
  });

  it("lists reagent lots running low", () => {
    expect(qualityAttentionItems({ ...quiet, reagents: { low: 2 } })).toEqual([
      expect.objectContaining({ id: "quality-reagents-low", severity: "warning", count: 2, href: "/laboratory/reagents" }),
    ]);
  });

  it("counts unassessed staff only when the facility requires competency", () => {
    const required = qualityAttentionItems({ ...quiet, competency: { required: true, due: 1, notYetCompetent: 0, staffNotAssessed: 2 } });
    expect(required).toEqual([
      expect.objectContaining({ id: "quality-competency", severity: "warning", count: 3, detail: "1 reassessment due, 2 people not assessed" }),
    ]);
    const optional = qualityAttentionItems({ ...quiet, competency: { required: false, due: 1, notYetCompetent: 0, staffNotAssessed: 2 } });
    expect(optional).toEqual([expect.objectContaining({ severity: "info", count: 1, detail: "1 reassessment due" })]);
  });

  it("summarises EQA and instruments", () => {
    const items = qualityAttentionItems({ ...quiet, eqa: { overdue: 1, awaitingEvaluation: 2 }, instruments: { outOfService: 1, calibrationOverdue: 0 } });
    expect(items).toEqual([
      expect.objectContaining({ id: "quality-instruments", severity: "info", detail: "1 out of service" }),
      expect.objectContaining({
        id: "quality-eqa",
        severity: "warning",
        count: 3,
        detail: "1 round past due, nothing reported, 2 rounds awaiting the provider's evaluation",
      }),
    ]);
  });
});
