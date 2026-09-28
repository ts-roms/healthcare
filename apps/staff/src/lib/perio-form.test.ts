import { describe, expect, it } from "vitest";
import { emptyPerioRow, perioPayload } from "./perio-form";

describe("periodontal charting form", () => {
  it("sends only examined teeth and measured sites", () => {
    const touched = emptyPerioRow("16");
    touched.depth.MB = "5";
    touched.margin.MB = "-1";
    touched.bleeding.DB = true;
    touched.mobility = "1";
    const { teeth, errors } = perioPayload([touched, emptyPerioRow("11")]);
    expect(errors).toEqual({});
    expect(teeth).toEqual([
      {
        tooth: "16",
        mobility: 1,
        sites: [
          { site: "MB", probingDepth: 5, gingivalMargin: -1, bleeding: false, suppuration: false, plaque: false },
          { site: "DB", bleeding: true, suppuration: false, plaque: false },
        ],
      },
    ]);
  });

  it("reports values out of range per tooth", () => {
    const row = emptyPerioRow("16");
    row.depth.B = "25";
    row.furcation = "x";
    expect(perioPayload([row]).errors).toEqual({ "16": "B: probing depth is 0–20 mm" });
  });
});
