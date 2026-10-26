"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { StaffNotice, StaffPushStatus } from "@/lib/api/types";

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

/** Turns kinds of notice off or on in the member's browsers (the in-app notice is unaffected). */
export async function savePushPreferences(
  preferences: Array<{ kind: string; enabled: boolean }>,
): Promise<ActionResult<{ preferences: StaffPushStatus["preferences"] }>> {
  const parsed = z
    .array(z.object({ kind: z.string().regex(/^[a-z_]{1,40}$/), enabled: z.boolean() }))
    .min(1)
    .safeParse(preferences);
  if (!parsed.success) return { ok: false, message: "Invalid preferences." };
  const result = await actionResult(() =>
    api<{ preferences: StaffPushStatus["preferences"] }>("/me/push/preferences", { method: "PUT", body: { preferences: parsed.data } }),
  );
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

/** The latest in-app notices for the top bar's dropdown (newest first). */
export async function recentNotices(): Promise<ActionResult<StaffNotice[]>> {
  return actionResult(async () => (await api<StaffNotice[]>("/me/notifications")).slice(0, 10));
}

/** Marks several of the member's own notices read (the API refuses anyone else's). */
export async function markNoticesRead(notificationIds: string[]): Promise<ActionResult<null>> {
  const parsed = z.array(z.uuid()).min(1).max(50).safeParse(notificationIds);
  if (!parsed.success) return { ok: false, message: "Invalid message." };
  return actionResult(async () => {
    for (const id of parsed.data) await api<void>(`/me/notifications/${id}/read`, { method: "POST" });
    return null;
  });
}
