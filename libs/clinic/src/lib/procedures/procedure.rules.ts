/**
 * Rules for procedures performed at the clinic (docs/domains/clinic.md, "Procedures"). Nothing here decides whether a
 * procedure was indicated: that is the clinician's judgement.
 */

/** How far ahead of the server clock a performed time may be (clock drift between devices). */
export const PERFORMED_AT_TOLERANCE_MS = 5 * 60 * 1000;

export type PerformedAtProblem = "performed_in_future" | "performed_before_encounter";

/** A procedure is performed during or after its consultation began, and not in the future. */
export function performedAtProblem(performedAt: Date, encounterStartedAt: Date, now: Date): PerformedAtProblem | null {
  if (performedAt.getTime() > now.getTime() + PERFORMED_AT_TOLERANCE_MS) return "performed_in_future";
  if (performedAt.getTime() < encounterStartedAt.getTime() - PERFORMED_AT_TOLERANCE_MS) return "performed_before_encounter";
  return null;
}

export type RecordingProblem = "encounter_entered_in_error" | "encounter_online" | "amendment_permission_required" | "late_entry_reason_required";

/**
 * Whether a procedure may be recorded in the consultation: not one entered in error, not an online consultation
 * (nothing is performed on the patient there), and once signed, only by someone who may amend it, with a reason.
 */
export function recordingProblem(
  encounter: { status: "in_progress" | "completed" | "entered_in_error"; modality: string },
  actor: { canAmend: boolean },
  lateEntryReason: string | undefined,
): RecordingProblem | null {
  if (encounter.status === "entered_in_error") return "encounter_entered_in_error";
  if (encounter.modality !== "in_person") return "encounter_online";
  if (encounter.status === "completed") {
    if (!actor.canAmend) return "amendment_permission_required";
    if (!lateEntryReason) return "late_entry_reason_required";
  }
  return null;
}

/** "Suture repair of laceration × 2 (left forearm)". */
export function procedureText(p: { name: string; quantity: number; bodySite: string | null }): string {
  return `${p.name}${p.quantity > 1 ? ` × ${p.quantity}` : ""}${p.bodySite ? ` (${p.bodySite})` : ""}`;
}
