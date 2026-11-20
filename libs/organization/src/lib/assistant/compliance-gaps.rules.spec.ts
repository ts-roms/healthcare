import { COMPLIANCE_GAPS_RULE, complianceGapsSuggestions, type ComplianceAreaState } from "./compliance-gaps.rules";

const params = { maxMonths: 12 };
const TODAY = "2026-11-20";
const reviewed = (area: ComplianceAreaState["area"], reviewedOn: string, outcome: "validated" | "changes_needed" = "validated"): ComplianceAreaState => ({
  area,
  last: { reviewedOn, outcome },
});

describe("admin.compliance-gaps", () => {
  it("says nothing when every area was validated recently", () => {
    expect(complianceGapsSuggestions([reviewed("billing_tax", "2026-06-01"), reviewed("data_privacy", "2026-01-10")], params, TODAY)).toEqual([]);
  });

  it("groups areas never reviewed, old and needing changes into one suggestion", () => {
    const [s] = complianceGapsSuggestions(
      [
        { area: "doh_reporting", last: null },
        reviewed("billing_tax", "2025-10-01"),
        reviewed("data_privacy", "2026-09-01", "changes_needed"),
        reviewed("procurement", "2026-06-01"),
      ],
      params,
      TODAY,
    );
    expect(s).toMatchObject({ ruleId: "admin.compliance-gaps", severity: "warning", action: { href: "/admin/compliance" } });
    expect(s!.title).toBe("3 compliance areas to review: 1 found changes needed, 1 never reviewed, 1 last reviewed over 12 months ago");
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Data privacy", "changes needed (2026-09-01)"],
      ["DOH reporting", "never reviewed"],
      ["Billing tax and documents", "last reviewed 2025-10-01"],
    ]);
  });

  it("counts a review as old only once the interval has fully passed", () => {
    expect(complianceGapsSuggestions([reviewed("billing_tax", "2025-11-21")], params, TODAY)).toEqual([]);
    expect(complianceGapsSuggestions([reviewed("billing_tax", "2025-11-20")], params, TODAY)).toHaveLength(1);
  });

  it("changes its id when the gaps change, so a dismissal does not hide new ones", () => {
    const one = complianceGapsSuggestions([{ area: "doh_reporting", last: null }], params, TODAY)[0]!;
    const two = complianceGapsSuggestions(
      [
        { area: "doh_reporting", last: null },
        { area: "data_privacy", last: null },
      ],
      params,
      TODAY,
    )[0]!;
    expect(one.id).not.toBe(two.id);
    expect(one.id).toMatch(/^admin\.compliance-gaps@1:areas:[0-9a-f]{8}$/);
    expect(one.severity).toBe("advice");
  });

  it("accepts its default parameters", () => {
    expect(COMPLIANCE_GAPS_RULE.parametersSchema.safeParse(COMPLIANCE_GAPS_RULE.defaultParameters).success).toBe(true);
  });
});
