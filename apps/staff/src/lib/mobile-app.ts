/**
 * Where patients get MyHealth on a phone, per deployment (one organization per deployment, its own store listings):
 * `MOBILE_APP_IOS_URL` (App Store), `MOBILE_APP_ANDROID_URL` (Google Play, or an APK the organization serves itself:
 * a path such as `/downloads/myhealth.apk` under MyHealth's `public` folder, resolved against `PORTAL_BASE_URL`) and
 * `PORTAL_BASE_URL` (MyHealth on the web, used as the code while no app link is set). Absolute links must be http(s);
 * anything else is ignored.
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

function url(value: string | undefined, base?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = trimmed.startsWith("/") && base ? new URL(trimmed, base) : new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A direct APK download rather than a store listing. */
export function isApk(href: string): boolean {
  return /\.apk(\?|#|$)/i.test(href);
}

/** Outside production, MyHealth runs beside the staff app on this port unless `PORTAL_BASE_URL` says otherwise. */
const DEVELOPMENT_PORTAL_URL = "http://localhost:3001";

export function mobileAppLinks(env: Record<string, string | undefined>): MobileAppLinks {
  const web = url(env.PORTAL_BASE_URL) ?? (env.NODE_ENV === "production" ? null : DEVELOPMENT_PORTAL_URL);
  return { ios: url(env.MOBILE_APP_IOS_URL, web), android: url(env.MOBILE_APP_ANDROID_URL, web), web };
}

/** The codes to show: the store links when set; otherwise MyHealth on the web, if known; otherwise nothing. */
export function downloadLinks(links: MobileAppLinks): DownloadLink[] {
  const stores: DownloadLink[] = [
    ...(links.ios ? [{ key: "ios" as const, label: "App Store", href: links.ios }] : []),
    ...(links.android ? [{ key: "android" as const, label: isApk(links.android) ? "Android app (APK)" : "Google Play", href: links.android }] : []),
  ];
  if (stores.length > 0) return stores;
  return links.web ? [{ key: "web", label: "MyHealth on the web", href: links.web }] : [];
}
