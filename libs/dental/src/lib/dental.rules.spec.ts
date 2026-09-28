import {
  applyChartEffect,
  isTooth,
  normalizeSurfaces,
  planStatusFromItems,
  procedureLabel,
  procedureSiteIssues,
  surfacesOf,
  toothInfo,
  toothStateIssues,
} from "./dental.rules";

describe("dental rules", () => {
  it("accepts FDI permanent and primary teeth only", () => {
    for (const t of ["11", "18", "28", "38", "48", "51", "55", "65", "75", "85"]) expect(isTooth(t)).toBe(true);
    for (const t of ["10", "19", "56", "86", "91", "1", "111", "ab"]) expect(isTooth(t)).toBe(false);
    expect(toothInfo("16")).toEqual({ quadrant: 1, position: 6, dentition: "permanent", arch: "upper", anterior: false });
    expect(toothInfo("73")).toEqual({ quadrant: 7, position: 3, dentition: "primary", arch: "lower", anterior: true });
  });

  it("knows which surfaces a tooth has", () => {
    expect(surfacesOf("11")).toEqual(["M", "I", "D", "B", "L"]);
    expect(surfacesOf("46")).toEqual(["M", "O", "D", "B", "L"]);
    expect(normalizeSurfaces(["L", "O", "M", "O"])).toEqual(["M", "O", "L"]);
  });

  it("validates a tooth's findings", () => {
    expect(toothStateIssues("16", [])).toEqual([]);
    expect(toothStateIssues("16", [{ condition: "caries", surfaces: ["O", "M"] }])).toEqual([]);
    expect(toothStateIssues("16", [{ condition: "caries", surfaces: [] }])).toEqual(["caries needs the affected surfaces"]);
    expect(toothStateIssues("11", [{ condition: "caries", surfaces: ["O"] }])).toEqual(["tooth 11 has no O surface"]);
    expect(toothStateIssues("46", [{ condition: "restoration", surfaces: ["I"] }])).toEqual(["tooth 46 has no I surface"]);
    expect(toothStateIssues("16", [{ condition: "crown", surfaces: ["O"] }])).toEqual(["crown applies to the whole tooth, not to surfaces"]);
    expect(toothStateIssues("16", [{ condition: "fracture", surfaces: ["B"] }])).toEqual([]);
    expect(
      toothStateIssues("16", [
        { condition: "missing", surfaces: [] },
        { condition: "crown", surfaces: [] },
      ]),
    ).toEqual(["missing cannot be charted with other findings"]);
    expect(
      toothStateIssues("16", [
        { condition: "caries", surfaces: ["O"] },
        { condition: "caries", surfaces: ["M"] },
      ]),
    ).toEqual(["caries is charted twice"]);
    expect(toothStateIssues("19", [])).toEqual(["19 is not an FDI tooth code"]);
  });

  it("checks where a procedure is recorded", () => {
    expect(procedureSiteIssues("mouth", null, [])).toEqual([]);
    expect(procedureSiteIssues("mouth", "16", [])).toHaveLength(1);
    expect(procedureSiteIssues("tooth", undefined, [])).toEqual(["choose the tooth"]);
    expect(procedureSiteIssues("tooth", "36", ["O"])).toHaveLength(1);
    expect(procedureSiteIssues("surface", "36", [])).toEqual(["choose the treated surfaces"]);
    expect(procedureSiteIssues("surface", "36", ["M", "O"])).toEqual([]);
    expect(procedureSiteIssues("surface", "21", ["O"])).toEqual(["tooth 21 has no O surface"]);
  });

  it("applies a procedure's effect to the tooth", () => {
    const decayed = [
      { condition: "caries" as const, surfaces: ["M" as const, "O" as const] },
      { condition: "restoration" as const, surfaces: ["D" as const] },
    ];
    expect(applyChartEffect(decayed, "restoration", ["O"])).toEqual([
      { condition: "caries", surfaces: ["M"] },
      { condition: "restoration", surfaces: ["O", "D"] },
    ]);
    expect(applyChartEffect(decayed, "restoration", ["M", "O"])).toEqual([{ condition: "restoration", surfaces: ["M", "O", "D"] }]);
    expect(applyChartEffect([...decayed, { condition: "root_canal", surfaces: [] }], "crown", [])).toEqual([
      { condition: "crown", surfaces: [] },
      { condition: "root_canal", surfaces: [] },
    ]);
    expect(applyChartEffect(decayed, "root_canal", [])).toEqual([{ condition: "root_canal", surfaces: [] }, ...decayed]);
    expect(applyChartEffect(decayed, "missing", [])).toEqual([{ condition: "missing", surfaces: [] }]);
    expect(applyChartEffect([{ condition: "missing", surfaces: [] }], "implant", [])).toEqual([{ condition: "implant", surfaces: [] }]);
    expect(applyChartEffect([{ condition: "missing", surfaces: [] }], "sealant", ["O"])).toEqual([{ condition: "sealant", surfaces: ["O"] }]);
  });

  it("labels procedures", () => {
    expect(procedureLabel("Oral prophylaxis", null, [])).toBe("Oral prophylaxis");
    expect(procedureLabel("Composite restoration", "16", ["O", "M"])).toBe("Composite restoration — 16 MO");
    expect(procedureLabel("Extraction", "38", [])).toBe("Extraction — 38");
  });

  it("derives a plan's status from its items", () => {
    expect(planStatusFromItems(["accepted", "declined"])).toBe("accepted");
    expect(planStatusFromItems(["declined", "declined"])).toBe("declined");
    expect(planStatusFromItems(["completed", "accepted"])).toBe("in_progress");
    expect(planStatusFromItems(["completed", "declined", "cancelled"])).toBe("completed");
    expect(planStatusFromItems(["completed", "proposed"])).toBe("in_progress");
    expect(planStatusFromItems(["cancelled"])).toBe("declined");
  });
});
