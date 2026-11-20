import {
  COURSE_EXPIRY_RULE,
  type CourseExpiryInput,
  courseExpirySuggestions,
  type DispensingItem,
  firstLot,
  type PendingItem,
  SHORT_STOCK_RULE,
  shortStockSuggestions,
  type StockedItem,
  stockCandidates,
  stockMatches,
  strengthKey,
  type UsableLot,
} from "./pharmacy.rules";

const TZ = "Asia/Manila";

const lot = (over: Partial<UsableLot> = {}): UsableLot => ({
  locationId: "loc-main",
  locationName: "Main pharmacy",
  itemId: "amox-500",
  itemName: "Amoxicillin 500 mg capsule",
  stockUnit: "capsule",
  lotNumber: "A1",
  expiryDate: "2027-06-30",
  quantity: 10,
  ...over,
});

describe("matching stock to a prescribed medicine", () => {
  it("reads strengths as written", () => {
    expect(strengthKey("500 mg")).toBe("500mg");
    expect(strengthKey("Amoxicillin 500mg capsule")).toBe("500mg");
    expect(strengthKey("250 mg / 5 mL")).toBe("250mg/5ml");
    expect(strengthKey("1,000 mg")).toBe("1000mg");
    expect(strengthKey("0.5 mg")).toBe("0.5mg");
    expect(strengthKey("100 units/mL")).toBe("100unit/ml");
    expect(strengthKey("tablet")).toBeNull();
    expect(strengthKey(null)).toBeNull();
  });

  it("matches the same medicine and strength, with or without a salt", () => {
    expect(stockMatches("Amoxicillin 500 mg capsule", { genericName: "Amoxicillin", strength: "500 mg" })).toBe(true);
    expect(stockMatches("Amoxicillin trihydrate 500 mg capsule", { genericName: "Amoxicillin", strength: "500mg" })).toBe(true);
    expect(stockMatches("Losartan potassium 50 mg tablet", { genericName: "Losartan", strength: "50 mg" })).toBe(true);
    expect(stockMatches("Metformin 500 mg tablet", { genericName: "Metformin HCl", strength: "500 mg" })).toBe(true);
    // No strength in the stock name: the name decides.
    expect(stockMatches("Paracetamol syrup", { genericName: "Paracetamol", strength: "250 mg/5 mL" })).toBe(true);
  });

  it("never matches another strength, another salt, a combination or another medicine", () => {
    expect(stockMatches("Amoxicillin 250 mg capsule", { genericName: "Amoxicillin", strength: "500 mg" })).toBe(false);
    expect(stockMatches("Metoprolol succinate 50 mg tablet", { genericName: "Metoprolol tartrate", strength: "50 mg" })).toBe(false);
    expect(stockMatches("Amoxicillin + Clavulanic acid 625 mg tablet", { genericName: "Amoxicillin", strength: null })).toBe(false);
    expect(stockMatches("Sodium chloride 0.9% solution", { genericName: "Potassium chloride", strength: null })).toBe(false);
    expect(stockMatches("Potassium chloride 600 mg tablet", { genericName: "Potassium chloride", strength: null })).toBe(true);
  });
});

describe("dispensing.short-stock", () => {
  const params = SHORT_STOCK_RULE.defaultParameters;
  const pending = (over: Partial<PendingItem> = {}): PendingItem => ({
    prescriptionId: "rx-1",
    prescriptionNumber: "RX00000001",
    issuedAt: "2026-11-20T02:00:00.000Z",
    genericName: "Amoxicillin",
    strength: "500 mg",
    quantityUnit: "capsules",
    remaining: 21,
    ...over,
  });
  const stocked: StockedItem[] = [
    { itemId: "amox-500", itemName: "Amoxicillin 500 mg capsule", stockUnit: "capsule" },
    { itemId: "amox-250", itemName: "Amoxicillin 250 mg capsule", stockUnit: "capsule" },
  ];

  it("adds up what waiting prescriptions need against the usable stock of the items named like it", () => {
    const input = {
      pending: [pending(), pending({ prescriptionId: "rx-2", prescriptionNumber: "RX00000002", remaining: 30 })],
      stocked,
      lots: [
        lot({ lotNumber: "A1", quantity: 10 }),
        lot({ lotNumber: "A2", quantity: 10 }),
        lot({ locationId: "loc-store", locationName: "Store room", quantity: 5 }),
        lot({ itemId: "amox-250", itemName: "Amoxicillin 250 mg capsule", quantity: 100 }),
      ],
    };
    const [s, ...rest] = shortStockSuggestions(input, params, TZ);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      ruleId: SHORT_STOCK_RULE.id,
      surface: "pharmacy",
      severity: "advice",
      title: "Amoxicillin 500 mg: 51 capsules left to dispense on 2 prescriptions, 25 in stock",
      action: { href: "/inventory" },
    });
    expect(s!.id).toBe("dispensing.short-stock@1:medicine:amoxicillin:500mg:capsule");
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Amoxicillin 500 mg capsule at Main pharmacy", "20 capsule"],
      ["Amoxicillin 500 mg capsule at Store room", "5 capsule"],
      ["RX00000001", "21 capsules left, issued 2026-11-20"],
      ["RX00000002", "30 capsules left, issued 2026-11-20"],
    ]);
  });

  it("warns when an item stocked here has nothing usable left", () => {
    const [s] = shortStockSuggestions({ pending: [pending()], stocked, lots: [] }, params, TZ);
    expect(s).toMatchObject({ severity: "warning", title: "Amoxicillin 500 mg: 21 capsules left to dispense on 1 prescription, 0 in stock" });
    expect(s!.evidence[0]).toMatchObject({ label: "Amoxicillin 500 mg capsule", value: "none usable here" });
  });

  it("stays silent with enough stock, for medicines not stocked here, and when units differ", () => {
    expect(shortStockSuggestions({ pending: [pending({ remaining: 15 })], stocked, lots: [lot({ quantity: 20 })] }, params, TZ)).toEqual([]);
    expect(shortStockSuggestions({ pending: [pending({ genericName: "Cefalexin" })], stocked, lots: [] }, params, TZ)).toEqual([]);
    const boxes: StockedItem[] = [{ itemId: "amox-box", itemName: "Amoxicillin 500 mg capsule", stockUnit: "box" }];
    expect(shortStockSuggestions({ pending: [pending()], stocked: boxes, lots: [] }, params, TZ)).toEqual([]);
  });
});

