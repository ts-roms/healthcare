"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";

export async function markNoticeRead(notificationId: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(notificationId).success) return { ok: false, message: "Invalid message." };
  return actionResult(async () => {
    await api<void>(`/me/notifications/${notificationId}/read`, { method: "POST" });
    return null;
  });
}
