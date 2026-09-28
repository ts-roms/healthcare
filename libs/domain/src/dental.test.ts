import { describe, expect, it } from "vitest";
import { findingsCode, findingsText, perioHasFurcation, perioSiteName, perioTeeth, surfaceName, toothLabel, toothName, toothSurfaces } from "./dental";

describe("dental display helpers", () => {
  it("renders teeth in FDI, Universal and Palmer notation", () => {
    const universal = ["18", "11", "21", "28", "38", "31", "41", "48"].map((t) => toothLabel(t, "universal"));
    expect(universal).toEqual(["1", "8", "9", "16", "17", "24", "25", "32"]);
    const primary = ["55", "51", "61", "65", "75", "71", "81", "85"].map((t) => toothLabel(t, "universal"));
    expect(primary).toEqual(["A", "E", "F", "J", "K", "O", "P", "T"]);
    expect(["16", "26", "36", "46", "54"].map((t) => toothLabel(t, "palmer"))).toEqual(["UR6", "UL6", "LL6", "LR6", "URD"]);
    expect(toothLabel("16")).toBe("16");
  });

  it("names teeth and surfaces", () => {
    expect(toothName("16")).toBe("upper right first molar");
    expect(toothName("73")).toBe("lower left primary canine");
    expect(toothSurfaces("11")).toEqual(["M", "I", "D", "B", "L"]);
    expect(toothSurfaces("46")).toEqual(["M", "O", "D", "B", "L"]);
    expect(surfaceName("11", "B")).toBe("Labial");
    expect(surfaceName("16", "L")).toBe("Palatal");
    expect(surfaceName("46", "L")).toBe("Lingual");
  });

  it("describes findings as codes and text", () => {
    const findings = [
      { condition: "caries" as const, surfaces: ["O" as const, "M" as const] },
      { condition: "root_canal" as const, surfaces: [] },
    ];
    expect(findingsCode(findings)).toBe("C·MO RC");
    expect(findingsText("16", findings)).toBe("Caries (mesial, occlusal); Root canal");
    expect(findingsText("16", [])).toBe("Sound");
  });
});

describe("periodontal helpers", () => {
  it("names probing sites anatomically", () => {
    expect(perioSiteName("16", "MB")).toBe("mesio-buccal");
    expect(perioSiteName("16", "DL")).toBe("disto-palatal");
    expect(perioSiteName("46", "L")).toBe("mid-lingual");
    expect(perioSiteName("11", "B")).toBe("mid-labial");
  });

  it("knows where furcation is assessed", () => {
    expect(["16", "26", "36", "47", "14", "24", "54", "85"].every(perioHasFurcation)).toBe(true);
    expect(["11", "13", "15", "34", "44", "53"].some(perioHasFurcation)).toBe(false);
  });

  it("offers present permanent teeth in charting order", () => {
    const teeth = perioTeeth([
      { tooth: "18", findings: [{ condition: "missing" }] },
      { tooth: "26", findings: [{ condition: "implant" }] },
      { tooth: "38", findings: [{ condition: "impacted" }] },
    ]);
    expect(teeth).toHaveLength(30);
    expect(teeth.slice(0, 2)).toEqual(["17", "16"]);
    expect(teeth).toContain("26");
    expect(teeth.slice(14, 17)).toEqual(["28", "37", "36"]);
    expect(teeth.at(-1)).toBe("48");
  });
});
