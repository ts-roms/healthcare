import { toothInNotation } from "../dental.rules";
import { estimatePart, estimateTotals } from "./fee-estimate.rules";

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
    ).toEqual({ awaitingDecision: 150_000, accepted: 80_050, remaining: 230_050, unpricedItems: 1 });
    expect(estimateTotals([])).toEqual({ awaitingDecision: 0, accepted: 0, remaining: 0, unpricedItems: 0 });
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
