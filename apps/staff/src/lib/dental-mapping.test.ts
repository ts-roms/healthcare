import { describe, expect, it } from "vitest";
import type { DentalVisit } from "./api/types";
import { changedTeeth, draftProblems, examinationTeeth, openVisit, toChart } from "./dental-mapping";

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
});
