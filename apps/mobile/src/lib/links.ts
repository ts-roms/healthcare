/**
 * A push payload names where the notice leads as a path of the web MyHealth (`/messages/…`, `/results`). The app shows
 * notices itself and opens the web MyHealth for the rest. Only plain relative paths are followed: never another site.
 */
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/;

export function portalLink(portalUrl: string | null, href: string | undefined | null): string | null {
  if (!portalUrl || !href || !SAFE_PATH.test(href)) return null;
  return `${portalUrl.replace(/\/+$/, "")}${href}`;
}

/** The `data.url` of a received push message, if it is a string. */
export function hrefFromPushData(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const url = (data as Record<string, unknown>)["url"];
  return typeof url === "string" ? url : null;
}
