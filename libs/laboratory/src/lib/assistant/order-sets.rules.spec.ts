import { ORDER_SETS_RULE, orderSetReason, orderSetSuggestions, type OrderSetCandidate, type OrderSetContext } from "./order-sets.rules";

const params = { maxSets: 3 };
const diabetes: OrderSetCandidate = {
  id: "s1",
  name: "Diabetes follow-up",
  note: "Every three months.",
  items: [
    { name: "HbA1c", testIds: ["hba1c"] },
    { name: "Renal panel", testIds: ["crea", "bun"] },
  ],
  triggers: [
    { kind: "diagnosis_code", value: "E11", codeSystemKey: "icd-10" },
    { kind: "visit_type", value: "dm-clinic", codeSystemKey: null },
  ],
};
const ctx = (over: Partial<OrderSetContext> = {}): OrderSetContext => ({
  encounterId: "e1",
  visitTypeCode: "consult",
  diagnoses: [{ codeSystemKey: "icd-10", code: "e11.9" }],
  orderedTestIds: [],
  ...over,
});

describe("laboratory.order-sets", () => {
  it("matches a diagnosis code prefix in the set's coding system, without regard to case", () => {
    expect(orderSetReason(diabetes, ctx())).toBe("the diagnosis e11.9");
    expect(orderSetReason(diabetes, ctx({ diagnoses: [{ codeSystemKey: "local", code: "E11.9" }] }))).toBeNull();
    expect(
      orderSetReason(
        { ...diabetes, triggers: [{ kind: "diagnosis_code", value: "E11", codeSystemKey: null }] },
        ctx({ diagnoses: [{ codeSystemKey: "local", code: "E11.9" }] }),
      ),
    ).toBe("the diagnosis E11.9");
  });

  it("matches the visit type", () => {
    expect(orderSetReason(diabetes, ctx({ diagnoses: [], visitTypeCode: "DM-Clinic" }))).toBe("this visit type");
    expect(orderSetReason(diabetes, ctx({ diagnoses: [], visitTypeCode: null }))).toBeNull();
  });

  it("offers a matching set with a link that opens the order form, never ordering anything", () => {
    const [s] = orderSetSuggestions([diabetes], ctx(), params);
    expect(s).toMatchObject({
      ruleId: "laboratory.order-sets",
      severity: "info",
      title: "Order set for the diagnosis e11.9: Diabetes follow-up",
      action: { href: "/clinic/encounters/e1?orderSet=s1#lab-orders" },
    });
    expect(s!.rationale).toContain("Every three months. Your organization offers this set");
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["HbA1c", "to order"],
      ["Renal panel", "to order"],
    ]);
  });

  it("marks what was already ordered, and stays silent once everything was", () => {
    const [s] = orderSetSuggestions([diabetes], ctx({ orderedTestIds: ["hba1c"] }), params);
    expect(s!.evidence[0]!.value).toBe("already ordered in this consultation");
    expect(orderSetSuggestions([diabetes], ctx({ orderedTestIds: ["hba1c", "crea", "bun"] }), params)).toEqual([]);
  });

  it("offers at most the configured number, and nothing without a consultation", () => {
    const many = [1, 2, 3, 4].map((n) => ({ ...diabetes, id: `s${n}`, name: `Set ${n}` }));
    expect(orderSetSuggestions(many, ctx(), { maxSets: 2 })).toHaveLength(2);
    expect(orderSetSuggestions(many, null, params)).toEqual([]);
  });

  it("accepts its default parameters", () => {
    expect(ORDER_SETS_RULE.parametersSchema.safeParse(ORDER_SETS_RULE.defaultParameters).success).toBe(true);
  });
});
