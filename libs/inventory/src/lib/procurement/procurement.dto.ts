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

/** The organization's own procurement method and the reference it asks for (0073; checked when the order is submitted). */
const procurementMethodId = z.uuid().nullable().default(null);
const procurementReference = z.string().trim().min(1).max(80).nullable().default(null);

export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  /** The delivery location (a location of the selected facility). */
  locationId: z.uuid(),
  expectedDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional(),
  procurementMethodId,
  procurementReference,
  lines: orderLines,
});
export class CreatePurchaseOrderDto extends createZodDto(createPurchaseOrderSchema) {}

/** A draft is edited as a whole: the lines given replace the draft's lines. */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  locationId: z.uuid(),
  expectedDate: isoDate.nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  procurementMethodId,
  procurementReference,
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

// ---- Supplier invoices (migration 0061) -----------------------------------------------------------------------------

export const recordSupplierInvoiceSchema = z.object({
  /** The supplier's invoice number, as printed. */
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: isoDate,
  dueDate: isoDate.optional(),
  /** Centavos, as stated on the invoice. */
  vatAmount: z.number().int().min(0).max(100_000_000_00).default(0),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.uuid(),
        /** In the item's stock unit; never more than received and not yet invoiced. */
        quantity: z.number().int().positive().max(1_000_000),
        /** Centavos per stock unit, as invoiced. */
        unitPrice: z.number().int().min(0).max(100_000_000_00),
      }),
    )
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((l) => l.purchaseOrderLineId)).size === lines.length, "Each order line appears once on an invoice"),
});
export class RecordSupplierInvoiceDto extends createZodDto(recordSupplierInvoiceSchema) {}

export const approveSupplierInvoiceSchema = z.object({
  version,
  /** Required when an invoiced price differs from the order. */
  note: z.string().trim().min(3).max(500).optional(),
});
export class ApproveSupplierInvoiceDto extends createZodDto(approveSupplierInvoiceSchema) {}

export const paySupplierInvoiceSchema = z.object({
  version,
  paidOn: isoDate,
  /** Check number, bank transfer reference or official receipt. */
  paymentReference: z.string().trim().min(1).max(80),
  /**
   * What was withheld from the payment, as the organization's accountant determines it (0073): the organization's own
   * code, the amount in centavos (entered, never computed) and the reference of the certificate given to the supplier.
   */
  withholding: z
    .object({
      codeId: z.uuid(),
      amount: z.number().int().positive().max(100_000_000_00),
      reference: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
});
export class PaySupplierInvoiceDto extends createZodDto(paySupplierInvoiceSchema) {}

export const voidSupplierInvoiceSchema = z.object({ version, reason });
export class VoidSupplierInvoiceDto extends createZodDto(voidSupplierInvoiceSchema) {}

export const supplierInvoiceQuerySchema = z.object({
  /** "open": recorded or approved (not paid); "overdue": open and past the due date. */
  status: z.enum(["open", "overdue", "recorded", "approved", "paid", "void"]).optional(),
  purchaseOrderId: z.uuid().optional(),
});
export class SupplierInvoiceQueryDto extends createZodDto(supplierInvoiceQuerySchema) {}

export const valuationQuerySchema = z.object({ locationId: z.uuid().optional() });
export class ValuationQueryDto extends createZodDto(valuationQuerySchema) {}

export const usageQuerySchema = z.object({ from: isoDate, to: isoDate, locationId: z.uuid().optional() });
export class UsageQueryDto extends createZodDto(usageQuerySchema) {}

// ---- Compliance configuration (migration 0073) -----------------------------------------------------------------------

export const createWithholdingCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  description: z.string().trim().min(3).max(200),
  /** For reference on screens (basis points: 100 = 1%); the withheld amount is always entered by staff. */
  rateBasisPoints: z.number().int().min(0).max(10_000).nullable().default(null),
});
export class CreateWithholdingCodeDto extends createZodDto(createWithholdingCodeSchema) {}

export const createProcurementMethodSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(3).max(120),
  /** What reference an order under this method needs (e.g. "Posting reference"); none when left out. */
  referenceLabel: z.string().trim().min(3).max(60).nullable().default(null),
});
export class CreateProcurementMethodDto extends createZodDto(createProcurementMethodSchema) {}

export const controlledRegisterSettingSchema = z.object({
  /** The facility's licence or registration reference for controlled items, as issued (not verified). */
  licenceReference: z.string().trim().min(1).max(80).nullable().default(null),
  /** The person responsible for the register, with their licence number as they write it. */
  responsiblePerson: z.string().trim().min(2).max(160).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
  /** 0 when never set. */
  version: z.number().int().min(0),
});
export class ControlledRegisterSettingDto extends createZodDto(controlledRegisterSettingSchema) {}

export const controlledRegisterQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    itemId: z.uuid().optional(),
    locationId: z.uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: "The period ends before it starts", path: ["to"] });
export class ControlledRegisterQueryDto extends createZodDto(controlledRegisterQuerySchema) {}
