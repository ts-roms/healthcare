"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { LabOrderSet } from "@/lib/api/types";

// The API checks the tests and panels, the triggers and the version, authorizes (lab.catalog.manage) and audits.
const item = z.union([z.object({ testId: z.uuid() }), z.object({ panelId: z.uuid() })]);
const trigger = z.union([
  z.object({ kind: z.literal("diagnosis_code"), value: z.string().min(1).max(40), codeSystemKey: z.string().min(1).max(60).optional() }),
  z.object({ kind: z.literal("visit_type"), value: z.string().min(1).max(40) }),
]);
const fields = z.object({
  name: z.string().trim().min(1, "Give the set a name.").max(120),
  note: z.string().trim().max(500).optional(),
  items: z.array(item).min(1, "Choose at least one test or panel.").max(60),
  triggers: z.array(trigger).max(20),
});
const createSchema = fields.extend({ code: z.string().trim().min(2, "Give the set a short code.").max(49) });
const updateSchema = fields.extend({ id: z.uuid(), status: z.enum(["active", "inactive"]), version: z.number().int().positive() });

function firstProblem(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the order set.";
}

export async function createOrderSet(input: z.input<typeof createSchema>): Promise<ActionResult<LabOrderSet>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstProblem(parsed.error) };
  const { note, ...rest } = parsed.data;
  const result = await actionResult(() => api<LabOrderSet>("/laboratory/order-sets", { method: "POST", body: { ...rest, ...(note ? { note } : {}) } }));
  if (result.ok) revalidatePath("/laboratory/order-sets");
  return result;
}

export async function updateOrderSet(input: z.input<typeof updateSchema>): Promise<ActionResult<LabOrderSet>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstProblem(parsed.error) };
  const { id, note, ...rest } = parsed.data;
  const result = await actionResult(() => api<LabOrderSet>(`/laboratory/order-sets/${id}`, { method: "PUT", body: { ...rest, ...(note ? { note } : {}) } }));
  revalidatePath("/laboratory/order-sets");
  return result;
}
