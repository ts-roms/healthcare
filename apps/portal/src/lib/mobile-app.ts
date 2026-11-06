/**
 * The MyHealth app's links for this deployment (one organization per deployment): `MOBILE_APP_IOS_URL` (App Store)
 * and `MOBILE_APP_ANDROID_URL` (Google Play, or an https link to an APK signed by EAS with the organization's key; a path
 * is still resolved against the site's address so the QR code carries a full link, but no APK is kept in this repository). Absolute links
 * must be http(s); anything else is ignored.
 */
export interface StoreLink {
  key: "ios" | "android";
  label: string;
  href: string;
}

function url(value: string | undefined, origin: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = trimmed.startsWith("/") && origin ? new URL(trimmed, origin) : new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A direct APK download rather than a store listing. */
export function isApk(href: string): boolean {
  return /\.apk(\?|#|$)/i.test(href);
}

/** `origin` is this site's own address (`PORTAL_BASE_URL`, else the request's), for paths in its public folder. */
export function storeLinks(env: Record<string, string | undefined>, origin: string | null = null): StoreLink[] {
  const ios = url(env.MOBILE_APP_IOS_URL, origin);
  const android = url(env.MOBILE_APP_ANDROID_URL, origin);
  return [
    ...(ios ? [{ key: "ios" as const, label: "App Store", href: ios }] : []),
    ...(android ? [{ key: "android" as const, label: isApk(android) ? "Android app (APK)" : "Google Play", href: android }] : []),
  ];
}
