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

export type VisitRecordingProblem = "visit_closed" | "visit_online" | "procedure_requires_consultation";

/**
 * Whether a procedure may be recorded under a queue visit without a consultation: the visit is open (not cancelled,
 * left without being seen or completed), in person, and the catalogue entry allows it.
 */
export function visitRecordingProblem(
  visit: {
    status: "waiting" | "in_triage" | "awaiting_consultation" | "in_consultation" | "completed" | "cancelled" | "left_without_being_seen";
    modality: string;
  },
  definition: { allowedOutsideConsultation: boolean },
): VisitRecordingProblem | null {
  if (visit.status === "completed" || visit.status === "cancelled" || visit.status === "left_without_being_seen") return "visit_closed";
  if (visit.modality !== "in_person") return "visit_online";
  if (!definition.allowedOutsideConsultation) return "procedure_requires_consultation";
  return null;
}

export type ConsentProblem = "procedure_consent_required" | "consent_after_procedure" | "consent_wording_required";

/**
 * Whether the consent given with a procedure is acceptable: required by the catalogue entry when it says so, obtained
 * not after the procedure was performed (5 minutes of clock tolerance), and the organization's published wording named
 * when the patient was shown one electronically.
 */
export function consentProblem(
  definition: { consentRequired: boolean },
  consent: { capturedVia: "paper" | "electronic" | "verbal"; obtainedAt: Date; wordingId: string | null } | null,
  performedAt: Date,
): ConsentProblem | null {
  if (!consent) return definition.consentRequired ? "procedure_consent_required" : null;
  if (consent.obtainedAt.getTime() > performedAt.getTime() + PERFORMED_AT_TOLERANCE_MS) return "consent_after_procedure";
  if (consent.capturedVia === "electronic" && !consent.wordingId) return "consent_wording_required";
  return null;
}

/** "Suture repair of laceration × 2 (left forearm)". */
export function procedureText(p: { name: string; quantity: number; bodySite: string | null }): string {
  return `${p.name}${p.quantity > 1 ? ` × ${p.quantity}` : ""}${p.bodySite ? ` (${p.bodySite})` : ""}`;
}
