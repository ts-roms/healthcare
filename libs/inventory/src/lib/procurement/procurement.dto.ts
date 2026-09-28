import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PURCHASE_ORDER_STATUSES } from "../inventory.schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const version = z.number().int().positive();
const reason = z.string().trim().min(5).max(500);

const orderLines = z
  .array(
    z.object({
      itemId: z.uuid(),
      /** In the item's stock unit. */
      quantity: z.number().int().positive().max(1_000_000),
      /** Centavos per stock unit, as agreed with the supplier. */
      unitCost: z.number().int().min(0).max(100_000_000_00).nullable().default(null),
    }),
  )
  .min(1)
  .max(200)
  .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, "Each item appears once on an order");

export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  /** The delivery location (a location of the selected facility). */
  locationId: z.uuid(),
  expectedDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: orderLines,
});
export class CreatePurchaseOrderDto extends createZodDto(createPurchaseOrderSchema) {}

/** A draft is edited as a whole: the lines given replace the draft's lines. */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  locationId: z.uuid(),
  expectedDate: isoDate.nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  lines: orderLines,
  version,
});
export class UpdatePurchaseOrderDto extends createZodDto(updatePurchaseOrderSchema) {}

export const purchaseOrderVersionSchema = z.object({ version });
export class PurchaseOrderVersionDto extends createZodDto(purchaseOrderVersionSchema) {}

export const endPurchaseOrderSchema = z.object({ reason, version });
export class EndPurchaseOrderDto extends createZodDto(endPurchaseOrderSchema) {}

export const receivePurchaseOrderSchema = z.object({
  /** The supplier's delivery receipt or invoice number. */
  reference: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(3).max(500).optional(),
  lines: z
    .array(
      z
        .object({
          lineId: z.uuid(),
          quantity: z.number().int().positive().max(1_000_000),
          lotNumber: z.string().trim().min(1).max(60).optional(),
          expiryDate: isoDate.optional(),
        })
        .refine((v) => !v.expiryDate || v.lotNumber, { message: "An expiry date belongs to a lot number", path: ["lotNumber"] }),
    )
    .min(1)
    .max(200),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export class ReceivePurchaseOrderDto extends createZodDto(receivePurchaseOrderSchema) {}

export const purchaseOrderQuerySchema = z.object({
  status: z.enum([...PURCHASE_ORDER_STATUSES, "open"]).optional(),
});
export class PurchaseOrderQueryDto extends createZodDto(purchaseOrderQuerySchema) {}

export const reorderSuggestionQuerySchema = z.object({ locationId: z.uuid().optional() });
export class ReorderSuggestionQueryDto extends createZodDto(reorderSuggestionQuerySchema) {}
