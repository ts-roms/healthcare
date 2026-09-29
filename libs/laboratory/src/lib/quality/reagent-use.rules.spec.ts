import { costPerPatientRun, loadCapacity, summarizeReagentUse } from "./reagent-use.rules";

describe("reagent use rules", () => {
  it("takes the stated capacity, else the stock taken times the yield", () => {
    expect(loadCapacity({ capacityTests: 250, stockQuantity: 2, testsPerUnit: 100 })).toBe(250);
    expect(loadCapacity({ stockQuantity: 2, testsPerUnit: 100 })).toBe(200);
    expect(loadCapacity({ stockQuantity: 2 })).toBeNull();
    expect(loadCapacity({ testsPerUnit: 100 })).toBeNull();
    expect(loadCapacity({})).toBeNull();
  });

  it("counts runs by kind against the capacity", () => {
    const summary = summarizeReagentUse(
      [
        { kind: "patient", tests: 1 },
        { kind: "patient", tests: 1 },
        { kind: "qc", tests: 1 },
        { kind: "calibration", tests: 3 },
        { kind: "repeat", tests: 1 },
        { kind: "waste", tests: 2 },
      ],
      20,
      true,
    );
    expect(summary).toMatchObject({ patientRuns: 2, qcRuns: 1, otherRuns: 4, wasted: 2, total: 9, remaining: 11, usedShare: 0.45, low: false });
  });

  it("marks a loaded lot low at a tenth of its capacity, and never an unloaded or unknown one", () => {
    const uses = Array.from({ length: 18 }, () => ({ kind: "patient" as const, tests: 1 }));
    expect(summarizeReagentUse(uses, 20, true).low).toBe(true);
    expect(summarizeReagentUse(uses, 20, false).low).toBe(false);
    expect(summarizeReagentUse(uses, null, true)).toMatchObject({ low: false, remaining: null, usedShare: null, total: 18 });
    expect(summarizeReagentUse([...uses, ...uses], 20, true).remaining).toBe(-16);
  });

  it("spreads a finished load's cost over its patient runs", () => {
    expect(costPerPatientRun(100_000, 3, true)).toBe(33_333);
    expect(costPerPatientRun(100_000, 3, false)).toBeNull();
    expect(costPerPatientRun(null, 3, true)).toBeNull();
    expect(costPerPatientRun(100_000, 0, true)).toBeNull();
  });
});
