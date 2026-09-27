import { describe, expect, it } from "vitest";
import type { ClinicDashboard, DueCareActivity } from "./api/types";
import { attentionItems, minutesLabel } from "./dashboard-mapping";

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
      { id: "overdue", severity: "warning", count: 3, title: "Overdue care-plan activities", detail: "Diabetes ×2, Hypertension" },
      { id: "due", severity: "info", count: 1, title: "Care-plan activities due this week" },
    ]);
  });
});

describe("minutesLabel", () => {
  it("formats minutes for people", () => {
    expect([minutesLabel(null), minutesLabel(12), minutesLabel(60), minutesLabel(135)]).toEqual(["—", "12 min", "1 h", "2 h 15 min"]);
  });
});
