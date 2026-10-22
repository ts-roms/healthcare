"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { TelemedicineSetting } from "@/lib/api/types";

// The API validates and authorizes (clinic.configure) and audits the change; shapes are checked here to fail fast.
const schema = z.object({ paymentRequired: z.boolean(), version: z.number().int().min(0) });

export async function saveTelemedicineSetting(input: z.input<typeof schema>): Promise<ActionResult<TelemedicineSetting>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the setting." };
  const result = await actionResult(() => api<TelemedicineSetting>("/telemedicine/settings", { method: "PUT", body: parsed.data }));
  revalidatePath("/telemedicine/settings");
  return result;
}
