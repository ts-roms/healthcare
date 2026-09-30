"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run } from "@/lib/api/result";
import type { PortalPreferences } from "@/lib/api/types";
import type { changedChoices } from "@/lib/notification-settings";

/** Saves the patient's changed choices (the API accepts text messages and email only, and re-checks the session). */
export async function saveNotificationSettings(choices: ReturnType<typeof changedChoices>): Promise<Result<PortalPreferences>> {
  if (choices.length === 0) return { ok: false, message: "Nothing has changed." };
  const result = await run(() => portalApi<PortalPreferences>("/portal/communication-preferences", { method: "PUT", body: { preferences: choices } }));
  if (result.ok) revalidatePath("/notification-settings");
  return result;
}
