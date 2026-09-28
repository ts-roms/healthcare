import { awaitsReferenceLab, canMoveSendOut, dispatchProblem, expectedTurnaround, manifestNumber, sendOutTiming } from "./send-out.rules";

describe("send-out rules", () => {
  it("moves forward only: prepared → dispatched → results received / rejected; cancellation before an answer", () => {
    expect(canMoveSendOut("prepared", "dispatched")).toBe(true);
    expect(canMoveSendOut("prepared", "cancelled")).toBe(true);
    expect(canMoveSendOut("prepared", "results_received")).toBe(false);
    expect(canMoveSendOut("dispatched", "results_received")).toBe(true);
    expect(canMoveSendOut("dispatched", "rejected")).toBe(true);
    expect(canMoveSendOut("dispatched", "cancelled")).toBe(true);
    expect(canMoveSendOut("dispatched", "prepared")).toBe(false);
    for (const final of ["results_received", "rejected", "cancelled"] as const) {
      expect(canMoveSendOut(final, "cancelled")).toBe(false);
      expect(canMoveSendOut(final, "dispatched")).toBe(false);
    }
  });

  it("blocks in-house entry only while the reference laboratory has not answered", () => {
    expect(awaitsReferenceLab("prepared")).toBe(true);
    expect(awaitsReferenceLab("dispatched")).toBe(true);
    expect(awaitsReferenceLab("results_received")).toBe(false);
    expect(awaitsReferenceLab("rejected")).toBe(false);
    expect(awaitsReferenceLab(null)).toBe(false);
  });

  it("numbers manifests and prefers the reference laboratory's turnaround", () => {
    expect(manifestNumber(42)).toBe("SM00000042");
    expect(expectedTurnaround(2880, 120)).toBe(2880);
    expect(expectedTurnaround(null, 120)).toBe(120);
    expect(expectedTurnaround(undefined, null)).toBeNull();
  });

  it("counts turnaround from dispatch and flags overdue send-outs still waiting", () => {
    const dispatchedAt = new Date("2026-09-01T00:00:00Z");
    const now = new Date("2026-09-03T00:00:00Z");
    expect(sendOutTiming({ status: "prepared", dispatchedAt: null, turnaroundMinutes: 60 }, now)).toEqual({ dueAt: null, minutesOut: null, overdue: false });
    expect(sendOutTiming({ status: "dispatched", dispatchedAt, turnaroundMinutes: 24 * 60 }, now)).toEqual({
      dueAt: new Date("2026-09-02T00:00:00Z"),
      minutesOut: 2 * 24 * 60,
      overdue: true,
    });
    expect(sendOutTiming({ status: "dispatched", dispatchedAt, turnaroundMinutes: 72 * 60 }, now).overdue).toBe(false);
    expect(sendOutTiming({ status: "dispatched", dispatchedAt, turnaroundMinutes: null }, now)).toMatchObject({ dueAt: null, overdue: false });
    // Answered: the time out is fixed at the answer, never overdue.
    const answered = sendOutTiming(
      { status: "results_received", dispatchedAt, turnaroundMinutes: 60, resultsReceivedAt: new Date("2026-09-01T06:00:00Z") },
      now,
    );
    expect(answered).toMatchObject({ minutesOut: 360, overdue: false });
  });

  it("dispatches prepared send-outs of one facility to one reference laboratory", () => {
    const base = { status: "prepared" as const, facilityId: "f1", referenceLaboratoryId: "r1" };
    expect(dispatchProblem([], "f1")?.code).toBe("nothing_to_dispatch");
    expect(dispatchProblem([{ id: "a", ...base }], "f1")).toBeNull();
    expect(dispatchProblem([{ id: "a", ...base }], "f2")?.code).toBe("wrong_facility");
    expect(dispatchProblem([{ id: "a", ...base, status: "dispatched" }], "f1")?.code).toBe("send_out_not_prepared");
    expect(
      dispatchProblem(
        [
          { id: "a", ...base },
          { id: "b", ...base, referenceLaboratoryId: "r2" },
        ],
        "f1",
      )?.code,
    ).toBe("mixed_reference_laboratories");
  });
});
