"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (facility, stock, lots).

const id = z.uuid();
const qty = z.number().int().positive("Enter a quantity.");
const key = z.string().min(8).max(100);
const text = (max: number) => z.string().trim().max(max).optional();

async function run<T>(schema: z.ZodType, input: unknown, path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<T>(`/inventory${path}`, { method, body }));
  if (result.ok) {
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    revalidatePath("/inventory/catalog");
    revalidatePath("/inventory/purchase-orders", "layout");
  }
  return result;
}

const receiveSchema = z.object({
  locationId: id,
  itemId: id,
  lotNumber: text(60),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  quantity: qty,
  supplierId: id.optional(),
  unitCost: z.number().int().min(0).optional(),
  reference: text(80),
  reason: text(500),
  idempotencyKey: key,
});
export async function receiveStock(input: z.input<typeof receiveSchema>) {
  return run(receiveSchema, input, "/receipts", input);
}

const issueSchema = z.object({
  locationId: id,
  itemId: id,
  lotId: id.optional(),
  quantity: qty,
  issuedTo: z.string().trim().min(1, "Say who or what it is for.").max(120),
  reference: text(80),
  reason: text(500),
  idempotencyKey: key,
});
export async function issueStock(input: z.input<typeof issueSchema>) {
  return run(issueSchema, input, "/issues", input);
}

const transferSchema = z.object({
  fromLocationId: id,
  toLocationId: id,
  itemId: id,
  lotId: id.optional(),
  quantity: qty,
  reference: text(80),
  reason: text(500),
  idempotencyKey: key,
});
export async function transferStock(input: z.input<typeof transferSchema>) {
  return run(transferSchema, input, "/transfers", input);
}

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);
const adjustSchema = z.object({ locationId: id, lotId: id, countedQuantity: z.number().int().min(0), reason, reference: text(80), idempotencyKey: key });
export async function adjustStock(input: z.input<typeof adjustSchema>) {
  return run(adjustSchema, input, "/adjustments", input);
}

const writeOffSchema = z.object({ locationId: id, lotId: id, quantity: qty, reason, reference: text(80), idempotencyKey: key });
export async function writeOffStock(input: z.input<typeof writeOffSchema>) {
  return run(writeOffSchema, input, "/write-offs", input);
}

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Code: lowercase letters, digits and dashes.");
const itemSchema = z.object({
  code,
  name: z.string().trim().min(1, "Enter the name.").max(160),
  category: z.enum(["medicine", "medical_supply", "reagent", "laboratory_consumable", "dental_supply", "ppe", "other"]),
  stockUnit: z.string().trim().min(1, "Enter the stock unit.").max(40),
  tracksLots: z.boolean(),
  controlled: z.boolean(),
});
export async function createItem(input: z.input<typeof itemSchema>) {
  return run(itemSchema, input, "/items", input);
}

const supplierSchema = z.object({ code, name: z.string().trim().min(1, "Enter the name.").max(160), contact: text(300) });
export async function createSupplier(input: z.input<typeof supplierSchema>) {
  return run(supplierSchema, input, "/suppliers", input);
}

const locationSchema = z.object({ facilityId: id, code, name: z.string().trim().min(1, "Enter the name.").max(120) });
export async function createLocation(input: z.input<typeof locationSchema>) {
  return run(locationSchema, input, "/locations", input);
}

const reorderSchema = z.object({ locationId: id, itemId: id, reorderLevel: z.number().int().min(0), reorderQuantity: z.number().int().positive().nullable() });
export async function setReorderLevel(input: z.input<typeof reorderSchema>) {
  return run(
    reorderSchema,
    input,
    `/locations/${input.locationId}/items/${input.itemId}/reorder-level`,
    { reorderLevel: input.reorderLevel, reorderQuantity: input.reorderQuantity },
    "PUT",
  );
}

// ---- purchase orders ----------------------------------------------------------------------------

const orderSchema = z.object({
  supplierId: z.uuid("Choose a supplier."),
  locationId: z.uuid("Choose where it is delivered."),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: text(2000),
  lines: z
    .array(z.object({ itemId: id, quantity: qty, unitCost: z.number().int().min(0).nullable() }))
    .min(1, "Add at least one item.")
    .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, "Each item appears once on an order."),
});
export async function createPurchaseOrder(input: z.input<typeof orderSchema>) {
  return run<{ id: string }>(orderSchema, input, "/purchase-orders", input);
}

const versionSchema = z.object({ id, version: z.number().int().positive() });
export async function submitPurchaseOrder(input: z.input<typeof versionSchema>) {
  return run(versionSchema, input, `/purchase-orders/${input.id}/submit`, { version: input.version });
}
export async function approvePurchaseOrder(input: z.input<typeof versionSchema>) {
  return run(versionSchema, input, `/purchase-orders/${input.id}/approve`, { version: input.version });
}

const endSchema = versionSchema.extend({
  action: z.enum(["cancel", "close"]),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
});
export async function endPurchaseOrder(input: z.input<typeof endSchema>) {
  return run(endSchema, input, `/purchase-orders/${input.id}/${input.action}`, { reason: input.reason, version: input.version });
}

const deliverySchema = z.object({
  id,
  reference: z.string().trim().min(1, "Enter the delivery receipt number.").max(80),
  lines: z
    .array(
      z.object({
        lineId: id,
        quantity: qty,
        lotNumber: text(60),
        expiryDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .min(1, "Enter what arrived."),
  idempotencyKey: key,
});
export async function receivePurchaseOrder(input: z.input<typeof deliverySchema>) {
  const { id: orderId, ...body } = input;
  return run(deliverySchema, input, `/purchase-orders/${orderId}/receipts`, body);
}
