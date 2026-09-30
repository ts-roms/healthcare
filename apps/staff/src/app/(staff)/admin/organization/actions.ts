"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Organization } from "@/lib/api/types";

// Checked here only to fail fast; the API validates, authorizes and audits the change.
const schema = z.object({
  name: z.string().trim().min(1, "Enter the organization's name.").max(200, "Use at most 200 characters."),
  version: z.number().int().positive(),
});

export async function renameOrganization(input: { name: string; version: number }): Promise<ActionResult<Organization>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the name." };
  const result = await actionResult(() => api<Organization>("/organization", { method: "PATCH", body: parsed.data }));
  revalidatePath("/admin/organization");
  return result;
}
