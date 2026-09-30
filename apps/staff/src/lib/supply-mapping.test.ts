import { describe, expect, it } from "vitest";
import { draftFromTemplate, supplyRequestLines } from "./supply-mapping";

describe("supply drafts", () => {
  it("starts from the template, leaving out items no longer active", () => {
    expect(
      draftFromTemplate(
        ["a", "b"],
        [
          { itemId: "a", quantity: 2 },
          { itemId: "gone", quantity: 1 },
        ],
      ),
    ).toEqual([{ itemId: "a", quantity: 2, reason: "", reference: "" }]);
    expect(draftFromTemplate(["a"], undefined)).toEqual([]);
  });

  it("sends reason and reference only when given", () => {
    expect(supplyRequestLines([{ itemId: "a", quantity: 1, reason: " ", reference: "R-1" }])).toEqual([{ itemId: "a", quantity: 1, reference: "R-1" }]);
  });
});
