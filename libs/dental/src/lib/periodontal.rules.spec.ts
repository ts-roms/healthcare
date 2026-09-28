import { attachmentLevel, hasFurcation, perioChanges, perioSummary, perioToothIssues, type PerioToothInput } from "./periodontal.rules";

const tooth = (t: string, sites: Array<[string, number | null, number | null, boolean?, boolean?]>, extra: Partial<PerioToothInput> = {}): PerioToothInput => ({
  tooth: t,
  sites: sites.map(([site, probingDepth, gingivalMargin, bleeding = false, plaque = false]) => ({
    site: site as PerioToothInput["sites"][number]["site"],
    probingDepth,
    gingivalMargin,
    bleeding,
    plaque,
  })),
  ...extra,
});

describe("periodontal charting rules", () => {
  it("knows which teeth have a furcation", () => {
    expect(["16", "17", "18", "36", "46", "14", "24"].every(hasFurcation)).toBe(true);
    expect(["11", "13", "15", "34", "44", "45"].some(hasFurcation)).toBe(false);
    expect(hasFurcation("54")).toBe(true);
    expect(hasFurcation("53")).toBe(false);
  });

  it("validates measurements, sites and furcation", () => {
    expect(
      perioToothIssues(
        tooth(
          "16",
          [
            ["MB", 3, 0],
            ["B", 2, 1],
          ],
          { mobility: 1, furcation: 2 },
        ),
      ),
    ).toEqual([]);
    expect(perioToothIssues(tooth("11", [["MB", 3, 0]], { furcation: 1 }))).toEqual(["tooth 11 has no furcation"]);
    expect(perioToothIssues(tooth("11", [["MB", 3, 0]], { furcation: 0 }))).toEqual([]);
    expect(
      perioToothIssues(
        tooth("11", [
          ["MB", 21, 0],
          ["MB", 2, -11],
        ]),
      ),
    ).toEqual(["MB: probing depth is 0–20 mm", "site MB is recorded twice", "MB: gingival margin is −10 to 20 mm"]);
    expect(perioToothIssues(tooth("11", [], { mobility: 4 }))).toEqual(["mobility is graded 0–3"]);
    expect(perioToothIssues(tooth("19", []))).toEqual(["19 is not an FDI tooth code"]);
    expect(perioToothIssues(tooth("11", []))).toEqual(["record at least one site, the mobility or the furcation"]);
  });

  it("derives attachment levels and summarises a chart", () => {
    expect(attachmentLevel({ probingDepth: 5, gingivalMargin: 2 })).toBe(7);
    expect(attachmentLevel({ probingDepth: 4, gingivalMargin: -1 })).toBe(3);
    expect(attachmentLevel({ probingDepth: 4, gingivalMargin: null })).toBeNull();
    const summary = perioSummary([
      tooth(
        "16",
        [
          ["MB", 6, 1, true, true],
          ["B", 3, 0],
          ["DB", 4, 2, true],
        ],
        { mobility: 1, furcation: 2 },
      ),
      tooth("11", [
        ["MB", 2, null],
        ["B", null, null, false, true],
      ]),
    ]);
    expect(summary).toEqual({
      teeth: 2,
      sitesProbed: 4,
      bleedingPercent: 50,
      plaquePercent: 40,
      sitesDepth4Plus: 2,
      sitesDepth6Plus: 1,
      maxProbingDepth: 6,
      meanAttachmentLevel: 5.3,
      suppurationSites: 0,
      mobileTeeth: 1,
      furcationTeeth: 1,
    });
    expect(perioSummary([]).bleedingPercent).toBeNull();
  });

  it("points to sites whose probing depth changed by 2 mm or more between charts", () => {
    const before = [
      tooth("16", [
        ["MB", 3, 0],
        ["B", 6, 0],
        ["DB", 4, 0],
      ]),
      tooth("11", [["MB", 2, 0]]),
    ];
    const after = [
      tooth("16", [
        ["MB", 5, 0],
        ["B", 3, 0],
        ["DB", 5, 0],
      ]),
      tooth("21", [["MB", 7, 0]]),
    ];
    expect(perioChanges(before, after)).toEqual({
      deeper: [{ tooth: "16", site: "MB", before: 3, after: 5 }],
      shallower: [{ tooth: "16", site: "B", before: 6, after: 3 }],
    });
  });
});
