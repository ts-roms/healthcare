import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ITEM_CATEGORIES } from "./inventory.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Lowercase letters, digits and dashes");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const quantity = z.number().int().positive().max(1_000_000);
const reason = z.string().trim().min(3).max(500);
const reference = z.string().trim().min(1).max(80);
const idempotencyKey = z.string().trim().min(8).max(100);

export const createItemSchema = z.object({
  code,
  name: z.string().trim().min(1).max(160),
  category: z.enum(ITEM_CATEGORIES),
  stockUnit: z.string().trim().min(1).max(40),
  tracksLots: z.boolean().default(true),
  controlled: z.boolean().default(false),
});
export class CreateItemDto extends createZodDto(createItemSchema) {}

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(ITEM_CATEGORIES).optional(),
  controlled: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  version: z.number().int().positive(),
});
export class UpdateItemDto extends createZodDto(updateItemSchema) {}

export const createSupplierSchema = z.object({ code, name: z.string().trim().min(1).max(160), contact: z.string().trim().max(300).optional() });
export class CreateSupplierDto extends createZodDto(createSupplierSchema) {}

export const createLocationSchema = z.object({ facilityId: z.uuid(), code, name: z.string().trim().min(1).max(120) });
export class CreateLocationDto extends createZodDto(createLocationSchema) {}

export const reorderLevelSchema = z.object({ reorderLevel: z.number().int().min(0).max(1_000_000) });
export class ReorderLevelDto extends createZodDto(reorderLevelSchema) {}

export const stockQuerySchema = z.object({
  locationId: z.uuid().optional(),
  show: z.enum(["all", "low", "expiring"]).default("all"),
  /** Days ahead for "expiring" (default 60). */
  withinDays: z.coerce.number().int().min(1).max(365).default(60),
});
export class StockQueryDto extends createZodDto(stockQuerySchema) {}

export const movementsQuerySchema = z.object({ itemId: z.uuid().optional(), locationId: z.uuid().optional() });
export class MovementsQueryDto extends createZodDto(movementsQuerySchema) {}

export const receiveSchema = z
  .object({
    locationId: z.uuid(),
    itemId: z.uuid(),
    lotNumber: z.string().trim().min(1).max(60).optional(),
    expiryDate: isoDate.optional(),
    quantity,
    supplierId: z.uuid().optional(),
    /** Centavos per stock unit, if known. */
    unitCost: z.number().int().min(0).optional(),
    reference: reference.optional(),
    reason: reason.optional(),
    idempotencyKey,
  })
  .refine((v) => !v.expiryDate || v.lotNumber, { message: "An expiry date belongs to a lot number", path: ["lotNumber"] });
export class ReceiveDto extends createZodDto(receiveSchema) {}

export const issueSchema = z.object({
  locationId: z.uuid(),
  itemId: z.uuid(),
  /** A specific lot; otherwise lots are taken first-expiry-first-out. */
  lotId: z.uuid().optional(),
  quantity,
  /** A department or purpose — never a patient identifier. */
  issuedTo: z.string().trim().min(1).max(120),
  reference: reference.optional(),
  reason: reason.optional(),
  idempotencyKey,
});
export class IssueDto extends createZodDto(issueSchema) {}

export const transferSchema = z
  .object({
    fromLocationId: z.uuid(),
    toLocationId: z.uuid(),
    itemId: z.uuid(),
    lotId: z.uuid().optional(),
    quantity,
    reference: reference.optional(),
    reason: reason.optional(),
    idempotencyKey,
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, { message: "Choose another location", path: ["toLocationId"] });
export class TransferDto extends createZodDto(transferSchema) {}

export const adjustSchema = z.object({
  locationId: z.uuid(),
  lotId: z.uuid(),
  /** The physical count; the difference to the recorded balance is posted. */
  countedQuantity: z.number().int().min(0).max(1_000_000),
  reason,
  reference: reference.optional(),
  idempotencyKey,
});
export class AdjustDto extends createZodDto(adjustSchema) {}

export const writeOffSchema = z.object({
  locationId: z.uuid(),
  lotId: z.uuid(),
  quantity,
  reason,
  reference: reference.optional(),
  idempotencyKey,
});
export class WriteOffDto extends createZodDto(writeOffSchema) {}
