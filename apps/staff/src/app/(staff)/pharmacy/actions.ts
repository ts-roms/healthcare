"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (active prescription, stock, quantities).

const dispenseSchema = z.object({
  prescriptionId: z.uuid(),
  lines: z
    .array(
      z.object({ prescriptionItemId: z.uuid(), inventoryItemId: z.uuid(), locationId: z.uuid(), quantity: z.number().int().positive("Enter a quantity.") }),
    )
    .min(1, "Choose what to hand over."),
  note: z.string().trim().max(500).optional(),
});

export async function dispense(input: z.input<typeof dispenseSchema>): Promise<ActionResult<unknown>> {
  const parsed = dispenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { prescriptionId, ...body } = parsed.data;
  const result = await actionResult(() => api(`/dispensing/prescriptions/${prescriptionId}/dispenses`, { method: "POST", body }));
  if (result.ok) revalidatePath("/pharmacy", "layout");
  return result;
}

const reverseSchema = z.object({ dispenseId: z.uuid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) });

export async function reverseDispense(input: z.input<typeof reverseSchema>): Promise<ActionResult<unknown>> {
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() =>
    api(`/dispensing/dispenses/${parsed.data.dispenseId}/reverse`, { method: "POST", body: { reason: parsed.data.reason } }),
  );
  if (result.ok) revalidatePath("/pharmacy", "layout");
  return result;
}
