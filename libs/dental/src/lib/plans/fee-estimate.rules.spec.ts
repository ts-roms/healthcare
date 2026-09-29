import { toothInNotation } from "../dental.rules";
import { itemFee } from "./dental-fee-lookup";
import { alternativeSiteAllowed, estimatePart, estimateTotals, feeRange, surfaceQuantity } from "./fee-estimate.rules";

describe("fee estimate rules", () => {
  it("covers the work still ahead: items awaiting a decision and accepted items not yet done", () => {
    expect(estimatePart("proposed")).toBe("awaiting");
    expect(estimatePart("accepted")).toBe("accepted");
    expect(estimatePart("completed")).toBeNull();
    expect(estimatePart("declined")).toBeNull();
    expect(estimatePart("cancelled")).toBeNull();
  });

  it("totals listed prices by part and counts items without a listed price", () => {
    expect(
      estimateTotals([
        { status: "proposed", listedPrice: 150_000 },
        { status: "proposed", listedPrice: null },
        { status: "accepted", listedPrice: 80_050 },
        { status: "completed", listedPrice: 99_999 },
        { status: "declined", listedPrice: 50_000 },
        { status: "cancelled", listedPrice: null },
      ]),
    ).toEqual({
      awaitingDecision: 150_000,
      accepted: 80_050,
      remaining: 230_050,
      awaitingDecisionHigh: 150_000,
      acceptedHigh: 80_050,
      remainingHigh: 230_050,
      unpricedItems: 1,
    });
    expect(estimateTotals([])).toMatchObject({ awaitingDecision: 0, accepted: 0, remaining: 0, remainingHigh: 0, unpricedItems: 0 });
  });

  it("adds the high ends of ranges", () => {
    expect(
      estimateTotals([
        { status: "proposed", listedPrice: 80_000, highPrice: 300_000 },
        { status: "accepted", listedPrice: 150_000 },
        { status: "accepted", listedPrice: 50_000, highPrice: 50_000 },
      ]),
    ).toEqual({
      awaitingDecision: 80_000,
      accepted: 200_000,
      remaining: 280_000,
      awaitingDecisionHigh: 300_000,
      acceptedHigh: 200_000,
      remainingHigh: 500_000,
      unpricedItems: 0,
    });
    expect(() => estimateTotals([{ status: "proposed", listedPrice: 80_000, highPrice: 70_000 }])).toThrow(RangeError);
  });

  it("ranges over the planned price and the alternatives' listed prices", () => {
    expect(feeRange(80_000, [300_000, null])).toEqual({ low: 80_000, high: 300_000, unpricedAlternatives: 1 });
    expect(feeRange(80_000, [50_000])).toEqual({ low: 50_000, high: 80_000, unpricedAlternatives: 0 });
    expect(feeRange(80_000, [])).toEqual({ low: 80_000, high: 80_000, unpricedAlternatives: 0 });
    // Without a price for the planned procedure the item is not priced, whatever its alternatives cost.
    expect(feeRange(null, [300_000])).toBeNull();
  });

  it("charges per surface as billing does: the surfaces treated, at least one", () => {
    expect(surfaceQuantity(true, 3)).toBe(3);
    expect(surfaceQuantity(true, 0)).toBe(1);
    expect(surfaceQuantity(false, 3)).toBe(1);
  });

  it("prices an item with its surfaces, and a range with alternatives priced the same way", () => {
    const priced = {
      byType: new Map([
        ["composite", { unitPrice: 50_000, perSurface: true }],
        ["crown", { unitPrice: 900_000, perSurface: false }],
      ]),
      alternatives: new Map([["composite", [{ code: "crown", name: "Crown", fee: { unitPrice: 900_000, perSurface: false } }]]]),
    };
    expect(itemFee({ ...priced, alternatives: new Map() }, "composite", 3)).toMatchObject({ quantity: 3, amount: 150_000, range: null });
    expect(itemFee(priced, "composite", 2)).toMatchObject({
      quantity: 2,
      amount: 100_000,
      range: { low: 100_000, high: 900_000, alternatives: [{ code: "crown", unitPrice: 900_000, amount: 900_000 }] },
    });
    expect(itemFee(priced, "crown", 0)).toMatchObject({ quantity: 1, amount: 900_000, range: null });
    expect(itemFee(priced, "sealant", 1)).toBeNull();
  });

  it("keeps whole-mouth procedures apart from tooth procedures", () => {
    expect(alternativeSiteAllowed("tooth", "surface")).toBe(true);
    expect(alternativeSiteAllowed("surface", "tooth")).toBe(true);
    expect(alternativeSiteAllowed("mouth", "mouth")).toBe(true);
    expect(alternativeSiteAllowed("mouth", "tooth")).toBe(false);
    expect(alternativeSiteAllowed("tooth", "mouth")).toBe(false);
  });

  it("refuses amounts that are not centavos", () => {
    expect(() => estimateTotals([{ status: "proposed", listedPrice: 10.5 }])).toThrow(RangeError);
    expect(() => estimateTotals([{ status: "accepted", listedPrice: -1 }])).toThrow(RangeError);
  });
});

describe("tooth in a notation (printed documents)", () => {
  it("matches the frontends' notation", () => {
    expect(["18", "11", "21", "28", "38", "31", "41", "48"].map((t) => toothInNotation(t, "universal"))).toEqual(["1", "8", "9", "16", "17", "24", "25", "32"]);
    expect(["55", "51", "61", "65", "75", "71", "81", "85"].map((t) => toothInNotation(t, "universal"))).toEqual(["A", "E", "F", "J", "K", "O", "P", "T"]);
    expect(["16", "26", "36", "46", "54"].map((t) => toothInNotation(t, "palmer"))).toEqual(["UR6", "UL6", "LL6", "LR6", "URD"]);
    expect(toothInNotation("16", "fdi")).toBe("16");
  });
});
