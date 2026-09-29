import { outstandingByLine, returnIssues, supplyLineIssues } from "./supplies.rules";

describe("dental supply rules", () => {
  const items = new Map([
    ["lido", { id: "lido", name: "Lidocaine cartridge", status: "active" as const }],
    ["old", { id: "old", name: "Old composite", status: "inactive" as const }],
  ]);

  it("accepts known active items listed once with whole quantities", () => {
    expect(supplyLineIssues([{ itemId: "lido", quantity: 2 }], items, { allowEmpty: false })).toEqual({});
    expect(supplyLineIssues([], items, { allowEmpty: true })).toEqual({});
  });

  it("accepts dental and medical supplies, medicines and PPE, not laboratory items", () => {
    const byCategory = new Map([
      ["bond", { id: "bond", name: "Bonding agent", status: "active" as const, category: "dental_supply" }],
      ["gloves", { id: "gloves", name: "Gloves", status: "active" as const, category: "ppe" }],
      ["glucose", { id: "glucose", name: "Glucose reagent", status: "active" as const, category: "reagent" }],
      ["tube", { id: "tube", name: "Red-top tube", status: "active" as const, category: "laboratory_consumable" }],
    ]);
    const lines = [...byCategory.keys()].map((itemId) => ({ itemId, quantity: 1 }));
    expect(supplyLineIssues(lines, byCategory, { allowEmpty: false })).toEqual({
      glucose: ["Glucose reagent is not a dental supply (reagent)"],
      tube: ["Red-top tube is not a dental supply (laboratory consumable)"],
    });
  });

  it("flags empty lists, duplicates, unknown or inactive items and bad quantities", () => {
    expect(supplyLineIssues([], items, { allowEmpty: false })).toEqual({ _: ["list at least one supply"] });
    expect(
      supplyLineIssues(
        [
          { itemId: "lido", quantity: 1 },
          { itemId: "lido", quantity: 1 },
          { itemId: "old", quantity: 1 },
          { itemId: "nope", quantity: 0 },
        ],
        items,
        { allowEmpty: false },
      ),
    ).toEqual({
      lido: ["listed more than once"],
      old: ["Old composite is inactive"],
      nope: ["unknown inventory item", "quantity must be a whole number of at least 1"],
    });
  });

  it("computes what is still out per issued line", () => {
    const out = outstandingByLine(
      [
        { id: "a", quantity: 3 },
        { id: "b", quantity: 1 },
      ],
      [
        { returnsLineId: "a", quantity: 1 },
        { returnsLineId: "a", quantity: 1 },
        { returnsLineId: "x", quantity: 5 },
      ],
    );
    expect([...out]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("never returns more than is out", () => {
    const out = new Map([
      ["a", 1],
      ["b", 0],
    ]);
    expect(returnIssues([{ lineId: "a", quantity: 1 }], out)).toEqual({});
    expect(returnIssues([], out)).toEqual({ _: ["choose what to return"] });
    expect(
      returnIssues(
        [
          { lineId: "a", quantity: 2 },
          { lineId: "b", quantity: 1 },
          { lineId: "z", quantity: 1 },
        ],
        out,
      ),
    ).toEqual({ a: ["at most 1 can be returned"], b: ["already returned in full"], z: ["not a supply issued to this procedure"] });
  });
});
