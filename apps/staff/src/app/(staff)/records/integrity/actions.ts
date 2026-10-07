"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { IntegrityFinding, IntegrityRun } from "@/lib/api/types";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const runSchema = z.object({ category: z.string().refine((c) => c === "" || c in DOCUMENT_CATEGORY_LABEL, "Choose a category.") });
const resolveSchema = z.object({ findingId: z.string().uuid(), note: z.string().trim().min(5, "Say what was decided (at least 5 characters).").max(500) });

export async function startIntegrityRun(input: { category: string }): Promise<ActionResult<IntegrityRun>> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() =>
    api<IntegrityRun>("/document-integrity/runs", { method: "POST", body: parsed.data.category ? { category: parsed.data.category } : {} }),
  );
  if (result.ok) revalidatePath("/records/integrity");
  return result;
}

export async function cancelIntegrityRun(input: { runId: string }): Promise<ActionResult<IntegrityRun>> {
  if (!z.string().uuid().safeParse(input.runId).success) return { ok: false, message: "Unknown review." };
  const result = await actionResult(() => api<IntegrityRun>(`/document-integrity/runs/${input.runId}/cancel`, { method: "POST" }));
  if (result.ok) revalidatePath("/records/integrity");
  return result;
}

export async function resolveIntegrityFinding(input: { findingId: string; note: string }): Promise<ActionResult<IntegrityFinding>> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid note." };
  const result = await actionResult(() =>
    api<IntegrityFinding>(`/document-integrity/findings/${parsed.data.findingId}/resolve`, { method: "POST", body: { note: parsed.data.note } }),
  );
  if (result.ok) revalidatePath("/records/integrity");
  return result;
}
