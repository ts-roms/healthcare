import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PushPlatform } from "./push";

/** How a notice looks while the app is open: shown, quietly. */
export function configureForegroundNotices(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", { name: "MyHealth", importance: Notifications.AndroidImportance.DEFAULT });
}

/** The operating system's side of push, for `lib/push.ts`. */
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
    const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas;
    const projectId = eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error("This build has no Expo project id (EAS_PROJECT_ID), so it cannot receive notifications.");
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  },
};
