import { performedAtProblem, procedureText, recordingProblem } from "./procedure.rules";

describe("clinic procedure rules", () => {
  const started = new Date("2026-09-30T01:00:00Z");
  const now = new Date("2026-09-30T02:00:00Z");

  it("accepts a time during the consultation and refuses one in the future or before it began", () => {
    expect(performedAtProblem(new Date("2026-09-30T01:30:00Z"), started, now)).toBeNull();
    expect(performedAtProblem(new Date("2026-09-30T02:04:00Z"), started, now)).toBeNull();
    expect(performedAtProblem(new Date("2026-09-30T02:30:00Z"), started, now)).toBe("performed_in_future");
    expect(performedAtProblem(new Date("2026-09-30T00:30:00Z"), started, now)).toBe("performed_before_encounter");
  });

  it("records in an in-person consultation; a signed one needs amendment permission and a reason", () => {
    const open = { status: "in_progress" as const, modality: "in_person" };
    expect(recordingProblem(open, { canAmend: false }, undefined)).toBeNull();
    expect(recordingProblem({ ...open, modality: "telemedicine" }, { canAmend: true }, undefined)).toBe("encounter_online");
    expect(recordingProblem({ ...open, status: "entered_in_error" }, { canAmend: true }, "x")).toBe("encounter_entered_in_error");
    const signed = { ...open, status: "completed" as const };
    expect(recordingProblem(signed, { canAmend: false }, "Forgot to record")).toBe("amendment_permission_required");
    expect(recordingProblem(signed, { canAmend: true }, undefined)).toBe("late_entry_reason_required");
    expect(recordingProblem(signed, { canAmend: true }, "Forgot to record")).toBeNull();
  });

  it("describes a procedure with its quantity and site", () => {
    expect(procedureText({ name: "Suture repair", quantity: 2, bodySite: "left forearm" })).toBe("Suture repair × 2 (left forearm)");
    expect(procedureText({ name: "Nebulization", quantity: 1, bodySite: null })).toBe("Nebulization");
  });
});
