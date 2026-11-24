import {
  CHART_CONSISTENCY_RULE,
  chartConsistencySuggestions,
  type DentalPlanInput,
  type DentalPlanItemInput,
  PLAN_DECISIONS_RULE,
  planChartConflict,
  planDecisionSuggestions,
} from "./dental-plan.rules";

const TZ = "Asia/Manila";

function item(over: Partial<DentalPlanItemInput> = {}): DentalPlanItemInput {
  return {
    itemId: "item-1",
    procedureName: "Composite restoration",
    chartEffect: "restoration",
    tooth: "16",
    status: "accepted",
    createdAt: "2026-10-01T02:00:00.000Z",
    ...over,
  };
}

function input(over: Partial<DentalPlanInput> = {}): DentalPlanInput {
  return {
    patientId: "patient-1",
    notation: "fdi",
    chart: [{ tooth: "16", conditions: ["missing"], recordedAt: "2026-09-15T03:00:00.000Z" }],
    plans: [{ planId: "plan-1", title: "Phase 1", items: [item()] }],
    ...over,
  };
}

describe("dental.chart-consistency", () => {
  it("names why a planned chart effect cannot be carried out on the tooth", () => {
    expect(planChartConflict("restoration", ["missing"])).toBe("missing");
    expect(planChartConflict("missing", ["missing"])).toBe("missing"); // an extraction of a tooth already gone
    expect(planChartConflict("crown", ["pontic"])).toBe("replaced by a bridge pontic");
    expect(planChartConflict("root_canal", ["implant"])).toBe("an implant");
    expect(planChartConflict("restoration", ["impacted"])).toBe("impacted");
    expect(planChartConflict("sealant", ["unerupted"])).toBe("not erupted");
  });

  it("allows what the tooth's condition does not rule out", () => {
    expect(planChartConflict("implant", ["missing"])).toBeNull(); // an implant replaces a missing tooth
    expect(planChartConflict("pontic", ["missing"])).toBeNull(); // so does a bridge
    expect(planChartConflict("crown", ["implant"])).toBeNull(); // a crown on an implant
    expect(planChartConflict("missing", ["impacted"])).toBeNull(); // removing an impacted tooth
    expect(planChartConflict("restoration", ["caries", "watch"])).toBeNull();
    expect(planChartConflict(null, ["missing"])).toBeNull(); // a procedure that does not change the chart
  });

  it("points out a restoration planned on a tooth the chart shows missing, in the facility's notation", () => {
    const [s, ...rest] = chartConsistencySuggestions(input({ notation: "universal" }), TZ);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      id: "dental.chart-consistency@1:item:item-1",
      ruleId: CHART_CONSISTENCY_RULE.id,
      surface: "dental",
      severity: "warning",
      basis: "rule",
      strength: "matched",
      title: "Composite restoration is planned on tooth 3, which the chart shows as missing",
    });
    expect(s!.rationale).toContain("since 2026-09-15");
    expect(s!.rationale).toContain("“Phase 1”");
    expect(s!.evidence).toEqual([
      { label: "Plan “Phase 1”", resourceType: "dental_treatment_plan_item", resourceId: "item-1", value: "Composite restoration, tooth 3 (accepted)" },
      { label: "Tooth 3 on the chart", resourceType: "dental_tooth_state", resourceId: "16", value: "missing since 2026-09-15" },
    ]);
    expect(s!.action).toBeUndefined();
  });

  it("stays silent for teeth not charted, mouth-level items and work the chart allows", () => {
    const plans = [
      {
        planId: "plan-1",
        title: "Phase 1",
        items: [
          item({ itemId: "a", tooth: "26" }), // not on the chart
          item({ itemId: "b", tooth: null, procedureName: "Scaling", chartEffect: null }), // the whole mouth
          item({ itemId: "c", procedureName: "Implant", chartEffect: "implant" }), // on the missing 16: allowed
        ],
      },
    ];
    expect(chartConsistencySuggestions(input({ plans }), TZ)).toEqual([]);
  });

  it("reads each plan and item separately", () => {
    const plans = [
      { planId: "plan-1", title: "Phase 1", items: [item({ itemId: "a" })] },
      { planId: "plan-2", title: "Prosthetics", items: [item({ itemId: "b", tooth: "36", procedureName: "Crown", chartEffect: "crown" })] },
    ];
    const chart = [
      { tooth: "16", conditions: ["missing" as const], recordedAt: "2026-09-15T03:00:00.000Z" },
      { tooth: "36", conditions: ["pontic" as const], recordedAt: "2026-08-01T03:00:00.000Z" },
    ];
    const out = chartConsistencySuggestions(input({ plans, chart }), TZ);
    expect(out.map((s) => s.id)).toEqual(["dental.chart-consistency@1:item:a", "dental.chart-consistency@1:item:b"]);
    expect(out[1]!.title).toBe("Crown is planned on tooth 36, which the chart shows as replaced by a bridge pontic");
  });
});

describe("dental.plan-decisions", () => {
  const params = PLAN_DECISIONS_RULE.defaultParameters;
  const asOf = "2026-11-20T02:00:00.000Z";

  it("reminds of proposed items waiting longer than the days set, oldest first", () => {
    const plans = [
      {
        planId: "plan-1",
        title: "Phase 1",
        items: [
          item({ itemId: "new", status: "proposed", createdAt: "2026-11-15T02:00:00.000Z" }), // 5 days: not yet
          item({ itemId: "old", status: "proposed", tooth: "21", createdAt: "2026-09-21T02:00:00.000Z" }), // 60 days
          item({ itemId: "mid", status: "proposed", tooth: null, procedureName: "Scaling", chartEffect: null, createdAt: "2026-10-11T02:00:00.000Z" }), // 40 days
          item({ itemId: "yes", status: "accepted", createdAt: "2026-08-01T02:00:00.000Z" }), // decided
        ],
      },
    ];
    const [s, ...rest] = planDecisionSuggestions(input({ plans }), params, asOf, TZ);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      id: "dental.plan-decisions@1:plan:plan-1",
      ruleId: PLAN_DECISIONS_RULE.id,
      surface: "dental",
      severity: "advice",
      title: "“Phase 1”: 2 items waiting for the patient's decision for 60 days",
    });
    expect(s!.evidence).toEqual([
      { label: "Composite restoration, tooth 21", resourceType: "dental_treatment_plan_item", resourceId: "old", value: "proposed 2026-09-21" },
      { label: "Scaling", resourceType: "dental_treatment_plan_item", resourceId: "mid", value: "proposed 2026-10-11" },
    ]);
  });

  it("says one item in the singular and follows the days set", () => {
    const plans = [{ planId: "plan-1", title: "Phase 1", items: [item({ status: "proposed", createdAt: "2026-11-10T02:00:00.000Z" })] }];
    expect(planDecisionSuggestions(input({ plans }), params, asOf, TZ)).toEqual([]); // 10 days < 30
    const [s] = planDecisionSuggestions(input({ plans }), { afterDays: 7 }, asOf, TZ);
    expect(s!.title).toBe("“Phase 1”: 1 item waiting for the patient's decision for 10 days");
  });

  it("is silent when every item is decided", () => {
    expect(planDecisionSuggestions(input(), params, asOf, TZ)).toEqual([]);
  });
});
