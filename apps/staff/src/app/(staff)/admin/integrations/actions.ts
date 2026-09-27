"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ExchangeReviewItem } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const idSchema = z.object({ exchangeId: z.uuid() });
const resolveSchema = z.object({ exchangeId: z.uuid(), note: z.string().trim().min(3, "Say what was done (at least 3 characters).").max(500) });

export async function requeueExchange(input: z.input<typeof idSchema>) {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid request." };
  const result = await actionResult(() => api<ExchangeReviewItem>(`/integrations/exchanges/${parsed.data.exchangeId}/requeue`, { method: "POST" }));
  if (result.ok) revalidatePath("/admin/integrations");
  return result;
}

export async function resolveExchange(input: z.input<typeof resolveSchema>) {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() =>
    api<ExchangeReviewItem>(`/integrations/exchanges/${parsed.data.exchangeId}/resolve`, { method: "POST", body: { note: parsed.data.note } }),
  );
  if (result.ok) revalidatePath("/admin/integrations");
  return result;
}
