import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PushPlatform } from "./push";

/** A notice arriving while the app is open is shown as a banner, quietly. */
export function configureForegroundNotices(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", { name: "MyHealth", importance: Notifications.AndroidImportance.DEFAULT });
}

/** The operating system's side of push, for `lib/push.ts`. The Expo project id comes from `eas init` (app.json `extra.eas`). */
export const nativePush: PushPlatform = {
  isPhysicalDevice: Device.isDevice,
  os: Platform.OS === "ios" ? "ios" : "android",
  deviceName: Device.deviceName,
  async permission() {
    return (await Notifications.getPermissionsAsync()).status;
  },
  async requestPermission() {
    await ensureAndroidChannel();
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted" ? "granted" : "denied";
  },
  async token() {
    await ensureAndroidChannel();
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error("This build is not linked to an Expo project (run `eas init`), so it cannot receive notifications.");
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  },
};
