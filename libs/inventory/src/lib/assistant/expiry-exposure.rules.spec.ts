import { EXPIRY_EXPOSURE_RULE, expectedWaste, expiryExposureSuggestions } from "./expiry-exposure.rules";

const params = { windowDays: 30, horizonDays: 90, minUnits: 1, minIssues: 5 };
const TODAY = "2026-11-20";

describe("expected waste (earliest expiry first)", () => {
  it("uses lots in expiry order and keeps what is left at each expiry", () => {
    // 2 a day: by 2026-11-29 (10 days) 20 are used, by 2026-12-19 (30 days) 60.
    const waste = expectedWaste(
      [
        { lotId: "b", lotNumber: "B", expiryDate: "2026-12-19", quantity: 50 },
        { lotId: "a", lotNumber: "A", expiryDate: "2026-11-29", quantity: 30 },
      ],
      2,
      TODAY,
    );
    expect(waste.map((l) => [l.lotId, l.waste])).toEqual([
      ["a", 10],
      ["b", 10],
    ]);
  });

  it("expects nothing used without a pace", () => {
    expect(expectedWaste([{ lotId: "a", lotNumber: null, expiryDate: "2026-12-01", quantity: 12 }], 0, TODAY)[0]!.waste).toBe(12);
  });
});

describe("inventory.expiry-exposure", () => {
  const item = {
    itemId: "i1",
    name: "Amoxicillin 500 mg",
    stockUnit: "capsule",
    issued: 60, // 2 a day
    issues: 10,
    lots: [{ lotId: "a", lotNumber: "A", expiryDate: "2026-11-29", quantity: 30 }],
  };

  it("flags a lot that will not be used up before it expires", () => {
    const [s] = expiryExposureSuggestions([item], params, TODAY);
    expect(s).toMatchObject({ ruleId: "inventory.expiry-exposure", severity: "advice", strength: "matched", action: { href: "/inventory?show=expiring" } });
    expect(s!.title).toBe("Amoxicillin 500 mg, lot A: about 10 capsule may expire unused on 2026-11-29");
    expect(s!.id).toBe("inventory.expiry-exposure@1:lot:a");
  });

  it("stays silent when the lot will be used up, or expires beyond the horizon", () => {
    expect(expiryExposureSuggestions([{ ...item, issued: 300 }], params, TODAY)).toEqual([]);
    expect(expiryExposureSuggestions([{ ...item, lots: [{ ...item.lots[0]!, expiryDate: "2027-06-30", quantity: 900 }] }], params, TODAY)).toEqual([]);
  });

  it("warns when a lot that is not moving expires within a month", () => {
    const [s] = expiryExposureSuggestions([{ ...item, issued: 0, issues: 0 }], params, TODAY);
    expect(s).toMatchObject({ severity: "warning", strength: "matched" });
    expect(s!.rationale).toContain("Nothing was issued in the last 30 days");
  });

  it("accepts its default parameters", () => {
    expect(EXPIRY_EXPOSURE_RULE.parametersSchema.safeParse(EXPIRY_EXPOSURE_RULE.defaultParameters).success).toBe(true);
  });
});
