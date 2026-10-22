import { createHash } from "node:crypto";

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

// ---- electronic signature on a consent form (migration 0120) ----------------------------------------------------

/** SHA-256 (hex) of what a signer agreed to: the wording (id, version, title, text) for this patient and procedure. Recomputable from the records. */
export function consentTextHash(text: {
  wordingId: string;
  version: number;
  title: string;
  body: string;
  patientNumber: string;
  procedureCode: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([text.wordingId, text.version, text.title, text.body, text.patientNumber, text.procedureCode]))
    .digest("hex");
}

export const SIGNATURE_MAX_STROKES = 64;
export const SIGNATURE_MAX_POINTS = 3000;
/** Total pen travel, as a share of the box width, below which the mark is a dot or a tap rather than a signature. */
export const SIGNATURE_MIN_INK = 0.25;

export type SignatureProblem = "signature_empty" | "signature_too_large";

/**
 * Whether drawn strokes (polylines of [x, y] in 0..1) can stand as a signature: some real ink, and not an
 * unreasonable amount of data. Nothing here judges whether a drawing is "really" a signature.
 */
export function signatureProblem(strokes: number[][][]): SignatureProblem | null {
  if (strokes.length > SIGNATURE_MAX_STROKES || strokes.reduce((n, stroke) => n + stroke.length, 0) > SIGNATURE_MAX_POINTS) return "signature_too_large";
  let ink = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i += 1) {
      const [x0, y0] = stroke[i - 1]!;
      const [x1, y1] = stroke[i]!;
      ink += Math.hypot(x1! - x0!, (y1! - y0!) / 3);
    }
  }
  return ink < SIGNATURE_MIN_INK ? "signature_empty" : null;
}

// ---- signing consent forms online and for minors (migration 0121) ------------------------------------------------

/** The organization's defaults until it sets its own: a reference age and nothing in MyHealth. */
export const DEFAULT_MINOR_AGE_YEARS = 18;
export const DEFAULT_REQUEST_VALID_DAYS = 14;

/**
 * Whether a parent or guardian must sign for this patient: the organization chose an age and the patient (in full years, on
 * the facility's local date) is under it. The platform encodes no age of majority; the organization confirms its own value.
 */
export function representativeRequired(patientAge: number, minorAgeYears: number | null): boolean {
  return minorAgeYears !== null && patientAge < minorAgeYears;
}

export type SignerProblem = "minor_requires_representative";

/** A minor's form is signed by a representative, at the clinic or in MyHealth. */
export function signerProblem(signerKind: "patient" | "representative", needsRepresentative: boolean): SignerProblem | null {
  return needsRepresentative && signerKind === "patient" ? "minor_requires_representative" : null;
}

export type SignatureRequestProblem = "request_not_pending" | "request_expired";

/** A request can be signed (or cancelled) only while pending and not past its expiry. */
export function signatureRequestProblem(request: { status: "pending" | "signed" | "cancelled"; expiresAt: Date }, now: Date): SignatureRequestProblem | null {
  if (request.status !== "pending") return "request_not_pending";
  return request.expiresAt.getTime() <= now.getTime() ? "request_expired" : null;
}

/** When a request made now stops being open. */
export function signatureRequestExpiry(now: Date, validDays: number): Date {
  return new Date(now.getTime() + validDays * 86_400_000);
}
