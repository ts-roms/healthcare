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

// ---- supplies used, from inventory (migration 0089) -------------------------------------------------------------

const supplyQuantity = z.number().int().min(1).max(1000);
const idempotencyKey = z.string().trim().min(8).max(100);
const supplyReference = z.string().trim().min(1).max(80);

export const procedureSupplyTemplateSchema = z.object({
  /** The supplies this procedure usually uses, in order; an empty list clears the template. */
  items: z.array(z.object({ itemId: z.uuid(), quantity: supplyQuantity })).max(30),
});
export class ProcedureSupplyTemplateDto extends createZodDto(procedureSupplyTemplateSchema) {}

export const recordProcedureSuppliesSchema = z.object({
  /** A stock location of the procedure's facility (the selected facility). */
  locationId: z.uuid(),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: supplyQuantity,
        /** Required with the reference for a controlled item (inventory enforces it). */
        reason: z.string().trim().min(3).max(500).optional(),
        reference: supplyReference.optional(),
      }),
    )
    .min(1)
    .max(30),
  idempotencyKey,
});
export class RecordProcedureSuppliesDto extends createZodDto(recordProcedureSuppliesSchema) {}

export const returnProcedureSuppliesSchema = z.object({
  /** Issued lines of this procedure and how much of each comes back unused. */
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity: supplyQuantity }))
    .min(1)
    .max(60),
  reason: z.string().trim().min(3).max(500),
  /** Required for a controlled item (inventory enforces it). */
  reference: supplyReference.optional(),
  idempotencyKey,
});
export class ReturnProcedureSuppliesDto extends createZodDto(returnProcedureSuppliesSchema) {}
