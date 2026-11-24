import { UNCHARGED_WORK_RULE, unchargedReason, unchargedWorkSuggestions, type UnchargedWorkInput } from "./uncharged-work.rules";

const params = { delayHours: 2, lookbackDays: 14 };
const item = (over: Partial<UnchargedWorkInput> = {}): UnchargedWorkInput => ({
  kind: "clinic_procedure",
  sourceId: "p1",
  code: "wound-dressing",
  name: "Wound dressing",
  serviceDate: "2026-11-18",
  charged: false,
  mapped: true,
  priced: true,
  ...over,
});

describe("billing.uncharged-work", () => {
  it("names the likely reason", () => {
    expect(unchargedReason({ mapped: false, priced: false })).toBe("no_service");
    expect(unchargedReason({ mapped: true, priced: false })).toBe("no_price");
    expect(unchargedReason({ mapped: true, priced: true })).toBe("not_captured");
  });

  it("groups uncharged work by code and reason, with counts and dates only", () => {
    const suggestions = unchargedWorkSuggestions(
      [
        item(),
        item({ sourceId: "p2", serviceDate: "2026-11-15" }),
        item({ sourceId: "p3", charged: true }),
        item({ sourceId: "d1", kind: "dental_procedure", code: "d-ext", name: "Extraction", mapped: false, priced: false }),
      ],
      params,
    );
    expect(suggestions.map((s) => [s.title, s.severity])).toEqual([
      ["2 × Wound dressing (wound-dressing) not charged", "warning"],
      ["1 × Extraction (d-ext) not charged", "advice"],
    ]);
    expect(suggestions[0]!.evidence[1]!.value).toBe("2 (2026-11-15 to 2026-11-18)");
    expect(suggestions[0]!.id).toBe("billing.uncharged-work@1:clinic_procedure:wound-dressing:not_captured");
    expect(suggestions[1]!.action).toEqual({ label: "Open services and prices", href: "/billing/settings" });
  });

  it("says nothing when everything was charged", () => {
    expect(unchargedWorkSuggestions([item({ charged: true })], params)).toEqual([]);
  });

  it("accepts its default parameters", () => {
    expect(UNCHARGED_WORK_RULE.parametersSchema.safeParse(UNCHARGED_WORK_RULE.defaultParameters).success).toBe(true);
  });
});
