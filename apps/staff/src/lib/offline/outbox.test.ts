import { describe, expect, it } from "vitest";
import { nextReplayable, type OfflineAction, outboxCounts, parkOrphans, pruneDone, resolvePatient, resolveVisit } from "./outbox";

const form = { familyName: "Reyes", givenName: "Ana", sex: "female" as const, birthDate: "1990-01-01" };
const register = (id: string, status: OfflineAction["status"], capturedAt: string, result?: { patientId: string; patientNumber: string }): OfflineAction => ({
  id,
  kind: "register",
  status,
  capturedAt,
  label: "Ana Reyes",
  payload: { form },
  ...(result ? { result } : {}),
});
const walkIn = (id: string, actionId: string, status: OfflineAction["status"], capturedAt: string): OfflineAction => ({
  id,
  kind: "walk_in",
  status,
  capturedAt,
  label: "Walk-in",
  payload: { patient: { kind: "offline", actionId }, visitTypeId: "vt", priority: "routine" },
});

describe("offline outbox", () => {
  it("replays in capture order and holds a walk-in until its registration is done", () => {
    const r = register("r1", "waiting", "2026-10-02T01:00:00Z");
    const w = walkIn("w1", "r1", "waiting", "2026-10-02T01:01:00Z");
    expect(nextReplayable([w, r])?.id).toBe("r1");
    expect(nextReplayable([w, { ...r, status: "replaying" }])).toBeNull();
    expect(nextReplayable([w, register("r1", "done", "2026-10-02T01:00:00Z", { patientId: "p1", patientNumber: "P-1" })])?.id).toBe("w1");
  });

  it("parks whatever waited on a parked action, and counts what the banner shows", () => {
    const r = { ...register("r1", "parked", "2026-10-02T01:00:00Z"), parked: { code: "possible_duplicates", message: "Review" } } as OfflineAction;
    const w = walkIn("w1", "r1", "waiting", "2026-10-02T01:01:00Z");
    const t: OfflineAction = {
      id: "t1",
      kind: "triage",
      status: "waiting",
      capturedAt: "2026-10-02T01:02:00Z",
      label: "Vitals",
      payload: { visit: { kind: "offline", actionId: "w1" }, chiefComplaint: "Fever", priority: "routine", vitals: {}, completeTriage: true },
    };
    const once = parkOrphans([r, w, t]);
    expect(once.find((a) => a.id === "w1")?.status).toBe("parked");
    // The triage waits on the walk-in, which is parked now: a second pass parks it too.
    const twice = parkOrphans(once);
    expect(twice.find((a) => a.id === "t1")?.parked?.code).toBe("dependency_parked");
    expect(outboxCounts(twice)).toEqual({ waiting: 0, parked: 3 });
  });

  it("resolves references only once the target replayed", () => {
    const done = register("r1", "done", "2026-10-02T01:00:00Z", { patientId: "p1", patientNumber: "P-1" });
    expect(resolvePatient({ kind: "offline", actionId: "r1" }, [done])).toEqual({ patientId: "p1" });
    expect(resolvePatient({ kind: "offline", actionId: "r1" }, [register("r1", "waiting", "x")])).toBeNull();
    expect(resolvePatient({ kind: "number", patientNumber: "P-9" }, [])).toEqual({ patientNumber: "P-9" });
    expect(resolveVisit({ kind: "existing", visitId: "v1", ticket: "A-1" }, [])).toBe("v1");
    const w = { ...walkIn("w1", "r1", "done", "x"), result: { visitId: "v2", ticket: "A-2" } } as OfflineAction;
    expect(resolveVisit({ kind: "offline", actionId: "w1" }, [w])).toBe("v2");
  });

  it("drops done actions after a day and keeps everything else", () => {
    const old = register("r1", "done", "2026-10-01T00:00:00Z", { patientId: "p", patientNumber: "n" });
    const recent = register("r2", "done", "2026-10-02T05:00:00Z", { patientId: "p", patientNumber: "n" });
    const parked = register("r3", "parked", "2026-09-01T00:00:00Z");
    expect(pruneDone([old, recent, parked], new Date("2026-10-02T06:00:00Z")).map((a) => a.id)).toEqual(["r2", "r3"]);
  });
});
