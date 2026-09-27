"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";

/** Marks messages read once the patient has seen them (updates the navigation badge). */
export async function markMessagesRead(ids: string[]): Promise<Result<null>> {
  const valid = ids.filter((id) => UUID.test(id)).slice(0, 100);
  const result = await run(async () => {
    for (const id of valid) await portalApi<void>(`/portal/messages/${id}/read`, { method: "POST" });
    return null;
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
