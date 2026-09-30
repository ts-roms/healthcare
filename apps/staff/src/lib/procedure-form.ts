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
  })
  .superRefine((v, ctx) => {
    if (v.requiresBodySite && !v.bodySite) ctx.addIssue({ code: "custom", message: "Say where it was done", path: ["bodySite"] });
    if (v.signed && v.lateEntryReason.length < 3)
      ctx.addIssue({ code: "custom", message: "The consultation is signed: say why the procedure is recorded now", path: ["lateEntryReason"] });
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
};

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
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.codeSystem) !== Boolean(v.externalCode))
      ctx.addIssue({ code: "custom", message: "Give the other code with its code system (or neither)", path: ["externalCode"] });
  });
export type DefinitionForm = z.input<typeof definitionFormSchema>;

export const BLANK_DEFINITION_FORM: DefinitionForm = { code: "", name: "", codeSystem: "", externalCode: "", requiresBodySite: false };
