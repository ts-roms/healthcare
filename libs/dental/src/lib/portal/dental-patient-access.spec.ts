import type { ChartTooth } from "../chart/dental-chart.service";
import type { DentalProcedureRecord, DentalTreatmentPlanItemRecord, DentalTreatmentPlanRecord } from "../dental.schema";
import { planItemDecision, toPatientChart, toPatientPlan, toPatientProcedure } from "./dental-patient-access";

const org = "00000000-0000-0000-0000-00000000000a";
const facility = { name: "Makati Dental", timezone: "Asia/Manila" };
// 23:30 UTC on 1 March is 07:30 on 2 March in Manila.
const late = new Date("2026-03-01T23:30:00Z");

const plan: DentalTreatmentPlanRecord = {
  id: "p1",
  organizationId: org,
  facilityId: "f1",
  patientId: "pt1",
  practitionerId: "pr1",
  title: "Restorative plan",
  notes: "Patient anxious; consider sedation",
  status: "accepted",
  decisionNote: "Options and fees explained",
  decidedAt: late,
  decidedBy: "u1",
  decisionChannel: "in_person" as const,
  decidedByPortalAccount: null,
  discontinuedReason: null,
  createdBy: "u1",
  createdAt: late,
  updatedAt: late,
  version: 2,
};

const item = (id: string, status: DentalTreatmentPlanItemRecord["status"], tooth: string | null = "16"): DentalTreatmentPlanItemRecord => ({
  id,
  organizationId: org,
  planId: "p1",
  phase: 1,
  procedureTypeId: "t1",
  tooth,
  surfaces: tooth ? ["M", "O"] : [],
  note: "If symptoms persist",
  status,
  procedureId: null,
  createdBy: "u1",
  createdAt: late,
  updatedAt: late,
  version: 1,
  decisionEstimate: status === "proposed" ? null : 123_456,
  decisionEstimateOn: status === "proposed" ? null : "2026-03-02",
  decisionEstimateHigh: null,
});

const procedure = (status: DentalProcedureRecord["status"]): DentalProcedureRecord => ({
  id: "d1",
  organizationId: org,
  facilityId: "f1",
  patientId: "pt1",
  encounterId: "e1",
  practitionerId: "pr1",
  procedureTypeId: "t1",
  tooth: "16",
  surfaces: ["M", "O"],
  notes: "Shade A2; deep lesion close to the pulp",
  planItemId: "i1",
  status,
  enteredInErrorReason: status === "entered_in_error" ? "Wrong tooth" : null,
  enteredInErrorAt: null,
  enteredInErrorBy: null,
  performedAt: late,
  recordedBy: "u1",
});

