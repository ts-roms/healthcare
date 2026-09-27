"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { DiagnosisView, Encounter, NoteRevision } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const noteShape = {
  subjective: z.string().max(20_000).optional(),
  objective: z.string().max(20_000).optional(),
  assessment: z.string().max(20_000).optional(),
  plan: z.string().max(20_000).optional(),
};
const templateShape = { templateKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/), sections: z.record(z.string(), z.unknown()) };
const reason = z.string().trim().min(3, "Give a reason").max(500);

const startSchema = z.object({ visitId: z.uuid() });
/** Starts the consultation for a queue visit: the visit moves to "with provider". */
export async function startEncounter(input: z.input<typeof startSchema>): Promise<ActionResult<Encounter>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<Encounter>("/encounters", { method: "POST", body: { visitId: parsed.data.visitId } }));
}

const saveSchema = z.object({ encounterId: z.uuid(), basedOnRevision: z.number().int().min(0), ...noteShape, ...templateShape });
/** Saves a draft revision. `basedOnRevision` guards against overwriting someone else's newer draft (409 note_revision_conflict). */
export async function saveNote(input: z.input<typeof saveSchema>): Promise<ActionResult<NoteRevision>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { encounterId, ...body } = parsed.data;
  return actionResult(() => api<NoteRevision>(`/encounters/${encounterId}/note`, { method: "PUT", body }));
}

const signSchema = z.object({
  encounterId: z.uuid(),
  version: z.number().int().positive(),
  /** Unsaved note changes are saved as a draft first, then signed, so what is signed is what the clinician sees. */
  draft: z.object({ basedOnRevision: z.number().int().min(0), ...noteShape, ...templateShape }).optional(),
});
export async function signEncounter(input: z.input<typeof signSchema>): Promise<ActionResult<Encounter>> {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { encounterId, draft } = parsed.data;
  let version = parsed.data.version;
  if (draft) {
    const saved = await actionResult(() => api<NoteRevision>(`/encounters/${encounterId}/note`, { method: "PUT", body: draft }));
    if (!saved.ok) return saved;
    // Saving a revision advances the encounter version by one; the revision check above proved no one else wrote in between.
    version += 1;
  }
  return actionResult(() => api<Encounter>(`/encounters/${encounterId}/sign`, { method: "POST", body: { version } }));
}

const amendSchema = z.object({ encounterId: z.uuid(), basedOnRevision: z.number().int().min(1), reason, ...noteShape, ...templateShape });
/** Adds an amendment to a signed encounter; the signed text stays in the revision history. */
export async function amendNote(input: z.input<typeof amendSchema>): Promise<ActionResult<NoteRevision>> {
  const parsed = amendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { encounterId, ...body } = parsed.data;
  return actionResult(() => api<NoteRevision>(`/encounters/${encounterId}/amendments`, { method: "POST", body }));
}

const errorSchema = z.object({ encounterId: z.uuid(), reason });
/** For an encounter opened by mistake (wrong patient, duplicate): the patient returns to the queue. */
export async function markEncounterEnteredInError(input: z.input<typeof errorSchema>): Promise<ActionResult<Encounter>> {
  const parsed = errorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { encounterId, ...body } = parsed.data;
  return actionResult(() => api<Encounter>(`/encounters/${encounterId}/entered-in-error`, { method: "POST", body }));
}

const diagnosisSchema = z.object({
  encounterId: z.uuid(),
  display: z.string().trim().min(1, "Describe the diagnosis").max(300),
  codeSystemKey: z.string().optional(),
  code: z.string().trim().max(20).optional(),
  rank: z.enum(["primary", "secondary"]),
  certainty: z.enum(["provisional", "confirmed"]),
  isChronic: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
  amendmentReason: z.string().trim().max(500).optional(),
});
export async function addDiagnosis(input: z.input<typeof diagnosisSchema>): Promise<ActionResult<DiagnosisView>> {
  const parsed = diagnosisSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { encounterId, code, codeSystemKey, notes, amendmentReason, ...rest } = parsed.data;
  const coded = code && codeSystemKey ? { code, codeSystemKey } : {};
  return actionResult(() =>
    api<DiagnosisView>(`/encounters/${encounterId}/diagnoses`, {
      method: "POST",
      body: { ...rest, ...coded, notes: notes || undefined, amendmentReason: amendmentReason || undefined },
    }),
  );
}

const diagnosisStatusSchema = z.object({
  encounterId: z.uuid(),
  diagnosisId: z.uuid(),
  status: z.enum(["resolved", "entered_in_error"]),
  reason,
});
export async function setDiagnosisStatus(input: z.input<typeof diagnosisStatusSchema>): Promise<ActionResult<DiagnosisView>> {
  const parsed = diagnosisStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { encounterId, diagnosisId, ...body } = parsed.data;
  return actionResult(() => api<DiagnosisView>(`/encounters/${encounterId}/diagnoses/${diagnosisId}/status`, { method: "POST", body }));
}

const revisionsSchema = z.object({ encounterId: z.uuid() });
/** Full note history (drafts, signed version, amendments). Viewing it is audited by the API. */
export async function loadRevisions(input: z.input<typeof revisionsSchema>): Promise<ActionResult<NoteRevision[]>> {
  const parsed = revisionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<NoteRevision[]>(`/encounters/${parsed.data.encounterId}/revisions`));
}
