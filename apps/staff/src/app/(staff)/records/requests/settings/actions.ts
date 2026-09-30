"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { RecordsRequestSetting } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const settingSchema = z.object({
  responseDays: z.number().int().min(1, "Give at least 1 day.").max(365).nullable(),
  identityCheckRequired: z.boolean(),
  patientNotice: z.string().trim().min(10, "Write at least 10 characters, or leave it empty.").max(1500).nullable(),
  version: z.number().int().min(0),
});

export async function saveRecordsRequestSetting(input: z.input<typeof settingSchema>): Promise<ActionResult<RecordsRequestSetting>> {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const result = await actionResult(() => api<RecordsRequestSetting>("/records-requests/setting", { method: "PUT", body: parsed.data }));
  if (result.ok) revalidatePath("/records/requests", "layout");
  return result;
}
