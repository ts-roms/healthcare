"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalPreferences, PortalPushStatus } from "@/lib/api/types";
import type { changedChoices } from "@/lib/notification-settings";

/** Saves the patient's changed choices (the API accepts text messages and email only, and re-checks the session). */
export async function saveNotificationSettings(choices: ReturnType<typeof changedChoices>): Promise<Result<PortalPreferences>> {
  if (choices.length === 0) return { ok: false, message: "Nothing has changed." };
  const result = await run(() => portalApi<PortalPreferences>("/portal/communication-preferences", { method: "PUT", body: { preferences: choices } }));
  if (result.ok) revalidatePath("/notification-settings");
  return result;
}

/** This browser's push status: whether it is registered (by its browser address), and the patient's devices. */
export async function pushStatus(endpoint?: string): Promise<Result<PortalPushStatus>> {
  const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
  return run(() => portalApi<PortalPushStatus>(`/portal/push${query}`));
}

/** Registers this browser (the API limits devices and needs the clinic's push key). */
export async function registerPushDevice(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<Result<{ id: string; label: string }>> {
  const result = await run(() => portalApi<{ id: string; label: string }>("/portal/push/subscriptions", { method: "POST", body: subscription }));
  if (result.ok) revalidatePath("/notification-settings");
  return result;
}

export async function removePushDevice(id: string): Promise<Result<null>> {
  if (!UUID.test(id)) return { ok: false, message: "Unknown device." };
  const result = await run(async () => {
    await portalApi<void>(`/portal/push/subscriptions/${id}/remove`, { method: "POST" });
    return null;
  });
  if (result.ok) revalidatePath("/notification-settings");
  return result;
}

/** Sends a test notification to the patient's devices. */
export async function sendTestPush(): Promise<Result<{ status: string }>> {
  return run(() => portalApi<{ status: string }>("/portal/push/test", { method: "POST" }));
}
