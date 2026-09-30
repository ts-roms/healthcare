"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { RetentionOverview } from "@/lib/api/types";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const category = z.string().refine((c) => c in DOCUMENT_CATEGORY_LABEL, "Choose a category.");
const policySchema = z.object({
  category,
  retainYears: z.number().int().min(1, "Keep for at least 1 year.").max(100),
  basisNote: z.string().trim().min(3, "Say where the period comes from.").max(500),
});

export async function setRetentionPolicy(input: z.input<typeof policySchema>): Promise<ActionResult<RetentionOverview>> {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid period." };
  const result = await actionResult(() => api<RetentionOverview>("/document-retention", { method: "PUT", body: parsed.data }));
  if (result.ok) revalidatePath("/records/retention");
  return result;
}

export async function endRetentionPolicy(input: { category: string }): Promise<ActionResult<RetentionOverview>> {
  if (!category.safeParse(input.category).success) return { ok: false, message: "Unknown category." };
  const result = await actionResult(() => api<RetentionOverview>(`/document-retention/${input.category}/end`, { method: "POST" }));
  if (result.ok) revalidatePath("/records/retention");
  return result;
}
