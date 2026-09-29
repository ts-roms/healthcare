import { costPerPatientRun, loadCapacity, patientRunTests, summarizeReagentUse, testsPerRunOf } from "./reagent-use.rules";

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

  it("counts runs and tests apart when a run uses more than one test", () => {
    const summary = summarizeReagentUse(
      [
        { kind: "patient", tests: 3, runs: 2 },
        { kind: "qc", tests: 4, runs: 2 },
        { kind: "waste", tests: 1 },
      ],
      100,
      true,
    );
    expect(summary).toMatchObject({ patientRuns: 2, patientTests: 3, qcRuns: 2, qcTests: 4, wasted: 1, total: 8, remaining: 92 });
  });

  it("counts a panel's first run with the most tests per run among the ordered tests the load serves, a later version with its own test", () => {
    const testsPerRun = new Map([
      ["chol", 2],
      ["tsh", 3],
    ]);
    expect(testsPerRunOf(testsPerRun, "glu")).toBe(1);
    const base = { loadTestId: null, resultTestId: "glu", orderTestIds: ["glu", "chol"], testsPerRun };
    expect(patientRunTests({ ...base, versionNumber: 1 })).toBe(2);
    expect(patientRunTests({ ...base, versionNumber: 2 })).toBe(1);
    expect(patientRunTests({ ...base, resultTestId: "chol", versionNumber: 2 })).toBe(2);
    // A load for glucose only serves glucose: cholesterol's duplicate does not count on it.
    expect(patientRunTests({ ...base, loadTestId: "glu", versionNumber: 1 })).toBe(1);
    // A test the load serves that is not on the order does not count either.
    expect(patientRunTests({ ...base, loadTestId: "tsh", versionNumber: 1 })).toBe(1);
  });
});
