/**
 * Where patients get MyHealth on a phone, per deployment (one organization per deployment, its own store listings):
 * `MOBILE_APP_IOS_URL` (App Store), `MOBILE_APP_ANDROID_URL` (Google Play) and `PORTAL_BASE_URL` (MyHealth on the
 * web, used as the code while no store link is set). Each must be an http(s) URL; anything else is ignored.
 */
export interface MobileAppLinks {
  ios: string | null;
  android: string | null;
  web: string | null;
}

export interface DownloadLink {
  key: "ios" | "android" | "web";
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

export function mobileAppLinks(env: Record<string, string | undefined>): MobileAppLinks {
  return { ios: url(env.MOBILE_APP_IOS_URL), android: url(env.MOBILE_APP_ANDROID_URL), web: url(env.PORTAL_BASE_URL) };
}

/** The codes to show: the store links when set; otherwise MyHealth on the web, if known; otherwise nothing. */
export function downloadLinks(links: MobileAppLinks): DownloadLink[] {
  const stores: DownloadLink[] = [
    ...(links.ios ? [{ key: "ios" as const, label: "App Store", href: links.ios }] : []),
    ...(links.android ? [{ key: "android" as const, label: "Google Play", href: links.android }] : []),
  ];
  if (stores.length > 0) return stores;
  return links.web ? [{ key: "web", label: "MyHealth on the web", href: links.web }] : [];
}
