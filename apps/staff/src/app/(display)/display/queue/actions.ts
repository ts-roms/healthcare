"use server";

import { unstable_rethrow } from "next/navigation";
import { api } from "@/lib/api/client";

/**
 * The screen tells the API it is showing, so staff can see which waiting-room screens are alive (`/queue/devices`). A screen
 * that was never registered is simply not monitored; a failed report never disturbs the display.
 */
export async function reportDisplayAlive(): Promise<void> {
  try {
    await api<{ registered: boolean }>("/kiosk/display/heartbeat", { method: "POST" });
  } catch (error) {
    unstable_rethrow(error);
  }
}
