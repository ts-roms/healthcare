import { type CookieWriter, clearSessionCookies as clear, createRefresher, type SessionTokens, writeTokenCookies as write } from "@healthcare/web-session";
import { API_BASE_URL, COOKIES, SECURE_COOKIES } from "./config";

const NAMES = { access: COOKIES.access, refresh: COOKIES.refresh, transient: [COOKIES.session] };

/** Single-flight refresh for this server process (the same implementation the staff app uses). */
const refresher = createRefresher<SessionTokens>(`${API_BASE_URL}/auth/refresh`);
export const refreshTokens = refresher.refresh;

export function writeTokenCookies(jar: CookieWriter, tokens: SessionTokens): void {
  write(jar, NAMES, tokens, SECURE_COOKIES);
}

/** Signs the device out. The person's session cookie goes too. */
export function clearSessionCookies(jar: CookieWriter): void {
  clear(jar, NAMES);
  jar.delete(COOKIES.facility);
}
