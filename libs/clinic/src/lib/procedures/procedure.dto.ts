import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

// ---- the procedure catalogue (clinic.configure) --------------------------------------------------------------

const codeSystemKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "Use lower-case letters, digits, dots, hyphens or underscores");

export const createProcedureDefinitionSchema = z
  .object({
    /** The organization's own code (billing maps a service to it). */
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/, "Use letters, digits, dots, hyphens or underscores (up to 30)"),
    name: z.string().trim().min(2, "Name the procedure").max(200),
    /** A code of a code system the organization names (e.g. its own key for an RVS edition); none is assumed. */
    codeSystem: codeSystemKey.optional(),
    externalCode: text(40).optional(),
    requiresBodySite: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.codeSystem) === Boolean(v.externalCode), { message: "Give the code with its code system", path: ["externalCode"] });
export class CreateProcedureDefinitionDto extends createZodDto(createProcedureDefinitionSchema) {}

/** The code never changes (billing and records refer to it); retire an entry and add another instead. */
export const updateProcedureDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  codeSystem: codeSystemKey.nullable().optional(),
  externalCode: text(40).nullable().optional(),
  requiresBodySite: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  version: z.number().int().positive(),
});
export class UpdateProcedureDefinitionDto extends createZodDto(updateProcedureDefinitionSchema) {}

export const procedureDefinitionListQuery = z.object({ includeInactive: z.enum(["true", "false"]).optional() });
export class ProcedureDefinitionListQueryDto extends createZodDto(procedureDefinitionListQuery) {}

// ---- procedures performed -------------------------------------------------------------------------------------

export const recordProcedureSchema = z.object({
  definitionId: z.uuid(),
  /** When it was performed; now when left out. */
  performedAt: z.iso.datetime({ offset: true }).optional(),
  /** Who performed it (an active practitioner of the organization); the recorder's own practitioner record when left out. */
  performerPractitionerId: z.uuid().optional(),
  /** As written (e.g. "left forearm"). */
  bodySite: text(120).optional(),
  /** How many were done; the quantity billed. */
  quantity: z.number().int().min(1).max(99).default(1),
  notes: text(2000).optional(),
  /** Required once the consultation is signed (with encounter.amend). */
  lateEntryReason: z.string().trim().min(3, "Say why it is recorded after signing").max(500).optional(),
});
export class RecordProcedureDto extends createZodDto(recordProcedureSchema) {}

export const procedureInErrorSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
export class ProcedureInErrorDto extends createZodDto(procedureInErrorSchema) {}
