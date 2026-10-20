/**
 * The MyHealth app's store listings for this deployment (one organization per deployment): `MOBILE_APP_IOS_URL`
 * (App Store) and `MOBILE_APP_ANDROID_URL` (Google Play). Each must be an http(s) URL; anything else is ignored.
 */
export interface StoreLink {
  key: "ios" | "android";
  label: string;
  href: string;
}

function url(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function storeLinks(env: Record<string, string | undefined>): StoreLink[] {
  const ios = url(env.MOBILE_APP_IOS_URL);
  const android = url(env.MOBILE_APP_ANDROID_URL);
  return [
    ...(ios ? [{ key: "ios" as const, label: "App Store", href: ios }] : []),
    ...(android ? [{ key: "android" as const, label: "Google Play", href: android }] : []),
  ];
}
