import { MONITORING_GAP_RULE, type MonitoringInput, monitoringGapSuggestions } from "./monitoring-gap.rules";
import type { OrderSetCandidate } from "./order-sets.rules";

const params = MONITORING_GAP_RULE.defaultParameters; // 12 months, 90 days

const diabetes: OrderSetCandidate = {
  id: "set-dm",
  name: "Diabetes follow-up",
  note: null,
  items: [
    { name: "HbA1c", testIds: ["t-hba1c"] },
    { name: "Lipid profile", testIds: ["t-chol", "t-tg"] },
  ],
  triggers: [{ kind: "diagnosis_code", value: "E11", codeSystemKey: "icd10" }],
};

function input(over: Partial<MonitoringInput> = {}): MonitoringInput {
  return {
    encounterId: "enc-1",
    asOf: "2026-11-20T02:00:00.000Z",
    timeZone: "Asia/Manila",
    problems: [{ codeSystemKey: "icd10", code: "E11.9", firstRecordedAt: "2025-03-10T01:00:00.000Z" }],
    sets: [diabetes],
    lastReleased: [],
    orderedTestIds: [],
    ...over,
  };
}

describe("laboratory.monitoring-gap", () => {
  it("points out a set's tests with no released result for a chronic diagnosis", () => {
    const [s, ...rest] = monitoringGapSuggestions(input({ lastReleased: [{ testId: "t-chol", releasedAt: "2025-06-01T03:00:00.000Z" }] }), params);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      id: "laboratory.monitoring-gap@1:encounter:enc-1:set:set-dm",
      ruleId: MONITORING_GAP_RULE.id,
      surface: "encounter",
      severity: "advice",
      basis: "rule",
      strength: "matched",
      title: "Diabetes follow-up: HbA1c and Lipid profile not released in 12 months (E11.9)",
      action: { label: "Open in the lab order form", href: "/clinic/encounters/enc-1?orderSet=set-dm#lab-orders" },
    });
    expect(s!.rationale).toContain("since 2025-03-10");
    expect(s!.evidence).toEqual([
      { label: "HbA1c", resourceType: "lab_order_set", resourceId: "set-dm", value: "no released result here" },
      { label: "Lipid profile", resourceType: "lab_order_set", resourceId: "set-dm", value: "last released 2025-06-01" },
    ]);
  });

  it("leaves out tests released within the months set and tests already ordered in this consultation", () => {
    const out = monitoringGapSuggestions(
      input({
        // One of the lipid profile's tests released three months ago counts for the item.
        lastReleased: [{ testId: "t-tg", releasedAt: "2026-08-20T03:00:00.000Z" }],
        orderedTestIds: [],
      }),
      params,
    );
    expect(out[0]!.title).toBe("Diabetes follow-up: HbA1c not released in 12 months (E11.9)");
    expect(
      monitoringGapSuggestions(input({ lastReleased: [{ testId: "t-tg", releasedAt: "2026-08-20T03:00:00.000Z" }], orderedTestIds: ["t-hba1c"] }), params),
    ).toEqual([]);
  });

  it("waits until the diagnosis has been on the record for the days set", () => {
    const recent = input({ problems: [{ codeSystemKey: "icd10", code: "E11.9", firstRecordedAt: "2026-10-01T01:00:00.000Z" }] });
    expect(monitoringGapSuggestions(recent, params)).toEqual([]); // 50 days < 90
    expect(monitoringGapSuggestions(recent, { ...params, establishedDays: 30 })).toHaveLength(1);
  });

  it("matches the set's coding system and code prefix, and reads only diagnosis triggers", () => {
    expect(
      monitoringGapSuggestions(input({ problems: [{ codeSystemKey: "local", code: "E11.9", firstRecordedAt: "2025-01-01T00:00:00.000Z" }] }), params),
    ).toEqual([]);
    expect(
      monitoringGapSuggestions(input({ problems: [{ codeSystemKey: "icd10", code: "I10", firstRecordedAt: "2025-01-01T00:00:00.000Z" }] }), params),
    ).toEqual([]);
    const byVisitType: OrderSetCandidate = { ...diabetes, id: "set-visit", triggers: [{ kind: "visit_type", value: "annual", codeSystemKey: null }] };
    expect(monitoringGapSuggestions(input({ sets: [byVisitType] }), params)).toEqual([]);
  });

  it("counts many due tests instead of naming them", () => {
    const panel: OrderSetCandidate = {
      ...diabetes,
      items: [
        { name: "HbA1c", testIds: ["t-hba1c"] },
        { name: "Creatinine", testIds: ["t-crea"] },
        { name: "Urine albumin", testIds: ["t-alb"] },
      ],
    };
    const [s] = monitoringGapSuggestions(input({ sets: [panel] }), params);
    expect(s!.title).toBe("Diabetes follow-up: 3 of its tests not released in 12 months (E11.9)");
    expect(s!.evidence).toHaveLength(3);
  });
});
