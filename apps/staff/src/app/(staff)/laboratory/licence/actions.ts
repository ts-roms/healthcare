"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { LabLicenceOverview } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const licenceSchema = z.object({
  licenceNumber: z.string().trim().min(1, "Enter the licence number.").max(60),
  classification: optional(120),
  issuedBy: optional(160),
  validFrom: z.iso.date("Enter when the licence starts."),
  validUntil: z.iso.date("Enter when the licence ends."),
  headName: optional(160),
  headLicenceNumber: optional(40),
  reminderDays: z.number().int().min(0).max(365),
});

export async function recordLabLicence(input: z.input<typeof licenceSchema>): Promise<ActionResult<LabLicenceOverview>> {
  const parsed = licenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid licence." };
  const result = await actionResult(() => api<LabLicenceOverview>("/laboratory/licence", { method: "POST", body: parsed.data }));
  if (result.ok) {
    revalidatePath("/laboratory/licence");
    revalidatePath("/");
  }
  return result;
}
