export interface AppSettings {
  apiBaseUrl: string;
  organizationCode: string;
  /** The web MyHealth, for what the app does not show (results, visits, bills). */
  portalUrl: string | null;
}

/** An address the app may send credentials to: https, or http only while developing on this machine or the local network. */
export function validateApiBaseUrl(value: string | undefined, development: boolean): string {
  if (!value) throw new Error("EXPO_PUBLIC_API_BASE_URL is not set");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_API_BASE_URL is not a web address");
  }
  if (url.protocol !== "https:" && !(development && url.protocol === "http:")) {
    throw new Error("The API address must start with https:// (http:// is allowed only in development builds)");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function readSettings(env: Record<string, string | undefined>, development: boolean): AppSettings {
  const organizationCode = env["EXPO_PUBLIC_ORGANIZATION_CODE"]?.trim().toLowerCase();
  if (!organizationCode) throw new Error("EXPO_PUBLIC_ORGANIZATION_CODE is not set");
  const portal = env["EXPO_PUBLIC_PORTAL_URL"]?.trim();
  return {
    apiBaseUrl: validateApiBaseUrl(env["EXPO_PUBLIC_API_BASE_URL"], development),
    organizationCode,
    portalUrl: portal ? validateApiBaseUrl(portal, development) : null,
  };
}
