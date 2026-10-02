type ScreenCaptureModule = typeof import("expo-screen-capture");

/**
 * `expo-screen-capture` (D11). As the module itself states: on Android it sets the FLAG_SECURE window flag (blank recents
 * preview, screenshots and recording refused); on iOS it prevents screen recordings (iOS 11+) and screenshots (iOS 13+).
 * Loaded on first use so a build without the native module still starts; the cover in `components/privacy-cover.tsx`
 * applies either way. Not verified on a device here (D14).
 */
export async function preventScreenCapture(): Promise<boolean> {
  try {
    // A require on first use (not an import) keeps the module from loading when the app starts.
    const screenCapture = require("expo-screen-capture") as ScreenCaptureModule;
    await screenCapture.preventScreenCaptureAsync();
    return true;
  } catch {
    return false;
  }
}
