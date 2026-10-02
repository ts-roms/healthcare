import { z } from "zod";
import type { ProcedureDefinition } from "./api/types";

/**
 * Procedures performed at the clinic (docs/domains/clinic.md, "Procedures"): form models for the staff app. The API
 * validates, authorizes, audits and decides (who may record after signing, when is too early or too late); these give
 * field-level errors and payloads. Times are entered as local times in the Philippines (UTC+8, no daylight saving).
 */

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const uuid = z.union([z.literal(""), z.uuid()]);
const optional = (max: number) => z.string().trim().max(max);

export const procedureFormSchema = z
  .object({
    definitionId: z.string().min(1, "Choose the procedure").pipe(z.uuid()),
    /** Local date and time (YYYY-MM-DDTHH:mm); empty for now. */
    performedAt: z
      .string()
      .trim()
      .refine((v) => v === "" || LOCAL_DATETIME.test(v), "Give the date and time it was done"),
    performerPractitionerId: uuid,
    bodySite: optional(120),
    quantity: z
      .string()
      .trim()
      .refine((v) => /^\d{1,2}$/.test(v) && Number(v) >= 1, "How many: 1 to 99"),
    notes: optional(2000),
    lateEntryReason: optional(500),
    /** Set by the page: whether the chosen procedure asks for the body site, and whether the consultation is signed. */
    requiresBodySite: z.boolean(),
    signed: z.boolean(),
    // ---- the consent obtained (migration 0095) ----
    /** Whether consent is recorded with the procedure (the page sets `consentRequired` from the catalogue entry). */
    consentGiven: z.boolean(),
    consentRequired: z.boolean(),
    consentCapturedVia: z.enum(["paper", "electronic", "verbal"]),
    consentGivenBy: z.enum(["patient", "representative"]),
    consentRepresentativeName: optional(200),
    consentRepresentativeRelationship: optional(100),
    /** Local date and time it was obtained; empty for the performed time. */
    consentObtainedAt: z
      .string()
      .trim()
      .refine((v) => v === "" || LOCAL_DATETIME.test(v), "Give the date and time consent was obtained"),
    /** The published wording shown to the patient (the current one when the page offers it). */
    consentWordingId: uuid,
    /** A scan of the signed form (a consent_form document of this patient). */
    consentDocumentId: uuid,
    consentNotes: optional(1000),
  })
  .superRefine((v, ctx) => {
    if (v.requiresBodySite && !v.bodySite) ctx.addIssue({ code: "custom", message: "Say where it was done", path: ["bodySite"] });
    if (v.signed && v.lateEntryReason.length < 3)
      ctx.addIssue({ code: "custom", message: "The consultation is signed: say why the procedure is recorded now", path: ["lateEntryReason"] });
    if (v.consentRequired && !v.consentGiven)
      ctx.addIssue({ code: "custom", message: "This procedure needs the patient's consent recorded", path: ["consentGiven"] });
    if (v.consentGiven && v.consentGivenBy === "representative" && v.consentRepresentativeName.length < 2)
      ctx.addIssue({ code: "custom", message: "Name the person who consented for the patient", path: ["consentRepresentativeName"] });
    if (v.consentGiven && v.consentCapturedVia === "electronic" && !v.consentWordingId)
      ctx.addIssue({ code: "custom", message: "Electronic consent needs a published wording to show", path: ["consentWordingId"] });
  });
export type ProcedureForm = z.input<typeof procedureFormSchema>;

export const BLANK_PROCEDURE_FORM: ProcedureForm = {
  definitionId: "",
  performedAt: "",
  performerPractitionerId: "",
  bodySite: "",
  quantity: "1",
  notes: "",
  lateEntryReason: "",
  requiresBodySite: false,
  signed: false,
  consentGiven: false,
  consentRequired: false,
  consentCapturedVia: "paper",
  consentGivenBy: "patient",
  consentRepresentativeName: "",
  consentRepresentativeRelationship: "",
  consentObtainedAt: "",
  consentWordingId: "",
  consentDocumentId: "",
  consentNotes: "",
};