describe("dispensing.course-expiry", () => {
  const params = COURSE_EXPIRY_RULE.defaultParameters;
  const item = (over: Partial<DispensingItem> = {}): DispensingItem => ({
    prescriptionItemId: "item-1",
    genericName: "Amoxicillin",
    strength: "500 mg",
    durationValue: 7,
    durationUnit: "days",
    remaining: 21,
    ...over,
  });
  const input = (lots: UsableLot[], over: Partial<CourseExpiryInput> = {}): CourseExpiryInput => {
    const items = over.items ?? [item()];
    return { prescriptionId: "rx-1", prescriptionNumber: "RX00000001", day: "2026-11-21", items, candidates: stockCandidates(items, lots), ...over };
  };

  it("takes the earliest expiry first, lots without one last", () => {
    expect(
      firstLot([
        lot({ lotNumber: "N", expiryDate: null }),
        lot({ lotNumber: "B", expiryDate: "2027-01-01" }),
        lot({ lotNumber: "A", expiryDate: "2026-12-01" }),
      ])?.lotNumber,
    ).toBe("A");
    expect(firstLot([lot({ lotNumber: "N", expiryDate: null }), lot({ lotNumber: "E", expiryDate: "2026-12-01", quantity: 0 })])?.lotNumber).toBe("N");
  });

  it("advises another place when the lot taken first at one expires before the course ends", () => {
    const [s, ...rest] = courseExpirySuggestions(
      input([
        lot({ lotNumber: "L1", expiryDate: "2026-11-25" }),
        lot({ lotNumber: "L2", expiryDate: "2027-01-01" }),
        lot({ locationId: "loc-store", locationName: "Store room", lotNumber: "L3", expiryDate: "2027-03-01" }),
      ]),
      params,
    );
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      id: "dispensing.course-expiry@1:prescription:rx-1:item:item-1",
      surface: "pharmacy",
      severity: "advice",
      title: "Amoxicillin 500 mg: the lot taken first at Main pharmacy expires 2026-11-25, before this 7-day course ends (2026-11-27)",
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Amoxicillin 500 mg capsule at Main pharmacy", "first lot L1 expires 2026-11-25"],
      ["Amoxicillin 500 mg capsule at Store room", "first lot L3 expires 2027-03-01 (lasts the course)"],
    ]);
    expect(s!.action).toBeUndefined();
  });

  it("warns when no stock here lasts the course, counting weeks and months", () => {
    const [s] = courseExpirySuggestions(input([lot({ expiryDate: "2026-12-01" })], { items: [item({ durationValue: 2, durationUnit: "weeks" })] }), params);
    expect(s).toMatchObject({ severity: "warning" });
    expect(s!.title).toContain("before this 14-day course ends (2026-12-04)");
    const [month] = courseExpirySuggestions(
      input([lot({ expiryDate: "2026-12-01" })], { items: [item({ durationValue: 1, durationUnit: "months" })] }),
      params,
    );
    expect(month!.title).toContain("this 30-day course ends (2026-12-20)");
  });

  it("allows stock usable through the course's last day, unless a margin is set", () => {
    expect(courseExpirySuggestions(input([lot({ expiryDate: "2026-11-27" })]), params)).toEqual([]);
    expect(courseExpirySuggestions(input([lot({ expiryDate: "2026-11-27" })]), { marginDays: 30 })).toHaveLength(1);
  });

  it("skips items with nothing left, no duration, no matching stock or no expiry", () => {
    const short = [lot({ expiryDate: "2026-11-22" })];
    expect(courseExpirySuggestions(input(short, { items: [item({ remaining: 0 })] }), params)).toEqual([]);
    expect(courseExpirySuggestions(input(short, { items: [item({ durationValue: null, durationUnit: null })] }), params)).toEqual([]);
    expect(courseExpirySuggestions(input(short, { items: [item({ genericName: "Cefalexin" })] }), params)).toEqual([]);
    expect(courseExpirySuggestions(input([lot({ expiryDate: null })]), params)).toEqual([]);
    // Unknown remaining (dispensed in another unit) is still checked.
    expect(courseExpirySuggestions(input(short, { items: [item({ remaining: null })] }), params)).toHaveLength(1);
  });
});
