import { ApiError } from "./api-error";
import type { PushDevice, PushStatus } from "./api-types";

/** What push needs of the session: authenticated GET and POST (`PatientSession`, or a fake in tests). */
export interface PushApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

/** What the operating system and Expo provide; faked in tests. */
export interface PushPlatform {
  /** False in Expo Go: since SDK 53 it cannot receive remote notifications; a development or store build is needed. */
  pushAvailable: boolean;
  /** A real phone or tablet (push does not work in a simulator). */
  isPhysicalDevice: boolean;
  os: "ios" | "android";
  deviceName: string | null;
  permission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied">;
  /** The Expo push token of this installation. */
  token(): Promise<string>;
}

export type PushState =
  { kind: "unavailable"; reason: "not_offered" | "simulator" | "expo_go" } | { kind: "off"; canAsk: boolean } | { kind: "on"; deviceId: string };

/** Whether this phone receives notifications now: offered by the clinic's platform, allowed on the phone, and registered. */
export async function pushState(api: PushApi, platform: PushPlatform): Promise<{ state: PushState; devices: PushDevice[] }> {
  if (!platform.pushAvailable) return { state: { kind: "unavailable", reason: "expo_go" }, devices: [] };
  if (!platform.isPhysicalDevice) return { state: { kind: "unavailable", reason: "simulator" }, devices: [] };
  const permission = await platform.permission();
  const token = permission === "granted" ? await platform.token().catch(() => null) : null;
  const status = await api.get<PushStatus>(`/portal/push${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  if (!status.mobileConfigured) return { state: { kind: "unavailable", reason: "not_offered" }, devices: status.devices };
  if (status.thisDeviceId) return { state: { kind: "on", deviceId: status.thisDeviceId }, devices: status.devices };
  return { state: { kind: "off", canAsk: permission !== "denied" }, devices: status.devices };
}

export type EnableResult =
  { ok: true; deviceId: string } | { ok: false; reason: "denied" | "simulator" | "expo_go" | "too_many_devices" | "not_offered" | "failed"; message?: string };

/** Asks the phone's permission if needed, then registers this installation's token with the clinic's platform. */
export async function enablePush(api: PushApi, platform: PushPlatform): Promise<EnableResult> {
  if (!platform.pushAvailable) return { ok: false, reason: "expo_go" };
  if (!platform.isPhysicalDevice) return { ok: false, reason: "simulator" };
  let permission = await platform.permission();
  if (permission !== "granted") permission = await platform.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  try {
    const device = await api.post<PushDevice>("/portal/push/mobile-devices", {
      token: await platform.token(),
      platform: platform.os,
      ...(platform.deviceName ? { deviceName: platform.deviceName.slice(0, 60) } : {}),
    });
    return { ok: true, deviceId: device.id };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "too_many_push_devices") return { ok: false, reason: "too_many_devices", message: error.message };
      if (error.code === "push_not_available") return { ok: false, reason: "not_offered" };
      return { ok: false, reason: "failed", message: error.message };
    }
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : undefined };
  }
}

/** Stops notifications on one device (this phone, or another one the patient no longer uses). */
export async function removeDevice(api: PushApi, deviceId: string): Promise<void> {
  await api.post(`/portal/push/subscriptions/${deviceId}/remove`);
}

/** Before signing out: this phone stops receiving the patient's notices. Failing to reach the API must not block signing out. */
export async function unregisterThisPhone(api: PushApi, platform: PushPlatform): Promise<void> {
  try {
    if (!platform.pushAvailable || !platform.isPhysicalDevice || (await platform.permission()) !== "granted") return;
    const { state } = await pushState(api, platform);
    if (state.kind === "on") await removeDevice(api, state.deviceId);
  } catch {
    // Signing out comes first; the clinic's platform drops a token that stops working.
  }
}

/** Shown when the app runs in Expo Go (development only): notifications need a development or store build. */
export const EXPO_GO_MESSAGE = "Notifications don't work in Expo Go. Install a development build of MyHealth to try them.";

/** Plain words for why notifications could not be turned on. */
export function enableMessage(result: Extract<EnableResult, { ok: false }>): string {
  switch (result.reason) {
    case "denied":
      return "Notifications are blocked for MyHealth on this phone. Turn them on in the phone's settings, then try again.";
    case "simulator":
      return "Notifications work only on a real phone.";
    case "expo_go":
      return EXPO_GO_MESSAGE;
    case "too_many_devices":
      return "Notifications are already on for 5 devices. Remove one below first.";
    case "not_offered":
      return "Your clinic has not turned on notifications for the app yet.";
    default:
      return result.message ?? "Could not turn on notifications. Try again.";
  }
}
