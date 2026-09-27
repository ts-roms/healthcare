import { describe, expect, it } from "vitest";
import { consultationOrder, sessionLabel, waitingMinutes } from "./telemedicine-mapping";

describe("telemedicine mapping", () => {
  it("labels the patient's progress", () => {
    expect(sessionLabel({ status: "scheduled", questionnaireSubmittedAt: null })).toBe("Not answered yet");
    expect(sessionLabel({ status: "scheduled", questionnaireSubmittedAt: "2026-10-01T01:00:00Z" })).toBe("Questions answered");
    expect(sessionLabel({ status: "waiting", questionnaireSubmittedAt: "x" })).toBe("In the waiting room");
  });

  it("counts waiting minutes only while waiting", () => {
    const now = new Date("2026-10-01T02:10:00Z");
    expect(waitingMinutes({ status: "waiting", patientJoinedAt: "2026-10-01T02:00:00Z" }, now)).toBe(10);
    expect(waitingMinutes({ status: "in_consultation", patientJoinedAt: "2026-10-01T02:00:00Z" }, now)).toBeNull();
  });

  it("puts waiting patients first, longest wait first", () => {
    const row = (id: string, status: "scheduled" | "waiting" | "ended", startsAt: string, patientJoinedAt: string | null = null) => ({
      id,
      appointment: { startsAt },
      session: { status, patientJoinedAt },
    });
    const ordered = consultationOrder([
      row("later", "scheduled", "2026-10-01T03:00:00Z"),
      row("done", "ended", "2026-10-01T01:00:00Z"),
      row("w2", "waiting", "2026-10-01T02:30:00Z", "2026-10-01T02:05:00Z"),
      row("w1", "waiting", "2026-10-01T02:00:00Z", "2026-10-01T01:55:00Z"),
      row("soon", "scheduled", "2026-10-01T02:40:00Z"),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["w1", "w2", "soon", "later", "done"]);
  });
});