/** The consent part of the API body (blanks left out), or nothing when no consent is recorded. */
export function consentPayload(f: z.output<typeof procedureFormSchema>) {
  if (!f.consentGiven) return {};
  const representative = f.consentGivenBy === "representative";
  return {
    consent: {
      capturedVia: f.consentCapturedVia,
      givenBy: f.consentGivenBy,
      ...(representative && f.consentRepresentativeName ? { representativeName: f.consentRepresentativeName } : {}),
      ...(representative && f.consentRepresentativeRelationship ? { representativeRelationship: f.consentRepresentativeRelationship } : {}),
      ...(f.consentObtainedAt ? { obtainedAt: `${f.consentObtainedAt}:00+08:00` } : {}),
      ...(f.consentWordingId ? { wordingId: f.consentWordingId } : {}),
      ...(f.consentDocumentId ? { documentId: f.consentDocumentId } : {}),
      ...(f.consentNotes ? { notes: f.consentNotes } : {}),
    },
  };
}

/** The API body: blanks left out, the local time sent with the Philippine offset. */
export function procedurePayload(f: z.output<typeof procedureFormSchema>) {
  return {
    definitionId: f.definitionId,
    quantity: Number(f.quantity),
    ...(f.performedAt ? { performedAt: `${f.performedAt}:00+08:00` } : {}),
    ...(f.performerPractitionerId ? { performerPractitionerId: f.performerPractitionerId } : {}),
    ...(f.bodySite ? { bodySite: f.bodySite } : {}),
    ...(f.notes ? { notes: f.notes } : {}),
    ...(f.signed && f.lateEntryReason ? { lateEntryReason: f.lateEntryReason } : {}),
    ...consentPayload(f),
  };
}

/**
 * What choosing a catalogue entry sets on the form: the entry's requirements, the current wording for electronic
 * consent, and the organization's note template in the notes when the clinician has not typed any (or the notes still
 * hold the previous entry's template). The stored note is always what the clinician submits.
 */
export function applyDefinition(
  form: ProcedureForm,
  definition: Pick<ProcedureDefinition, "id" | "requiresBodySite" | "consentRequired" | "noteTemplate" | "consentWording"> | undefined,
  previous: Pick<ProcedureDefinition, "noteTemplate"> | undefined,
): ProcedureForm {
  const untouched = form.notes.trim() === "" || form.notes === (previous?.noteTemplate ?? "");
  return {
    ...form,
    definitionId: definition?.id ?? "",
    requiresBodySite: definition?.requiresBodySite ?? false,
    consentRequired: definition?.consentRequired ?? false,
    consentGiven: form.consentGiven || (definition?.consentRequired ?? false),
    consentWordingId: definition?.consentWording?.id ?? "",
    notes: untouched ? (definition?.noteTemplate ?? "") : form.notes,
  };
}

/** "SUT-S · Suture repair, simple". */
export function definitionLabel(d: Pick<ProcedureDefinition, "code" | "name">): string {
  return `${d.code} · ${d.name}`;
}

export const definitionFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/, "Code: letters, digits, dots, hyphens or underscores (up to 30)"),
    name: z.string().trim().min(2, "Name the procedure").max(200),
    codeSystem: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || /^[a-z0-9][a-z0-9._-]{0,39}$/.test(v), "Code system: lower-case letters, digits, dots, hyphens or underscores"),
    externalCode: optional(40),
    requiresBodySite: z.boolean(),
    consentRequired: z.boolean(),
    allowedOutsideConsultation: z.boolean(),
    noteTemplate: optional(2000),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.codeSystem) !== Boolean(v.externalCode))
      ctx.addIssue({ code: "custom", message: "Give the other code with its code system (or neither)", path: ["externalCode"] });
  });
export type DefinitionForm = z.input<typeof definitionFormSchema>;

export const BLANK_DEFINITION_FORM: DefinitionForm = {
  code: "",
  name: "",
  codeSystem: "",
  externalCode: "",
  requiresBodySite: false,
  consentRequired: false,
  allowedOutsideConsultation: false,
  noteTemplate: "",
};

/** A new version of the organization's consent wording for a catalogue entry. */
export const consentWordingFormSchema = z.object({
  title: z.string().trim().min(2, "Give the wording a title").max(200),
  body: z.string().trim().min(20, "Write the wording the patient is shown (at least 20 characters)").max(8000),
});
export type ConsentWordingForm = z.input<typeof consentWordingFormSchema>;
