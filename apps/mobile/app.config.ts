import type { ExpoConfig } from "expo/config";

/**
 * The MyHealth mobile app (docs/architecture/mobile-app.md). One build serves one organization: its API address and code
 * are set at build time (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_ORGANIZATION_CODE`), like the portal's
 * `PORTAL_ORGANIZATION_CODE`. Push needs an Expo project (`EAS_PROJECT_ID`) and, on Android, the organization's own
 * Firebase credentials uploaded to it; nothing here is a secret.
 */
const config: ExpoConfig = {
  name: process.env["MYHEALTH_APP_NAME"] ?? "MyHealth",
  slug: "myhealth",
  scheme: "myhealth",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: process.env["MYHEALTH_IOS_BUNDLE_ID"] ?? "ph.example.myhealth", supportsTablet: false },
  android: { package: process.env["MYHEALTH_ANDROID_PACKAGE"] ?? "ph.example.myhealth" },
  plugins: ["expo-router", "expo-secure-store", ["expo-notifications", { defaultChannel: "default", color: "#0f766e" }]],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: process.env["EAS_PROJECT_ID"] } },
};

export default config;
