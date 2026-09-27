import type { DiagnosisView, EncounterStatus, NoteRevision, Prescription } from "./api/types";

/**
 * Encounter workspace helpers. The API (`libs/clinic` encounter service) is
 * authoritative for every rule; these mirror it only to decide which controls
 * to offer and to catch an incomplete note before a round trip.
 */

export const NOTE_FIELDS = [
  { key: "subjective", label: "Subjective", placeholder: "History in the patient's words: onset, duration, character, associated symptoms…" },
  { key: "objective", label: "Objective", placeholder: "Examination findings, measurements, point-of-care results…" },
  { key: "assessment", label: "Assessment", placeholder: "Clinical impression / differential" },
  { key: "plan", label: "Plan", placeholder: "Investigations, treatment, counselling, follow-up" },
] as const;

export type NoteKey = (typeof NOTE_FIELDS)[number]["key"];
export type NoteForm = Record<NoteKey, string>;

export function noteFromRevision(note: Pick<NoteRevision, NoteKey> | null): NoteForm {
  return { subjective: note?.subjective ?? "", objective: note?.objective ?? "", assessment: note?.assessment ?? "", plan: note?.plan ?? "" };
}

export function isNoteDirty(saved: NoteForm, current: NoteForm): boolean {
  return NOTE_FIELDS.some(({ key }) => saved[key] !== current[key]);
}

/** Empty sections are sent as absent, as the API stores them (null). */
export function notePayload(note: NoteForm): Partial<Record<NoteKey, string>> {
  const out: Partial<Record<NoteKey, string>> = {};
  for (const { key } of NOTE_FIELDS) if (note[key].trim()) out[key] = note[key];
  return out;
}

/** The API refuses to sign a note without an assessment or a plan (`note_incomplete`). */
export function noteReadyToSign(note: NoteForm): boolean {
  return note.assessment.trim() !== "" || note.plan.trim() !== "";
}

export interface EncounterControls {
  editNote: boolean;
  sign: boolean;
  amend: boolean;
  markEnteredInError: boolean;
  addDiagnosis: boolean;
  /** Adding or correcting a diagnosis on a signed encounter is an amendment and needs a reason. */
  diagnosisNeedsReason: boolean;
}

/**
 * Controls to offer: drafts while in progress, signing only by the
 * responsible practitioner, amendments (with reason) once signed.
 */
export function encounterControls(status: EncounterStatus, context: { permissions: readonly string[]; isResponsiblePractitioner: boolean }): EncounterControls {
  const has = (p: string) => context.permissions.includes(p);
  const inProgress = status === "in_progress";
  const signed = status === "completed";
  return {
    editNote: inProgress && has("encounter.write"),
    sign: inProgress && has("encounter.sign") && context.isResponsiblePractitioner,
    amend: signed && has("encounter.amend"),
    markEnteredInError: inProgress && has("encounter.write"),
    addDiagnosis: (inProgress && has("encounter.write")) || (signed && has("encounter.write") && has("encounter.amend")),
    diagnosisNeedsReason: signed,
  };
}

export const ENCOUNTER_STATUS_LABEL: Record<EncounterStatus, string> = {
  in_progress: "In progress",
  completed: "Signed",
  entered_in_error: "Entered in error",
};

export const REVISION_KIND_LABEL: Record<NoteRevision["kind"], string> = { draft: "Draft", signed: "Signed", amendment: "Amendment" };

/** "E11.9 · Type 2 diabetes (ICD-10)" — the code system is shown so a code is never read out of context. */
export function diagnosisLabel(dx: Pick<DiagnosisView, "code" | "display" | "codeSystemKey">): string {
  return dx.code ? `${dx.code} · ${dx.display}${dx.codeSystemKey ? ` (${dx.codeSystemKey})` : ""}` : dx.display;
}

/** Active diagnoses first (primary before secondary), then resolved, then entered in error. */
export function sortDiagnoses<T extends Pick<DiagnosisView, "status" | "rank" | "recordedAt">>(items: T[]): T[] {
  const statusOrder = { active: 0, resolved: 1, entered_in_error: 2 } as const;
  return [...items].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] || (a.rank === b.rank ? 0 : a.rank === "primary" ? -1 : 1) || a.recordedAt.localeCompare(b.recordedAt),
  );
}

export interface PrescriptionControls {
  /** New prescriptions are issued only while the encounter is open. */
  issue: boolean;
  /** Correcting an active prescription (it becomes superseded), also after signing. */
  replace: (p: Pick<Prescription, "status">) => boolean;
  cancel: (p: Pick<Prescription, "status">) => boolean;
}

/** Mirrors `libs/prescription`: issue in an open encounter; replace or cancel active prescriptions of a valid encounter. */
export function prescriptionControls(status: EncounterStatus, permissions: readonly string[]): PrescriptionControls {
  const valid = status !== "entered_in_error";
  const mayIssue = permissions.includes("prescription.issue");
  const mayCancel = permissions.includes("prescription.cancel");
  return {
    issue: status === "in_progress" && mayIssue,
    replace: (p) => valid && mayIssue && p.status === "active",
    cancel: (p) => mayCancel && p.status === "active",
  };
}
