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
      proposedOn: "2026-03-02",
      decidedOn: "2026-03-02",
      facilityName: "Makati Dental",
      dentistName: "Dr. Cruz",
      items: [
        { id: "i1", phase: 1, tooth: "16", surfaces: ["M", "O"], procedureName: "Composite restoration", status: "completed", decision: "accepted" },
        { id: "i2", phase: 1, tooth: null, surfaces: [], procedureName: "Composite restoration", status: "declined", decision: "declined" },
      ],
    });
    const text = JSON.stringify(view);
    for (const secret of ["anxious", "fees explained", "symptoms persist", org, "u1", "pr1", "t1", "version"]) expect(text).not.toContain(secret);
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
