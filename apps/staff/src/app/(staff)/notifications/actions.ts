"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { StaffPushStatus } from "@/lib/api/types";

/** This browser's push status: whether it is registered (by its push address), and the member's browsers. */
export async function pushStatus(endpoint?: string): Promise<ActionResult<StaffPushStatus>> {
  return actionResult(() => api<StaffPushStatus>("/me/push", endpoint ? { query: { endpoint } } : {}));
}

/** Registers this browser (the API limits browsers and needs the platform's push key). */
export async function registerPushDevice(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<ActionResult<{ id: string; label: string }>> {
  const result = await actionResult(() => api<{ id: string; label: string }>("/me/push/subscriptions", { method: "POST", body: subscription }));
  if (result.ok) revalidatePath("/notifications");
  return result;
}

export async function removePushDevice(id: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Unknown browser." };
  const result = await actionResult(async () => {
    await api<void>(`/me/push/subscriptions/${id}/remove`, { method: "POST" });
    return null;
  });
  if (result.ok) revalidatePath("/notifications");
  return result;
}

export async function sendTestPush(): Promise<ActionResult<{ status: string }>> {
  return actionResult(() => api<{ status: string }>("/me/push/test", { method: "POST" }));
}

export async function markNoticeRead(notificationId: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(notificationId).success) return { ok: false, message: "Invalid message." };
  return actionResult(async () => {
    await api<void>(`/me/notifications/${notificationId}/read`, { method: "POST" });
    return null;
  });
}
