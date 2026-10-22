"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { StaffTourSetting } from "@/lib/api/types";

// The API validates and authorizes (organization.manage) and audits the change; shapes are checked here to fail fast.
const schema = z.object({ enabled: z.boolean(), version: z.number().int().min(0) });

export async function saveTourSetting(input: z.input<typeof schema>): Promise<ActionResult<StaffTourSetting>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the setting." };
  const result = await actionResult(() => api<StaffTourSetting>("/organization/tour-setting", { method: "PUT", body: parsed.data }));
  // Every staff page decides from this in its layout.
  revalidatePath("/", "layout");
  return result;
}
