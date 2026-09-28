import { describe, expect, it } from "vitest";
import type { PortalDentalTooth, PortalToothCondition, PortalToothSurface } from "./api/types";
import { chartRows, conditionsText, planItemState, surfacesText, toothText, toothTone } from "./dental";

const tooth = (t: string, conditions: Array<[PortalToothCondition, PortalToothSurface[]]>): PortalDentalTooth => ({
  tooth: t,
  conditions: conditions.map(([condition, surfaces]) => ({ condition, surfaces })),
  updatedOn: "2026-09-28",
});

describe("dental wording", () => {
  it("reads a tooth at a glance", () => {
    expect(toothTone(tooth("16", []))).toBe("healthy");
    expect(toothTone(tooth("16", [["restoration", ["M", "O"]]]))).toBe("treated");
    expect(
      toothTone(
        tooth("16", [
          ["restoration", ["M"]],
          ["caries", ["O"]],
        ]),
      ),
    ).toBe("attention");
    expect(toothTone(tooth("48", [["impacted", []]]))).toBe("watch");
    expect(toothTone(tooth("36", [["missing", []]]))).toBe("missing");
  });

  it("names teeth and sides in plain words, in the clinic's notation", () => {
    expect(toothText("16", "fdi")).toBe("16 · upper right first molar");
    expect(toothText("16", "universal")).toBe("3 · upper right first molar");
    expect(surfacesText("16", ["M", "O"])).toBe("mesial and occlusal sides");
    expect(surfacesText("11", ["B"])).toBe("labial side");
    expect(surfacesText("16", [])).toBeNull();
    expect(conditionsText(tooth("16", [["restoration", ["M", "O"]]]))).toBe("Filling (mesial and occlusal sides)");
    expect(conditionsText(tooth("21", []))).toBe("No problems noted");
  });

  it("words the patient's decision per plan item", () => {
    expect(planItemState("proposed")).toEqual({ tone: "awaiting", text: "Waiting for your decision" });
    expect(planItemState("completed").text).toBe("Done");
    expect(planItemState("cancelled").text).toBe("No longer planned");
  });

  it("draws baby teeth only when some were charted", () => {
    expect(chartRows([tooth("16", [])]).map((r) => r.label)).toEqual(["Upper teeth", "Lower teeth"]);
    expect(chartRows([tooth("55", [])]).map((r) => r.label)).toEqual(["Upper teeth", "Upper baby teeth", "Lower teeth", "Lower baby teeth"]);
    expect(chartRows([]).every((r) => r.teeth.length === 16)).toBe(true);
  });
});
