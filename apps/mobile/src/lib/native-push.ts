import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { PushPlatform } from "./push";

type NotificationsModule = typeof import("expo-notifications");

/**
 * Expo Go cannot receive remote notifications (removed in SDK 53), and loading `expo-notifications` there fails on Android — which
 * stopped the whole app from starting. So the module is loaded on first use, and only outside Expo Go (a development or store
 * build); in Expo Go the app runs without notifications and says so.
 */
export const pushAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let loaded: NotificationsModule | undefined;

/** `expo-notifications`, loaded on first use; only call where `pushAvailable` is true. */
export function notifications(): NotificationsModule {
  if (!pushAvailable) throw new Error("Notifications are not available in Expo Go.");
  // A require on first use (not an import) keeps the module from loading when the app starts.
  loaded ??= require("expo-notifications") as NotificationsModule;
  return loaded;
}

/** A notice arriving while the app is open is shown as a banner, quietly. No-op in Expo Go. */
export function configureForegroundNotices(): void {
  if (!pushAvailable) return;
  notifications().setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  const n = notifications();
  await n.setNotificationChannelAsync("default", { name: "MyHealth", importance: n.AndroidImportance.DEFAULT });
}

/** The operating system's side of push, for `lib/push.ts`. The Expo project id comes from `EAS_PROJECT_ID` or `eas init` (app.config.ts → `extra.eas`). */
export const nativePush: PushPlatform = {
  pushAvailable,
  isPhysicalDevice: Device.isDevice,
  os: Platform.OS === "ios" ? "ios" : "android",
  deviceName: Device.deviceName,
  async permission() {
    return (await notifications().getPermissionsAsync()).status;
  },
  async requestPermission() {
    await ensureAndroidChannel();
    const { status } = await notifications().requestPermissionsAsync();
    return status === "granted" ? "granted" : "denied";
  },
  async token() {
    await ensureAndroidChannel();
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error("This build is not linked to an Expo project (run `eas init`), so it cannot receive notifications.");
    return (await notifications().getExpoPushTokenAsync({ projectId })).data;
  },
};
