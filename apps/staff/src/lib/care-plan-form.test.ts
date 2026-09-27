import { describe, expect, it } from "vitest";
import { activityActions, addDays, blankActivity, blankGoal, buildCarePlanPayload, isOverdue, planChangeNeedsReason, planTransitions } from "./care-plan-form";

const base = { title: "Type 2 diabetes", category: "chronic_disease" as const, description: "", startDate: "2026-09-27", endDate: "", problems: [] };

describe("buildCarePlanPayload", () => {
  it("links activities to goals by index and drops blank rows", () => {
    const goal = { ...blankGoal(), description: "HbA1c below 7%", targetMeasure: "HbA1c", targetValue: "< 7%", targetDate: "2026-12-27" };
    const blankG = blankGoal();
    const lab = {
      ...blankActivity("laboratory_monitoring"),
      description: "Repeat HbA1c",
      dueDate: "2026-12-20",
      recurrenceIntervalDays: "90",
      goalKey: goal.key,
    };
    const visit = { ...blankActivity(), description: "Review in 2 weeks", dueDate: "2026-10-11" };
    const result = buildCarePlanPayload({ ...base, goals: [blankG, goal], activities: [lab, blankActivity(), visit] });
    expect(result).toEqual({
      ok: true,
      payload: {
        title: "Type 2 diabetes",
        category: "chronic_disease",
        description: undefined,
        startDate: "2026-09-27",
        endDate: undefined,
        problems: [],
        goals: [{ description: "HbA1c below 7%", targetMeasure: "HbA1c", targetValue: "< 7%", targetDate: "2026-12-27" }],
        activities: [
          {
            kind: "laboratory_monitoring",
            description: "Repeat HbA1c",
            assignee: "care_team",
            dueDate: "2026-12-20",
            recurrenceIntervalDays: 90,
            goalIndex: 0,
          },
          {
            kind: "follow_up_appointment",
            description: "Review in 2 weeks",
            assignee: "care_team",
            dueDate: "2026-10-11",
            recurrenceIntervalDays: undefined,
            goalIndex: undefined,
          },
        ],
      },
    });
  });

  it("explains what is missing or wrong", () => {
    expect(buildCarePlanPayload({ ...base, title: " ", goals: [], activities: [] })).toEqual({ ok: false, message: "Give the care plan a title." });
    expect(buildCarePlanPayload({ ...base, goals: [], activities: [] })).toMatchObject({ ok: false, message: "Add at least one goal or activity." });
    expect(buildCarePlanPayload({ ...base, endDate: "2026-01-01", goals: [], activities: [] })).toMatchObject({ ok: false });
    const bad = { ...blankActivity(), description: "Check feet", recurrenceIntervalDays: "0" };
    expect(buildCarePlanPayload({ ...base, goals: [], activities: [bad] })).toEqual({ ok: false, message: '"Check feet": repeat every 1–730 days.' });
  });

  it("assigns patient tasks to the patient by default", () => {
    expect(blankActivity("patient_task").assignee).toBe("patient");
  });
});

describe("rules mirrored from libs/care-plan", () => {
  it("offers booking only for planned care-team follow-up visits on an open plan", () => {
    const ctx = { planStatus: "active" as const, canManage: true, canBook: true };
    expect(activityActions({ status: "planned", kind: "follow_up_appointment", assignee: "care_team" }, ctx)).toEqual(["book", "complete", "cancel"]);
    expect(activityActions({ status: "scheduled", kind: "follow_up_appointment", assignee: "care_team" }, ctx)).toEqual(["complete", "cancel"]);
    expect(activityActions({ status: "planned", kind: "lifestyle", assignee: "patient" }, { ...ctx, canBook: false })).toEqual(["complete", "cancel"]);
    expect(activityActions({ status: "completed", kind: "lifestyle", assignee: "patient" }, ctx)).toEqual([]);
    expect(activityActions({ status: "planned", kind: "lifestyle", assignee: "patient" }, { ...ctx, planStatus: "completed" })).toEqual([]);
    expect(activityActions({ status: "planned", kind: "lifestyle", assignee: "patient" }, { ...ctx, canManage: false })).toEqual([]);
  });

  it("follows the plan status transitions", () => {
    expect(planTransitions("active")).toEqual(["on_hold", "completed", "cancelled"]);
    expect(planTransitions("completed")).toEqual([]);
    expect(planChangeNeedsReason("cancelled")).toBe(true);
    expect(planChangeNeedsReason("completed")).toBe(false);
  });

  it("marks overdue open activities and adds days", () => {
    expect(isOverdue({ status: "planned", dueDate: "2026-09-01" }, "2026-09-27")).toBe(true);
    expect(isOverdue({ status: "scheduled", dueDate: "2026-09-01" }, "2026-09-27")).toBe(false);
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
  });
});
