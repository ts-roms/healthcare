import { describe, expect, it } from "vitest";
import type { DentalSupplyUse, DentalVisit } from "./api/types";
import {
  changedTeeth,
  draftProblems,
  examinationTeeth,
  openVisit,
  procedureSupplies,
  supplyDraft,
  supplyErrors,
  supplyLineState,
  supplyRequestLines,
  toChart,
} from "./dental-mapping";

describe("dental mapping", () => {
  const current = toChart([
    { tooth: "16", findings: [{ condition: "caries", surfaces: ["M", "O"] }], note: null },
    { tooth: "21", findings: [], note: null },
  ]);

  it("finds the teeth changed in a draft", () => {
    const draft = {
      ...current,
      // Same findings in another order: unchanged.
      "16": { tooth: "16", findings: [{ condition: "caries" as const, surfaces: ["O" as const, "M" as const] }], note: "" },
      "21": { tooth: "21", findings: [{ condition: "fracture" as const, surfaces: [] }] },
      "36": { tooth: "36", findings: [] },
    };
    expect([...changedTeeth(current, draft)].sort()).toEqual(["21", "36"]);
  });

  it("builds the examination's charted teeth and flags missing surfaces", () => {
    const draft = {
      ...current,
      "36": { tooth: "36", findings: [{ condition: "restoration" as const, surfaces: ["O" as const, "M" as const] }], note: " Old amalgam " },
      "46": { tooth: "46", findings: [{ condition: "caries" as const, surfaces: [] }] },
    };
    expect(examinationTeeth(draft, ["46", "36"])).toEqual([
      { tooth: "36", findings: [{ condition: "restoration", surfaces: ["M", "O"] }], note: "Old amalgam" },
      { tooth: "46", findings: [{ condition: "caries", surfaces: [] }] },
    ]);
    expect(draftProblems(draft, ["36", "46"])).toEqual(["Tooth 46: choose the caries surfaces."]);
  });

  it("picks the patient's dental visit in progress", () => {
    const visit = (patientId: string, status: DentalVisit["status"]) => ({ patientId, status, encounterId: `${patientId}-${status}` }) as DentalVisit;
    expect(openVisit([visit("a", "completed"), visit("a", "in_progress"), visit("b", "in_progress")], "a")?.encounterId).toBe("a-in_progress");
    expect(openVisit([visit("a", "completed")], "a")).toBeUndefined();
  });

  it("prefills supplies from the procedure's template, leaving out inactive items", () => {
    const options = {
      templates: [
        {
          procedureTypeId: "p",
          items: [
            { itemId: "lido", quantity: 1 },
            { itemId: "gone", quantity: 2 },
          ],
        },
      ],
      items: [{ id: "lido" }] as never,
    };
    expect(supplyDraft(options, "p")).toEqual([{ itemId: "lido", quantity: 1, reason: "", reference: "" }]);
    expect(supplyDraft(options, "other")).toEqual([]);
    expect(supplyRequestLines([{ itemId: "m", quantity: 1, reason: " Sedation ", reference: "" }])).toEqual([{ itemId: "m", quantity: 1, reason: "Sedation" }]);
  });

  it("lists a procedure's supply uses and what can still be returned", () => {
    const line = (id: string, quantity: number, outstanding: number | null) => ({ id, quantity, outstanding }) as DentalSupplyUse["lines"][number];
    const uses = [
      { id: "r", procedureId: "p", kind: "return", locationId: "loc", recordedAt: "2026-09-02T00:00:00Z", lines: [line("x", 1, null)] },
      { id: "i", procedureId: "p", kind: "issue", locationId: "loc", recordedAt: "2026-09-01T00:00:00Z", lines: [line("a", 2, 1), line("b", 1, 0)] },
      { id: "o", procedureId: "q", kind: "issue", locationId: "loc", recordedAt: "2026-09-01T00:00:00Z", lines: [line("c", 1, 1)] },
    ] as DentalSupplyUse[];
    const { uses: mine, returnable } = procedureSupplies(uses, "p");
    expect(mine.map((u) => u.id)).toEqual(["i", "r"]);
    expect(returnable.map((l) => [l.id, l.useId])).toEqual([["a", "i"]]);
    expect(supplyLineState({ quantity: 2, outstanding: 2 }).label).toBe("Used");
    expect(supplyLineState({ quantity: 2, outstanding: 1 }).label).toBe("1 returned");
    expect(supplyLineState({ quantity: 2, outstanding: 0 }).kind).toBe("returned");
  });

  it("places API refusals next to the supply they concern", () => {
    expect(supplyErrors("insufficient_stock", "Not enough", { itemId: "a", available: 1 })).toEqual({ a: "Not enough" });
    expect(supplyErrors("invalid_supplies", "Invalid", { a: ["listed more than once"], _: ["x"] })).toEqual({ a: "listed more than once", _: "x" });
    expect(supplyErrors("location_inactive", "Inactive", undefined)).toEqual({});
  });
});
