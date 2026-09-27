import { type CookieWriter, clearSessionCookies as clear, createRefresher, writeTokenCookies as write } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES, SECURE_COOKIES } from "./config";
import type { PortalTokenResponse } from "./types";

const NAMES = { access: COOKIES.access, refresh: COOKIES.refresh };

/** Single-flight refresh for this server process (shared implementation in @healthcare/web-session). */
const refresher = createRefresher<PortalTokenResponse>(`${API_BASE_URL}/portal/auth/refresh`);
export const refreshTokens = refresher.refresh;

export function writeTokenCookies(jar: CookieWriter, tokens: PortalTokenResponse): void {
  write(jar, NAMES, tokens, SECURE_COOKIES);
}

export function clearSessionCookies(jar: CookieWriter): void {
  clear(jar, NAMES);
}
