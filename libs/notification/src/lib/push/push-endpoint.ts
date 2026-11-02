import { isIP } from "node:net";
import { z } from "zod";

/**
 * A Web Push endpoint is a URL the server later POSTs to, chosen by whoever registers the browser, so it must look like
 * a public push service and nothing else: https on the default port, no credentials, a named public host (never an
 * address, `localhost` or an internal name). This narrows the blind request the API can be asked to make; it does not
 * stop a public name that resolves to an internal address (DNS rebinding), which needs the sender's network egress
 * restricted as well (docs/security-audit, VR-13).
 */
const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".railway.internal"];

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
  return true;
}

/** The `endpoint` of a browser's push subscription. */
export const webPushEndpointSchema = z.url().max(2048).startsWith("https://").refine(isPublicPushEndpoint, "Not a public push service address");
