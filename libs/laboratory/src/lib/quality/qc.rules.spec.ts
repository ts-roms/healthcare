import { decisiveRun, evaluateQc, qcAllowsResults, zScore } from "./qc.rules";

const L1 = "lot-1";
const L2 = "lot-2";
const at = (z: number, qcLotId = L1) => ({ z, qcLotId });
const common = ["1_3s", "2_2s", "R_4s"] as const;
const all = ["1_3s", "2_2s", "R_4s", "4_1s", "10_x"] as const;

describe("QC evaluation (Westgard multirules)", () => {
  it("computes z-scores against the target", () => {
    expect(zScore(105, 100, 2)).toBe(2.5);
    expect(zScore(97, 100, 2)).toBe(-1.5);
    expect(() => zScore(1, 1, 0)).toThrow();
  });

  it("accepts a control within 2 SD", () => {
    expect(evaluateQc(at(1.9), [], common)).toEqual({ zScore: 1.9, status: "accepted", violations: [] });
  });

  it("warns on 1_2s alone and rejects on 1_3s", () => {
    expect(evaluateQc(at(2.4), [at(0.3)], common)).toMatchObject({ status: "warning", violations: ["1_2s"] });
    expect(evaluateQc(at(-3.2), [], common)).toMatchObject({ status: "rejected", violations: ["1_2s", "1_3s"] });
  });

  it("rejects two consecutive controls beyond 2 SD on the same side (2_2s), not on opposite sides", () => {
    expect(evaluateQc(at(2.3), [at(2.1, L2)], common)).toMatchObject({ status: "rejected", violations: ["1_2s", "2_2s"] });
    expect(evaluateQc(at(2.3), [at(-2.1)], common).violations).not.toContain("2_2s");
  });

  it("rejects levels more than 4 SD apart on opposite sides (R_4s), only across different control lots", () => {
    expect(evaluateQc(at(2.2, L1), [at(-2.1, L2)], common)).toMatchObject({ status: "rejected", violations: ["1_2s", "R_4s"] });
    expect(evaluateQc(at(2.2, L1), [at(-2.1, L1)], common).violations).not.toContain("R_4s");
  });

  it("applies 4_1s and 10_x only when the facility chose them; otherwise they warn", () => {
    const drift = [at(1.2), at(1.5, L2), at(1.1)];
    expect(evaluateQc(at(1.3), drift, all)).toMatchObject({ status: "rejected", violations: ["4_1s"] });
    expect(evaluateQc(at(1.3), drift, common)).toMatchObject({ status: "warning", violations: ["4_1s"] });
    const shift = Array.from({ length: 9 }, (_, i) => at(0.2 + i / 100));
    expect(evaluateQc(at(0.5), shift, all)).toMatchObject({ status: "rejected", violations: ["10_x"] });
    expect(evaluateQc(at(0.5), shift.slice(0, 8), all).status).toBe("accepted");
    expect(evaluateQc(at(-0.5), shift, all).status).toBe("accepted");
  });
});

describe("QC gate for patient results", () => {
  it("is decided by the worst latest level, not the newest run", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 8, 28, h));
    const rejectedL2 = { id: "b", status: "rejected" as const, runAt: t(8) };
    const acceptedL1 = { id: "a", status: "accepted" as const, runAt: t(9) };
    expect(decisiveRun([acceptedL1, rejectedL2])).toBe(rejectedL2);
    expect(decisiveRun([acceptedL1, { ...acceptedL1, id: "c", runAt: t(10) }])?.id).toBe("c");
    expect(decisiveRun([])).toBeNull();
  });

  it("is open unless the facility requires QC", () => {
    expect(qcAllowsResults(null, false).allowed).toBe(true);
    expect(qcAllowsResults(null, true)).toMatchObject({ allowed: false });
    expect(qcAllowsResults({ status: "rejected" }, true)).toMatchObject({ allowed: false });
    expect(qcAllowsResults({ status: "warning" }, true).allowed).toBe(true);
    expect(qcAllowsResults({ status: "accepted" }, true).allowed).toBe(true);
  });
});