describe("dental patient access (what MyHealth shows)", () => {
  it("words the patient's decision per item", () => {
    expect(planItemDecision("proposed")).toBe("awaiting");
    expect(planItemDecision("accepted")).toBe("accepted");
    expect(planItemDecision("completed")).toBe("accepted");
    expect(planItemDecision("declined")).toBe("declined");
    expect(planItemDecision("cancelled")).toBeNull();
  });

  it("shows a plan without notes, decision notes, staff or organization", () => {
    const view = toPatientPlan(plan, [item("i1", "completed"), item("i2", "declined", null)], new Map([["t1", "Composite restoration"]]), facility, "Dr. Cruz");
    expect(view).toEqual({
      id: "p1",
      title: "Restorative plan",
      status: "accepted",
      decidedIn: "clinic",
      canDecide: false,
      proposedOn: "2026-03-02",
      decidedOn: "2026-03-02",
      facilityName: "Makati Dental",
      dentistName: "Dr. Cruz",
      items: [
        { id: "i1", phase: 1, tooth: "16", surfaces: ["M", "O"], procedureName: "Composite restoration", status: "completed", decision: "accepted" },
        { id: "i2", phase: 1, tooth: null, surfaces: [], procedureName: "Composite restoration", status: "declined", decision: "declined" },
      ],
      estimate: null,
    });
    const text = JSON.stringify(view);
    for (const secret of ["anxious", "fees explained", "symptoms persist", org, "u1", "pr1", "t1", "version", "123456"]) expect(text).not.toContain(secret);
  });

  it("estimates the work still ahead at listed prices, only when prices are passed and the plan is open", () => {
    const names = new Map([["t1", "Composite restoration"]]);
    const prices = { pricedOn: "2026-03-02", byType: new Map([["t1", { unitPrice: 150_000 }]]), note: "Estimates hold for 30 days." };
    const items = [
      item("i1", "proposed"),
      item("i2", "accepted"),
      { ...item("i3", "proposed"), procedureTypeId: "t2" },
      item("i4", "completed"),
      item("i5", "declined"),
    ];
    const view = toPatientPlan({ ...plan, status: "in_progress" }, items, names, facility, null, true, prices);
    expect(view.items.map((i) => i.estimatedFee)).toEqual([150_000, 150_000, null, null, null]);
    expect(view.estimate).toMatchObject({
      pricedOn: "2026-03-02",
      awaitingDecision: 150_000,
      accepted: 150_000,
      remaining: 300_000,
      unpricedItems: 1,
      note: "Estimates hold for 30 days.",
    });
    expect(view.estimate?.disclaimer).toMatch(/not an invoice/);

    // A procedure that may turn out to be another one: its fee is a range, and the totals carry both ends.
    const ranged = toPatientPlan({ ...plan, status: "in_progress" }, items, names, facility, null, true, {
      ...prices,
      fees: new Map([["t1", { low: 150_000, high: 400_000, alternatives: [{ name: "Root canal treatment" }] }]]),
    });
    expect(ranged.items[0]).toMatchObject({ estimatedFee: 150_000, estimatedFeeHigh: 400_000, mayBecome: ["Root canal treatment"] });
    expect(view.items[0]).toMatchObject({ estimatedFeeHigh: null });
    expect(view.items[0]).not.toHaveProperty("mayBecome");
    expect(ranged.estimate).toMatchObject({ awaitingDecision: 150_000, awaitingDecisionHigh: 400_000, remaining: 300_000, remainingHigh: 800_000 });

    // Without prices (the organization does not show estimates), on a closed plan, or with nothing ahead: none.
    expect(toPatientPlan(plan, items, names, facility, null, true).estimate).toBeNull();
    expect(toPatientPlan(plan, items, names, facility, null, true).items[0]).not.toHaveProperty("estimatedFee");
    expect(toPatientPlan({ ...plan, status: "discontinued" }, items, names, facility, null, true, prices).estimate).toBeNull();
    expect(toPatientPlan({ ...plan, status: "completed" }, [item("i4", "completed")], names, facility, null, true, prices).estimate).toBeNull();
  });

  it("offers an online decision only when allowed, on an open plan with items awaiting one", () => {
    const names = new Map([["t1", "Composite restoration"]]);
    const awaiting = [item("i1", "proposed")];
    expect(toPatientPlan({ ...plan, status: "proposed", decidedAt: null }, awaiting, names, facility, null, true).canDecide).toBe(true);
    expect(toPatientPlan({ ...plan, status: "proposed", decidedAt: null }, awaiting, names, facility, null, false).canDecide).toBe(false);
    expect(toPatientPlan({ ...plan, status: "discontinued" }, awaiting, names, facility, null, true).canDecide).toBe(false);
    expect(toPatientPlan(plan, [item("i1", "accepted")], names, facility, null, true).canDecide).toBe(false);
    expect(toPatientPlan({ ...plan, decisionChannel: "portal" }, awaiting, names, facility, null).decidedIn).toBe("myhealth");
  });

  it("shows recorded procedures without notes or codes, and never one entered in error", () => {
    const view = toPatientProcedure(procedure("recorded"), "Composite restoration", facility, "Dr. Cruz");
    expect(view).toEqual({
      id: "d1",
      performedOn: "2026-03-02",
      tooth: "16",
      surfaces: ["M", "O"],
      procedureName: "Composite restoration",
      facilityName: "Makati Dental",
      dentistName: "Dr. Cruz",
    });
    expect(JSON.stringify(view)).not.toMatch(/Shade|pulp|e1|u1/);
    expect(toPatientProcedure(procedure("entered_in_error"), "Composite restoration", facility, "Dr. Cruz")).toBeUndefined();
  });

  it("shows the chart's conditions without tooth notes, sources or authors", () => {
    const chart: ChartTooth[] = [
      {
        stateId: "s1",
        tooth: "16",
        findings: [{ condition: "caries", surfaces: ["M", "O"] }],
        note: "Deep lesion, watch the pulp",
        source: { type: "examination", id: "x1" },
        recordedAt: late,
        recordedBy: "u1",
      },
      { stateId: "s2", tooth: "21", findings: [], note: null, source: { type: "procedure", id: "d1" }, recordedAt: late, recordedBy: "u1" },
    ];
    const view = toPatientChart(chart);
    expect(view).toEqual([
      { tooth: "16", conditions: [{ condition: "caries", surfaces: ["M", "O"] }], updatedOn: "2026-03-02" },
      { tooth: "21", conditions: [], updatedOn: "2026-03-02" },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/pulp|x1|u1|examination|procedure/);
  });
});
