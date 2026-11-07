import { isIP } from "node:net";
import { z } from "zod";

/**
 * A Web Push endpoint is a URL the server later POSTs to, chosen by whoever registers the browser, so it must be one of
 * the browsers' own push services and nothing else (zero trust, S6): https on the default port, no credentials, and a
 * host of a known push service (PUSH_SERVICE_HOSTS). Anything else — an address, `localhost`, an internal name, or any
 * other public host — is refused at registration and again at sending, so the API cannot be pointed at an internal
 * service (or a name that resolves to one) through a push subscription.
 */
const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".railway.internal"];

/**
 * The push services of the browsers MyHealth and the staff app support: Chrome, Edge and other Chromium browsers (Firebase
 * Cloud Messaging), Firefox (Mozilla), Safari (Apple) and Windows (WNS). A host matches exactly or as a subdomain of a
 * suffix entry (leading dot). A new browser's service is added here, with its documentation as the source.
 */
export const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
] as const;

function isPushServiceHost(host: string): boolean {
  return PUSH_SERVICE_HOSTS.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) && host.length > entry.length : host === entry));
}

export function isPublicPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || isIP(host.replace(/^\[|\]$/g, "")) !== 0) return false;
  if (host === "localhost" || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return isPushServiceHost(host);
}

/** The `endpoint` of a browser's push subscription. */
export const webPushEndpointSchema = z.url().max(2048).startsWith("https://").refine(isPublicPushEndpoint, "Not a browser push service address");
